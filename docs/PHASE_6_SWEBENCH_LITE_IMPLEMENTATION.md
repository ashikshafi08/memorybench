# Phase 6: SWE-bench Lite Benchmark Implementation

## Overview

This document provides comprehensive implementation details for adding SWE-bench Lite benchmark support to memorybench for code chunking evaluation.

**Estimated Effort**: 6-8 hours
**Priority**: P2 (Third benchmark)
**Paper**: SWE-bench: Can Language Models Resolve Real-World GitHub Issues? (ICLR 2024)

---

## 1. Dataset Structure

### HuggingFace Location
```
SWE-bench/SWE-bench_Lite
```

### Related Datasets
| Dataset | Description | Use Case |
|---------|-------------|----------|
| `SWE-bench/SWE-bench_Lite` | Base dataset with issues | Problem statements |
| `princeton-nlp/SWE-bench_Lite_oracle` | Oracle retrieval (gold files) | Ground truth for retrieval |
| `princeton-nlp/SWE-bench_Lite_bm25_13K` | BM25 13K context | Baseline comparison |
| `princeton-nlp/SWE-bench_Lite_bm25_27K` | BM25 27K context | Extended context |

### Statistics
- **300 instances** from 11 Python repositories
- **11 repositories**: astropy, django, flask, matplotlib, pylint, pytest, requests, scikit-learn, sphinx, sympy, xarray
- **Average repository size**: ~438K lines of code

---

## 2. Dataset Schema

```typescript
interface SWEBenchLiteInstance {
  instance_id: string;          // Format: "repo_owner__repo_name-PR-number"
  repo: string;                 // e.g., "django/django"
  base_commit: string;          // SHA of commit before fix
  patch: string;                // The gold patch (unified diff format)
  problem_statement: string;    // GitHub issue text
  hints_text: string;           // Optional hints
  created_at: string;           // Timestamp
  version: string;              // e.g., "4.0", "3.2"

  // From oracle dataset:
  text?: string;                // Retrieved file contents
  FAIL_TO_PASS?: string[];      // Failing tests before fix
  PASS_TO_PASS?: string[];      // Passing tests that should remain passing
}

interface ParsedPatch {
  files: Array<{
    oldPath: string;
    newPath: string;
    additions: number;
    deletions: number;
    hunks: Array<{
      oldStart: number;
      oldLines: number;
      newStart: number;
      newLines: number;
      content: string;
    }>;
  }>;
}
```

### Sample Data

```json
{
  "instance_id": "django__django-15738",
  "repo": "django/django",
  "base_commit": "4c76ffc2d6c77c850b4bef8d9acc197d11c47937",
  "patch": "diff --git a/django/db/models/fields/__init__.py b/django/db/models/fields/__init__.py\nindex 1234567..abcdefg 100644\n--- a/django/db/models/fields/__init__.py\n+++ b/django/db/models/fields/__init__.py\n@@ -123,6 +123,7 @@ class Field:\n     def __init__(self, ...):\n         ...\n+        self.validate_constraints()\n",
  "problem_statement": "Models with constraints defined in Meta.constraints are not properly validated...",
  "hints_text": "Check the Field.__init__ method in django/db/models/fields/__init__.py",
  "version": "4.0"
}
```

---

## 3. Ground Truth Definition

### File-Level Ground Truth (from Patch)

The ground truth for retrieval is the set of files modified in the gold patch.

```typescript
interface GroundTruthFiles {
  type: 'file_level';
  modifiedFiles: string[];      // Files from patch
  modifiedRanges: Map<string, LineRange[]>;  // Optional: specific line ranges
}

/**
 * Parse unified diff to extract modified files and line ranges
 */
function parsePatch(patch: string): ParsedPatch {
  const files: ParsedPatch['files'] = [];
  const lines = patch.split('\n');

  let currentFile: ParsedPatch['files'][0] | null = null;
  let currentHunk: ParsedPatch['files'][0]['hunks'][0] | null = null;

  for (const line of lines) {
    // New file header
    if (line.startsWith('diff --git')) {
      if (currentFile) files.push(currentFile);
      currentFile = { oldPath: '', newPath: '', additions: 0, deletions: 0, hunks: [] };
    }

    // File paths
    if (line.startsWith('--- a/')) {
      if (currentFile) currentFile.oldPath = line.slice(6);
    }
    if (line.startsWith('+++ b/')) {
      if (currentFile) currentFile.newPath = line.slice(6);
    }

    // Hunk header: @@ -oldStart,oldLines +newStart,newLines @@
    const hunkMatch = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (hunkMatch && currentFile) {
      if (currentHunk) currentFile.hunks.push(currentHunk);
      currentHunk = {
        oldStart: parseInt(hunkMatch[1]),
        oldLines: parseInt(hunkMatch[2] || '1'),
        newStart: parseInt(hunkMatch[3]),
        newLines: parseInt(hunkMatch[4] || '1'),
        content: '',
      };
    }

    // Content lines
    if (currentHunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      currentHunk.content += line + '\n';
      if (line.startsWith('+') && !line.startsWith('+++')) currentFile!.additions++;
      if (line.startsWith('-') && !line.startsWith('---')) currentFile!.deletions++;
    }
  }

  // Finalize
  if (currentHunk && currentFile) currentFile.hunks.push(currentHunk);
  if (currentFile) files.push(currentFile);

  return { files };
}

/**
 * Check if a chunk is relevant based on file-level matching
 */
function isChunkRelevant(
  chunk: { filepath: string; startLine?: number; endLine?: number },
  groundTruth: GroundTruthFiles
): boolean {
  // Normalize paths
  const normalizedChunkPath = chunk.filepath.replace(/^\//, '').replace(/\\/g, '/');

  for (const file of groundTruth.modifiedFiles) {
    const normalizedFile = file.replace(/^\//, '').replace(/\\/g, '/');

    if (normalizedChunkPath.endsWith(normalizedFile) ||
        normalizedFile.endsWith(normalizedChunkPath)) {
      // If we have line ranges, check overlap
      if (groundTruth.modifiedRanges?.has(file) && chunk.startLine !== undefined) {
        const ranges = groundTruth.modifiedRanges.get(file)!;
        return ranges.some(range =>
          !(chunk.endLine! < range.start || chunk.startLine! > range.end)
        );
      }
      return true; // File-level match
    }
  }

  return false;
}
```

---

## 4. Repository Management

### The Challenge

SWE-bench Lite spans 11 large repositories. Full clones would require ~50+ GB.

### Solution: Bare Clone + Worktrees

```typescript
import simpleGit, { SimpleGit } from 'simple-git';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';

interface RepoConfig {
  owner: string;
  repo: string;
  url: string;
}

const SWE_BENCH_REPOS: RepoConfig[] = [
  { owner: 'astropy', repo: 'astropy', url: 'https://github.com/astropy/astropy.git' },
  { owner: 'django', repo: 'django', url: 'https://github.com/django/django.git' },
  { owner: 'pallets', repo: 'flask', url: 'https://github.com/pallets/flask.git' },
  { owner: 'matplotlib', repo: 'matplotlib', url: 'https://github.com/matplotlib/matplotlib.git' },
  { owner: 'PyCQA', repo: 'pylint', url: 'https://github.com/PyCQA/pylint.git' },
  { owner: 'pytest-dev', repo: 'pytest', url: 'https://github.com/pytest-dev/pytest.git' },
  { owner: 'psf', repo: 'requests', url: 'https://github.com/psf/requests.git' },
  { owner: 'scikit-learn', repo: 'scikit-learn', url: 'https://github.com/scikit-learn/scikit-learn.git' },
  { owner: 'sphinx-doc', repo: 'sphinx', url: 'https://github.com/sphinx-doc/sphinx.git' },
  { owner: 'sympy', repo: 'sympy', url: 'https://github.com/sympy/sympy.git' },
  { owner: 'pydata', repo: 'xarray', url: 'https://github.com/pydata/xarray.git' },
];

export class RepoManager {
  private basePath: string;
  private git: SimpleGit;

  constructor(basePath: string = '/tmp/swebench-repos') {
    this.basePath = basePath;
    this.git = simpleGit();
    mkdirSync(basePath, { recursive: true });
  }

  /**
   * Get or create bare clone of repository
   */
  async ensureBareClone(repoConfig: RepoConfig): Promise<string> {
    const barePath = join(this.basePath, 'bare', `${repoConfig.owner}_${repoConfig.repo}.git`);

    if (!existsSync(barePath)) {
      console.log(`Cloning bare repo: ${repoConfig.url}`);
      await this.git.clone(repoConfig.url, barePath, ['--bare', '--filter=blob:none']);
    } else {
      // Fetch latest
      const bareGit = simpleGit(barePath);
      await bareGit.fetch(['--all']);
    }

    return barePath;
  }

  /**
   * Create worktree for specific commit
   */
  async getWorktree(repoConfig: RepoConfig, commit: string): Promise<string> {
    const barePath = await this.ensureBareClone(repoConfig);
    const worktreePath = join(
      this.basePath,
      'worktrees',
      `${repoConfig.owner}_${repoConfig.repo}`,
      commit.slice(0, 8)
    );

    if (!existsSync(worktreePath)) {
      const bareGit = simpleGit(barePath);

      // Fetch specific commit if not present
      try {
        await bareGit.raw(['cat-file', '-e', commit]);
      } catch {
        await bareGit.fetch(['origin', commit, '--depth=1']);
      }

      // Create worktree
      await bareGit.raw(['worktree', 'add', worktreePath, commit]);
    }

    return worktreePath;
  }

  /**
   * Get repo config by instance ID
   */
  getRepoConfig(instanceId: string): RepoConfig {
    // Parse instance_id format: "owner__repo-PR-number"
    const [repoIdent] = instanceId.split('-');
    const [owner, repo] = repoIdent.split('__');

    const config = SWE_BENCH_REPOS.find(
      r => r.owner === owner || r.repo === repo ||
           `${r.owner}/${r.repo}` === `${owner}/${repo}`
    );

    if (!config) {
      throw new Error(`Unknown repository: ${instanceId}`);
    }

    return config;
  }

  /**
   * Cleanup old worktrees
   */
  async cleanup(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    // Implementation: remove worktrees older than maxAge
  }
}
```

### Disk Space Estimates

| Component | Size |
|-----------|------|
| Bare clones (11 repos, blob-none) | ~2-3 GB total |
| Per worktree | ~50-200 MB each |
| 10 concurrent worktrees | ~1.5 GB |
| **Total estimated** | **~5 GB** |

---

## 5. Benchmark Config (YAML)

```yaml
# benchmarks/configs/swebench-lite.yaml
name: swebench-lite
displayName: "SWE-bench Lite"
description: "Lightweight subset of SWE-bench for repository-level bug localization"
version: "1.0"
source: "https://github.com/SWE-bench/SWE-bench"
paper: "https://arxiv.org/abs/2310.06770"
tags:
  - code
  - retrieval
  - python
  - repository-level
  - bug-localization
  - real-world

data:
  type: huggingface
  dataset: "SWE-bench/SWE-bench_Lite"
  split: "test"

# Oracle retrieval for ground truth
oracle:
  dataset: "princeton-nlp/SWE-bench_Lite_oracle"
  split: "test"

schema:
  itemId: "instance_id"
  question: "problem_statement"
  groundTruth:
    type: "file_level"
    patchField: "patch"

# Custom pack for SWE-bench evaluation
packId: "swebench-lite@chunking-v1"

# Repository settings
repositories:
  basePath: "/tmp/swebench-repos"
  strategy: "bare-worktree"  # or "full-clone" for disk-rich environments

# Evaluation settings
evaluation:
  method: retrieval-file-match
  groundTruth:
    type: file_level
    extractFromPatch: true

search:
  defaultLimit: 10
  includeChunks: true

metrics:
  - file_recall_at_5
  - file_recall_at_10
  - precision_at_5
  - recall_at_5
  - mrr
  - ndcg_at_5
  - ndcg_at_10
```

---

## 6. Loader Implementation

```typescript
// benchmarks/loaders/swebench-loader.ts

interface SWEBenchInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  patch: string;
  problem_statement: string;
  hints_text: string;
  version: string;
}

interface SWEBenchBenchmarkItem {
  id: string;
  query: string;
  groundTruth: {
    type: 'file_level';
    modifiedFiles: string[];
    modifiedRanges: Map<string, Array<{ start: number; end: number }>>;
  };
  metadata: {
    instanceId: string;
    repo: string;
    baseCommit: string;
    version: string;
    patch: string;
  };
}

export class SWEBenchLoader {
  private repoManager: RepoManager;

  constructor(private config: {
    basePath?: string;
    hfToken?: string;
  } = {}) {
    this.repoManager = new RepoManager(config.basePath);
  }

  /**
   * Load instances from HuggingFace
   */
  async loadInstances(limit?: number): Promise<SWEBenchInstance[]> {
    const response = await fetch(
      `https://datasets-server.huggingface.co/rows?` +
      `dataset=SWE-bench/SWE-bench_Lite&` +
      `config=default&` +
      `split=test&` +
      `offset=0&` +
      `length=${limit || 300}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch SWE-bench Lite: ${response.statusText}`);
    }

    const data = await response.json();
    return data.rows.map((row: any) => row.row as SWEBenchInstance);
  }

  /**
   * Convert to memorybench format
   */
  toBenchmarkItems(instances: SWEBenchInstance[]): SWEBenchBenchmarkItem[] {
    return instances.map(instance => {
      // Parse patch to extract modified files and line ranges
      const parsed = this.parsePatch(instance.patch);
      const modifiedFiles = parsed.files.map(f => f.newPath || f.oldPath);

      // Build line ranges map
      const modifiedRanges = new Map<string, Array<{ start: number; end: number }>>();
      for (const file of parsed.files) {
        const filePath = file.newPath || file.oldPath;
        const ranges = file.hunks.map(hunk => ({
          start: hunk.newStart,
          end: hunk.newStart + hunk.newLines - 1,
        }));
        modifiedRanges.set(filePath, ranges);
      }

      return {
        id: instance.instance_id,
        query: instance.problem_statement,
        groundTruth: {
          type: 'file_level' as const,
          modifiedFiles,
          modifiedRanges,
        },
        metadata: {
          instanceId: instance.instance_id,
          repo: instance.repo,
          baseCommit: instance.base_commit,
          version: instance.version,
          patch: instance.patch,
        },
      };
    });
  }

  /**
   * Prepare repository for evaluation
   */
  async prepareRepository(instance: SWEBenchInstance): Promise<string> {
    const repoConfig = this.repoManager.getRepoConfig(instance.instance_id);
    return this.repoManager.getWorktree(repoConfig, instance.base_commit);
  }

  /**
   * Parse unified diff format
   */
  private parsePatch(patch: string): ParsedPatch {
    // Implementation from section 3
    const files: ParsedPatch['files'] = [];
    // ... (full implementation above)
    return { files };
  }
}
```

---

## 7. Benchmark Pack Implementation

```typescript
// benchmarks/packs/swebench-lite.ts
import type { BenchmarkPack, PackEvaluationResult } from './interface';
import type { BenchmarkItem, SearchResult } from '../../core/types';

export class SWEBenchLitePack implements BenchmarkPack {
  readonly benchmarkName = 'swebench-lite';
  readonly packId = 'swebench-lite@chunking-v1';

  readonly sealedSemantics = {
    prompts: true,      // Use issue text as query
    scoring: true,      // File-level scoring
    relevance: true,    // File-path based relevance
  };

  /**
   * Build query for retrieval (issue text)
   */
  buildAnswerPrompt(input: {
    item: BenchmarkItem;
    retrieved: SearchResult[];
  }): { text: string; sha256: string } {
    return {
      text: input.item.question,
      sha256: this.hash(input.item.question),
    };
  }

  /**
   * No LLM judge needed - pure retrieval evaluation
   */
  buildJudgePrompt(): undefined {
    return undefined;
  }

  /**
   * Evaluate retrieval results against ground truth
   */
  async evaluate(input: {
    item: BenchmarkItem;
    retrieved: SearchResult[];
  }): Promise<PackEvaluationResult> {
    const groundTruth = input.item.metadata?.groundTruth as {
      modifiedFiles: string[];
      modifiedRanges?: Map<string, Array<{ start: number; end: number }>>;
    };

    // Count how many ground truth files are represented in retrieved chunks
    const retrievedFiles = new Set(
      input.retrieved.map(r => this.normalizeFilePath(r.metadata?.filepath as string))
    );

    const gtFilesNormalized = groundTruth.modifiedFiles.map(f => this.normalizeFilePath(f));
    const foundFiles = gtFilesNormalized.filter(f =>
      Array.from(retrievedFiles).some(rf => rf.endsWith(f) || f.endsWith(rf))
    );

    const fileRecall = foundFiles.length / gtFilesNormalized.length;
    const score = fileRecall;

    return {
      answer: `Found ${foundFiles.length}/${gtFilesNormalized.length} modified files`,
      score,
      correct: fileRecall > 0,
      judgeResponse: undefined,
      details: {
        foundFiles,
        totalGTFiles: gtFilesNormalized.length,
        retrievedFileCount: retrievedFiles.size,
        fileRecall,
      },
    };
  }

  /**
   * Check if a retrieved chunk is from a modified file
   */
  isRelevant(input: {
    item: BenchmarkItem;
    result: SearchResult;
  }): boolean {
    const groundTruth = input.item.metadata?.groundTruth as {
      modifiedFiles: string[];
      modifiedRanges?: Map<string, Array<{ start: number; end: number }>>;
    };

    if (!groundTruth?.modifiedFiles) return false;

    const chunkPath = this.normalizeFilePath(input.result.metadata?.filepath as string);

    for (const gtFile of groundTruth.modifiedFiles) {
      const normalizedGT = this.normalizeFilePath(gtFile);

      if (chunkPath.endsWith(normalizedGT) || normalizedGT.endsWith(chunkPath)) {
        // Optional: Check line range overlap
        const ranges = groundTruth.modifiedRanges?.get(gtFile);
        if (ranges && input.result.metadata?.startLine !== undefined) {
          const chunkStart = input.result.metadata.startLine as number;
          const chunkEnd = input.result.metadata.endLine as number;

          return ranges.some(range =>
            !(chunkEnd < range.start || chunkStart > range.end)
          );
        }
        return true;
      }
    }

    return false;
  }

  private normalizeFilePath(path: string): string {
    if (!path) return '';
    return path.replace(/^\//, '').replace(/\\/g, '/').toLowerCase();
  }

  private hash(text: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(text).digest('hex');
  }
}
```

---

## 8. File-Level Recall Metric

```typescript
/**
 * File-level Recall metric for SWE-bench style evaluation
 *
 * Measures: What fraction of modified files appear in retrieved chunks?
 */
export class FileRecallAtKMetric implements MetricCalculator {
  readonly name: string;
  private readonly k: number;

  constructor(k: number) {
    this.k = k;
    this.name = `file_recall_at_${k}`;
  }

  compute(results: EvalResult[]): MetricResult {
    if (results.length === 0) {
      return { name: this.name, value: 0 };
    }

    let totalRecall = 0;
    let validInstances = 0;

    for (const result of results) {
      const groundTruth = result.metadata?.groundTruth as {
        modifiedFiles: string[];
      };

      if (!groundTruth?.modifiedFiles?.length) continue;
      validInstances++;

      const topK = result.retrievedContext.slice(0, this.k);
      const retrievedFiles = new Set(
        topK.map(c => this.normalizeFilePath(c.metadata?.filepath as string))
      );

      let found = 0;
      for (const gtFile of groundTruth.modifiedFiles) {
        const normalizedGT = this.normalizeFilePath(gtFile);
        const isFound = Array.from(retrievedFiles).some(
          rf => rf.endsWith(normalizedGT) || normalizedGT.endsWith(rf)
        );
        if (isFound) found++;
      }

      totalRecall += found / groundTruth.modifiedFiles.length;
    }

    return {
      name: this.name,
      value: validInstances > 0 ? totalRecall / validInstances : 0,
      details: {
        avgFileRecall: validInstances > 0 ? totalRecall / validInstances : 0,
        validInstances,
        k: this.k,
      },
    };
  }

  private normalizeFilePath(path: string): string {
    if (!path) return '';
    return path.replace(/^\//, '').replace(/\\/g, '/').toLowerCase();
  }
}
```

---

## 9. CLI Usage

```bash
# List SWE-bench Lite benchmark
memorybench list --benchmarks

# Run evaluation
memorybench eval \
  --benchmarks swebench-lite \
  --providers code-chunk-ast,code-chunk-fixed \
  --metrics file_recall_at_5 file_recall_at_10 ndcg_at_10 mrr \
  --limit 50

# With specific repository filter
memorybench eval \
  --benchmarks swebench-lite \
  --providers code-chunk-ast \
  --filter "repo=django/django" \
  --limit 20
```

---

## 10. Implementation Checklist

- [ ] Create `benchmarks/configs/swebench-lite.yaml`
- [ ] Create `benchmarks/loaders/swebench-loader.ts`
- [ ] Create `benchmarks/packs/swebench-lite.ts`
- [ ] Implement `RepoManager` with bare clone + worktree strategy
- [ ] Add patch parsing utility (parsePatch)
- [ ] Implement `FileRecallAtKMetric`
- [ ] Register pack in `benchmarks/packs/index.ts`
- [ ] Test with small subset (10 instances)
- [ ] Validate worktree creation for all 11 repos
- [ ] Benchmark disk usage

---

## 11. Expected Results

Based on SWE-bench paper:

| Method | File Recall@5 | File Recall@10 |
|--------|---------------|----------------|
| Oracle | 100% | 100% |
| BM25 (13K) | ~45% | ~60% |
| BM25 (27K) | ~50% | ~65% |
| Neural Retriever | ~55% | ~70% |

**Key Finding**: Even with oracle retrieval (all correct files given), models only solve 4.8% of issues. With BM25 retrieval, this drops to 1.96%. This highlights how critical good retrieval/chunking is.

---

## 12. Key Challenges

### Challenge 1: Large Repositories
- Django has ~500K lines of code
- Solution: Use worktrees + lazy loading

### Challenge 2: Cross-File Dependencies
- Bug fixes often span multiple files
- Solution: Evaluate file recall, not just single-file retrieval

### Challenge 3: Commit-Specific Code State
- Must evaluate on `base_commit`, not HEAD
- Solution: RepoManager handles worktree creation per commit

### Challenge 4: Test File Filtering
- Patches often include test files (`test_*.py`)
- Decision: Include or exclude test files based on task

```typescript
// Optional: Filter test files from ground truth
function filterTestFiles(files: string[]): string[] {
  return files.filter(f =>
    !f.includes('/tests/') &&
    !f.includes('/test/') &&
    !f.match(/test_.*\.py$/) &&
    !f.match(/.*_test\.py$/)
  );
}
```

---

## 13. Disk Space Optimization

### Lazy Cloning

Only clone repositories when needed:

```typescript
async function lazyPrepare(instances: SWEBenchInstance[]): Promise<void> {
  // Group by repository
  const byRepo = new Map<string, SWEBenchInstance[]>();
  for (const inst of instances) {
    const repo = inst.repo;
    if (!byRepo.has(repo)) byRepo.set(repo, []);
    byRepo.get(repo)!.push(inst);
  }

  // Clone repos in parallel (max 3)
  const repos = Array.from(byRepo.keys());
  const pool = new PromisePool(repos, 3, async (repo) => {
    const config = this.repoManager.getRepoConfig(repo);
    await this.repoManager.ensureBareClone(config);
  });
  await pool.run();
}
```

### Cleanup Strategy

```typescript
// Remove worktrees older than 7 days
await repoManager.cleanup(7 * 24 * 60 * 60 * 1000);
```
