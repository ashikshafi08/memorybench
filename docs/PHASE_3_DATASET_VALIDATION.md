# Phase 3: Dataset Validation for Code Chunking Benchmark

## Overview

This document synthesizes research from 5 parallel validation agents to document the exact schemas, ground truth extraction methods, and loading code for all datasets in CodeChunkBench.

---

## Priority Order

| Priority | Dataset | Why | Effort |
|----------|---------|-----|--------|
| **P0** | RepoEval | Already partially implemented in code-chunk, matches their eval | 2-3 hrs |
| **P1** | RepoBench-R | Explicit retrieval benchmark, 2 languages, clean ground truth | 4-5 hrs |
| **P2** | SWE-bench Lite | Real-world validation, but needs git cloning infrastructure | 6-8 hrs |
| **P3** | CrossCodeEval | Most complex, requires understanding their oracle format | 5-6 hrs |

---

## Dataset Summary Matrix

| Dataset | Languages | Samples | Ground Truth Type | Granularity |
|---------|-----------|---------|-------------------|-------------|
| **RepoEval** | Python | 3,655 | Line-range overlap | Function/Line/API |
| **RepoBench-R** | Python, Java | 192,000 | Gold snippet index | Snippet-level |
| **SWE-bench Lite** | Python | 323 | Modified files in patch | File-level |
| **CrossCodeEval** | Python, Java, TS, C# | 10,000 | Cross-file dependencies | Statement-level |

---

## 1. RepoEval Dataset

### Source
- **Repository**: [microsoft/CodeT/RepoCoder](https://github.com/microsoft/CodeT/tree/main/RepoCoder)
- **Local Copy**: `/Users/ash/devhouse/mem-track /code-chunk/packages/eval/data/repoeval/`

### JSONL Schema

```typescript
interface RepoEvalSample {
  prompt: string;                    // Code context before target
  metadata: {
    task_id: string;                 // e.g., "CarperAI_trlx/idx"
    ground_truth: string;            // Expected completion text
    fpath_tuple: [string, ...];      // ["repo_name", "path", "to", "file.py"]
    context_start_lineno: number;    // Line where context starts
    line_no: number;                 // Target line number
    lineno: number;                  // Alias for line_no
  };
}
```

### Task Levels

| Task | File | Samples | Description |
|------|------|---------|-------------|
| Function-level | `function_level_completion_2k_context_codex.test.jsonl` | 455 | Complete function bodies |
| Line-level | `line_level_completion_2k_context_codex.test.jsonl` | 1,600 | Complete single lines |
| API-level | `api_level_completion_2k_context_codex.test.jsonl` | 1,600 | Complete API invocations |

### Repositories (8 Python repos)

```
repositories/function_level/
├── amazon-science_patchcore-inspection/
├── deepmind_tracr/
├── facebookresearch_omnivore/
├── CarperAI_trlx/
├── google-research_circuit_training/
├── lucidrains_DALLE2-pytorch/
├── microsoft_unilm/
└── openai_human-eval/
```

### Ground Truth: Line-Range Overlap

The ground truth is based on **which lines of code the completion targets**:

```typescript
interface GroundTruthSpan {
  file: string;           // From fpath_tuple joined
  startLine: number;      // metadata.context_start_lineno
  endLine: number;        // metadata.line_no + completion_lines
}

function isChunkRelevant(
  chunk: { file: string; startLine: number; endLine: number },
  target: GroundTruthSpan
): boolean {
  // Must be same file
  if (chunk.file !== target.file) return false;

  // Check line overlap (inclusive)
  return !(chunk.endLine < target.startLine || chunk.startLine > target.endLine);
}
```

### Loading Code

```typescript
import { readFileSync } from 'fs';

interface RepoEvalLoader {
  loadDataset(
    taskLevel: 'function' | 'line' | 'api',
    dataPath: string
  ): RepoEvalSample[] {
    const filename = `${taskLevel}_level_completion_2k_context_codex.test.jsonl`;
    const filepath = `${dataPath}/datasets/${filename}`;
    const lines = readFileSync(filepath, 'utf-8').split('\n').filter(Boolean);
    return lines.map(line => JSON.parse(line));
  }

  getFilePath(sample: RepoEvalSample): string {
    return sample.metadata.fpath_tuple.join('/');
  }

  getTargetLineRange(sample: RepoEvalSample): { start: number; end: number } {
    const start = sample.metadata.context_start_lineno;
    const completionLines = sample.metadata.ground_truth.split('\n').length;
    return { start, end: sample.metadata.line_no + completionLines };
  }
}
```

---

## 2. RepoBench-R Dataset

### Source
- **HuggingFace**: `tianyang/repobench_python_v1.1`, `tianyang/repobench_java_v1.1`
- **Paper**: [RepoBench: Benchmarking Repository-Level Code Auto-Completion](https://arxiv.org/abs/2306.03091)

### Schema

```typescript
interface RepoBenchRSample {
  repo_name: string;              // Repository name
  file_path: string;              // Path to target file
  context: string[];              // Array of k candidate snippets
  import_statement: string;       // Import statements
  code: string;                   // Code before cursor
  next_line: string;              // Line to predict
  gold_snippet_index: number;     // Index of correct snippet (0 to k-1)
}
```

### Dataset Variants

| Variant | Description | Size (Python) | Size (Java) |
|---------|-------------|---------------|-------------|
| CFF (Cross-File-First) | Gold snippet from different file | 64,000 | 64,000 |
| CFR (Cross-File-Random) | Random mix of files | 32,000 | 32,000 |

**Total**: 192,000 samples across both languages

### Ground Truth: Content-Based Snippet Matching

> **⚠️ Important Clarification**: The `gold_snippet_index` points to RepoBench's pre-made candidate snippets.
> In a chunking benchmark, we create our **own chunks** which won't match their indices.
> We need **content-based matching**, not index matching.

```typescript
/**
 * For chunking benchmarks: match by content overlap, not index
 */
function isChunkRelevant(
  chunk: { text: string },
  sample: RepoBenchRSample
): boolean {
  const goldSnippet = sample.context[sample.gold_snippet_index];

  // Option 1: Containment check
  if (chunk.text.includes(goldSnippet) || goldSnippet.includes(chunk.text)) {
    return true;
  }

  // Option 2: Text overlap threshold
  const overlap = computeTextOverlap(chunk.text, goldSnippet);
  return overlap > 0.5;  // 50% overlap threshold
}

/**
 * Compute normalized text overlap (Jaccard on tokens)
 */
function computeTextOverlap(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/));
  const tokensB = new Set(b.split(/\s+/));

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Original RepoBench evaluation (for reference only - uses their fixed candidates)
 */
function accuracyAtK(
  predictions: number[][],   // Top-k predicted indices per query
  samples: RepoBenchRSample[],
  k: number
): number {
  let correct = 0;
  for (let i = 0; i < samples.length; i++) {
    const topK = predictions[i].slice(0, k);
    if (topK.includes(samples[i].gold_snippet_index)) {
      correct++;
    }
  }
  return correct / samples.length;
}
```

### Loading Code

```typescript
// Using fetch to download from HuggingFace Hub
async function loadRepoBenchR(
  language: 'python' | 'java',
  split: 'cff' | 'cfr'
): Promise<RepoBenchRSample[]> {
  const url = `https://huggingface.co/datasets/tianyang/repobench_${language}_v1.1/resolve/main/${split}.jsonl`;
  const response = await fetch(url);
  const text = await response.text();
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}
```

---

## 3. SWE-bench Lite Dataset

### Source
- **HuggingFace**: `princeton-nlp/SWE-bench_Lite`
- **Paper**: [SWE-bench: Can Language Models Resolve Real-world Github Issues?](https://arxiv.org/abs/2310.06770)
- **Website**: [swebench.com](https://www.swebench.com/)

### Schema

```typescript
interface SWEBenchSample {
  instance_id: string;          // e.g., "django__django-11099"
  repo: string;                 // e.g., "django/django"
  base_commit: string;          // 40-char SHA
  patch: string;                // Unified diff format (gold patch)
  problem_statement: string;    // Issue title + body (460-6,700 chars)
  test_patch: string;           // Test modifications
  FAIL_TO_PASS: string;         // JSON list of failing tests
  PASS_TO_PASS: string;         // JSON list of passing tests
  hints_text: string;           // Optional hints
  created_at: string;           // ISO timestamp
  version: string;              // Package version
}
```

### Dataset Statistics

| Split | Instances | Repositories |
|-------|-----------|--------------|
| Dev | 23 | 10 |
| Test | 300 | 11 |
| **Total** | 323 | 11 |

**Covered Repositories** (11 Python projects):
- django/django
- pytest-dev/pytest
- pallets/flask
- scikit-learn/scikit-learn
- psf/requests
- mwaskom/seaborn
- matplotlib/matplotlib
- pydata/xarray
- sympy/sympy
- pylint-dev/pylint
- sphinx-doc/sphinx

### Ground Truth: Modified Files in Patch

The ground truth is **file-level** - extracted from the unified diff in the `patch` field:

```typescript
import { parsePatch } from 'diff';  // Or use unidiff library

interface ModifiedFile {
  path: string;
  additions: number;
  deletions: number;
  hunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
  }>;
}

function extractModifiedFiles(patch: string): ModifiedFile[] {
  const parsed = parsePatch(patch);
  return parsed.map(file => ({
    path: file.newFileName.replace(/^b\//, ''),
    additions: file.additions,
    deletions: file.deletions,
    hunks: file.hunks.map(h => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines
    }))
  }));
}

function isChunkRelevant(
  chunkFile: string,
  sample: SWEBenchSample
): boolean {
  const modifiedFiles = extractModifiedFiles(sample.patch);
  return modifiedFiles.some(f => f.path === chunkFile);
}
```

### Fine-Grained Ground Truth (Line-Level)

For more precise evaluation, extract line ranges from patch hunks:

```typescript
interface LineRange {
  file: string;
  oldStart: number;  // Lines in original file
  oldEnd: number;
  newStart: number;  // Lines in patched file
  newEnd: number;
}

function extractLineRanges(patch: string): LineRange[] {
  const files = extractModifiedFiles(patch);
  const ranges: LineRange[] = [];

  for (const file of files) {
    for (const hunk of file.hunks) {
      ranges.push({
        file: file.path,
        oldStart: hunk.oldStart,
        oldEnd: hunk.oldStart + hunk.oldLines - 1,
        newStart: hunk.newStart,
        newEnd: hunk.newStart + hunk.newLines - 1
      });
    }
  }

  return ranges;
}
```

### Repo Cloning Strategy

> **⚠️ Important**: SWE-bench requires checking out repos at specific commits.

```typescript
interface RepoManager {
  /** Cache directory for cloned repos */
  cacheDir: string;  // e.g., ~/.codechunkbench/repos/

  /** Clone if not exists, checkout specific commit */
  getRepoAtCommit(repo: string, commit: string): Promise<string>;

  /** Get disk usage estimate */
  estimateDiskUsage(): Promise<{ repos: number; totalMB: number }>;

  /** Clean up old checkouts */
  cleanup(olderThanDays?: number): Promise<void>;
}

/**
 * Repo caching implementation using simple-git
 */
import simpleGit, { SimpleGit } from 'simple-git';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

class SWEBenchRepoManager implements RepoManager {
  cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir ?? join(homedir(), '.codechunkbench', 'repos');
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async getRepoAtCommit(repo: string, commit: string): Promise<string> {
    const repoDir = join(this.cacheDir, repo.replace('/', '_'));
    const commitDir = join(repoDir, commit.slice(0, 8));

    // If commit checkout already exists, return it
    if (existsSync(commitDir)) {
      return commitDir;
    }

    const git: SimpleGit = simpleGit();

    // Clone if repo doesn't exist
    if (!existsSync(repoDir)) {
      await git.clone(`https://github.com/${repo}.git`, repoDir, ['--bare']);
    }

    // Create worktree for specific commit
    const bareGit = simpleGit(repoDir);
    await bareGit.raw(['worktree', 'add', commitDir, commit]);

    return commitDir;
  }

  async estimateDiskUsage(): Promise<{ repos: number; totalMB: number }> {
    // 11 repos, average ~500MB each = ~5.5GB total
    return { repos: 11, totalMB: 5500 };
  }

  async cleanup(olderThanDays = 7): Promise<void> {
    // Implementation: remove worktrees older than N days
  }
}
```

**Disk Space Requirements:**
- 11 unique repositories (Django, Flask, pytest, etc.)
- ~500MB average per repo = ~5.5GB for full clones
- Using bare clones + worktrees reduces this significantly
- 323 commit checkouts share the same objects

### Loading Code

```typescript
// Download from HuggingFace
async function loadSWEBenchLite(
  split: 'dev' | 'test' = 'test'
): Promise<SWEBenchSample[]> {
  const url = `https://huggingface.co/datasets/princeton-nlp/SWE-bench_Lite/resolve/main/${split}.jsonl`;
  const response = await fetch(url);
  const text = await response.text();
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// For cloning repos, use simple-git or isomorphic-git libraries
// Example with simple-git:
// import simpleGit from 'simple-git';
// const git = simpleGit();
// await git.clone(`https://github.com/${repo}.git`, targetDir);
// await git.cwd(targetDir).checkout(commit);
```

---

## 4. CrossCodeEval Dataset

### Source
- **GitHub**: [amazon-science/cceval](https://github.com/amazon-science/cceval)
- **HuggingFace**: `Vincentvmt/CrossCodeEval`
- **Paper**: [CrossCodeEval: A Diverse and Multilingual Benchmark for Cross-File Code Completion](https://arxiv.org/abs/2310.11248)

### Schema

```typescript
interface CrossCodeEvalSample {
  prompt: string;                    // Input code context
  groundtruth: string;               // Expected completion
  right_context: string;             // Code after target
  metadata: {
    task_id: string;                 // e.g., "project_cc_python/62"
    repository: string;              // e.g., "turboderp-exllama-a544085"
    file: string;                    // e.g., "example_ws.py"
    context_start_lineno: number;    // Line where context begins
    groundtruth_start_lineno: number; // Line where groundtruth begins
    right_context_start_lineno: number; // Line where right context begins
  };
  crossfile_context?: {              // Present in retrieval variants
    text: string;
    list: Array<{
      retrieved_chunk: string;       // Code from other files
      filename: string;              // Source filename
      score: number;                 // Relevance score
    }>;
  };
}
```

### Dataset Statistics

| Language | Repositories | Files | Examples | Avg Prompt Lines | Avg Prompt Tokens |
|----------|--------------|-------|----------|-----------------|-------------------|
| Python | 471 | 1,368 | 2,665 | 71.1 | 584.1 |
| Java | 239 | 745 | 2,139 | 116.5 | 995.3 |
| TypeScript | 193 | 779 | 3,356 | ~90-100 | ~700-800 |
| C# | 99 | 642 | 1,768 | ~80-90 | ~650-700 |
| **Total** | **1,002** | **3,534** | **9,928** | - | - |

### Ground Truth: Cross-File Dependencies

CrossCodeEval uses **static analysis** to identify ground truth dependencies:

1. Parse target file's imports
2. Replace imports with empty class stubs
3. Run static analyzer to find undefined name errors
4. These errors identify cross-file dependencies

```typescript
interface CrossFileDependency {
  sourceFile: string;      // File containing the symbol
  symbolName: string;      // Name of the imported symbol
  usageLocation: {
    file: string;
    line: number;
  };
}

// Ground truth extraction from crossfile_context
function extractGroundTruthFiles(
  sample: CrossCodeEvalSample
): string[] {
  if (!sample.crossfile_context?.list) return [];

  return sample.crossfile_context.list.map(chunk => chunk.filename);
}

function isChunkRelevant(
  chunkFile: string,
  sample: CrossCodeEvalSample
): boolean {
  const groundTruthFiles = extractGroundTruthFiles(sample);
  return groundTruthFiles.includes(chunkFile);
}
```

### JSONL File Variants

```
data/crosscodeeval_data/${language}/
├── line_completion_rg1_bm25.jsonl
├── line_completion_rg1_unixcoder_cosine_sim.jsonl
├── line_completion_rg1_openai_ada.jsonl
├── line_completion_oracle_bm25.jsonl
└── ... (other retrieval methods)
```

### Recommended Variant

> **⚠️ Important**: Use the **oracle** variant for cleanest ground truth.
> The `rg1_*` variants include noise from their retrieval process.

```typescript
// RECOMMENDED: Use oracle variant
const filename = `line_completion_oracle_bm25.jsonl`;

// NOT RECOMMENDED for chunking eval (includes retrieval noise):
// const filename = `line_completion_rg1_unixcoder_cosine_sim.jsonl`;
```

### Loading Code

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';

type CCEvalLanguage = 'python' | 'java' | 'typescript' | 'csharp';
type CCEvalRetriever = 'bm25' | 'unixcoder' | 'openai_ada';

function loadCrossCodeEval(
  dataPath: string,
  language: CCEvalLanguage,
  retriever: CCEvalRetriever = 'unixcoder'
): CrossCodeEvalSample[] {
  const filename = `line_completion_rg1_${retriever === 'unixcoder'
    ? 'unixcoder_cosine_sim'
    : retriever}.jsonl`;

  const filepath = join(dataPath, language, filename);
  const lines = readFileSync(filepath, 'utf-8').split('\n').filter(Boolean);

  return lines.map(line => JSON.parse(line));
}
```

---

## Unified Ground Truth Interface

To support all datasets uniformly in memorybench:

```typescript
/**
 * Unified ground truth interface for code chunking evaluation
 */
interface GroundTruth {
  /** Type of ground truth */
  type: 'line_range' | 'snippet_index' | 'file_list' | 'crossfile_deps';

  /** For line_range: file path and line numbers */
  lineRange?: {
    file: string;
    startLine: number;
    endLine: number;
  };

  /** For snippet_index: index of gold snippet */
  snippetIndex?: number;

  /** For file_list: list of relevant files */
  files?: string[];

  /** For crossfile_deps: detailed dependency info */
  crossFileDeps?: Array<{
    sourceFile: string;
    chunk: string;
    score?: number;
  }>;
}

interface UnifiedSample {
  id: string;
  query: string;               // Prompt or problem statement
  groundTruth: GroundTruth;
  metadata: {
    dataset: 'repoeval' | 'repobench-r' | 'swebench-lite' | 'crosscodeeval';
    language: string;
    repository?: string;
    taskType?: string;
  };
}
```

---

## Relevance Scoring by Dataset

### RepoEval: Line Overlap IoU

```typescript
function computeLineOverlapIoU(
  chunk: { startLine: number; endLine: number },
  target: { startLine: number; endLine: number }
): number {
  const overlapStart = Math.max(chunk.startLine, target.startLine);
  const overlapEnd = Math.min(chunk.endLine, target.endLine);

  if (overlapStart > overlapEnd) return 0;

  const intersection = overlapEnd - overlapStart + 1;
  const chunkSize = chunk.endLine - chunk.startLine + 1;
  const targetSize = target.endLine - target.startLine + 1;
  const union = chunkSize + targetSize - intersection;

  return intersection / union;
}
```

### RepoBench-R: Binary Match

```typescript
function isGoldSnippet(retrievedIndex: number, goldIndex: number): boolean {
  return retrievedIndex === goldIndex;
}
```

### SWE-bench Lite: File Precision/Recall

```typescript
function computeFilePrecisionRecall(
  retrievedFiles: string[],
  goldFiles: string[]
): { precision: number; recall: number } {
  const goldSet = new Set(goldFiles);
  const correct = retrievedFiles.filter(f => goldSet.has(f)).length;

  return {
    precision: retrievedFiles.length > 0 ? correct / retrievedFiles.length : 0,
    recall: goldFiles.length > 0 ? correct / goldFiles.length : 0
  };
}
```

### CrossCodeEval: Cross-File Coverage

```typescript
function computeCrossFileCoverage(
  retrievedChunks: Array<{ file: string }>,
  groundTruth: Array<{ sourceFile: string }>
): number {
  const gtFiles = new Set(groundTruth.map(g => g.sourceFile));
  const retrievedFiles = new Set(retrievedChunks.map(c => c.file));

  let covered = 0;
  for (const file of gtFiles) {
    if (retrievedFiles.has(file)) covered++;
  }

  return gtFiles.size > 0 ? covered / gtFiles.size : 0;
}
```

---

## Implementation Checklist

| Dataset | Loader | Ground Truth Extractor | Relevance Scorer | Status |
|---------|--------|----------------------|------------------|--------|
| RepoEval | `RepoEvalLoader` | `extractLineRange()` | `lineOverlapIoU()` | Partially exists |
| RepoBench-R | `RepoBenchLoader` | `getGoldSnippetIndex()` | `isGoldSnippet()` | To implement |
| SWE-bench Lite | `SWEBenchLoader` | `extractModifiedFiles()` | `filePrecisionRecall()` | To implement |
| CrossCodeEval | `CrossCodeEvalLoader` | `extractCrossFileDeps()` | `crossFileCoverage()` | To implement |

---

## Next Steps (Phase 4+)

1. **Phase 4**: Implement RepoEval loader with line-range overlap scoring
2. **Phase 5**: Implement RepoBench-R loader with snippet ranking evaluation
3. **Phase 6**: Implement SWE-bench Lite loader with file-level evaluation
4. **Phase 7**: Add chunker providers (code-chunk, Chonkie, Fixed, etc.)
5. **Phase 8**: Add embedding configurations (OpenAI, Voyage)

---

## Error Handling

Edge cases that need graceful handling:

```typescript
interface EvalResult {
  status: 'success' | 'skipped' | 'error';
  skipReason?: SkipReason;
  error?: Error;
  metrics?: MetricResults;
}

type SkipReason =
  | 'missing_file'        // File referenced in sample doesn't exist
  | 'parse_error'         // Patch/diff couldn't be parsed
  | 'no_ground_truth'     // crossfile_context is empty
  | 'clone_failed'        // Git clone/checkout failed
  | 'empty_chunks'        // Chunker produced no chunks
  | 'embedding_failed';   // Embedding API error

/**
 * Graceful evaluation wrapper
 */
async function evaluateSample(
  sample: UnifiedSample,
  chunker: Chunker,
  embedder: Embedder
): Promise<EvalResult> {
  try {
    // Check for missing ground truth
    if (!hasValidGroundTruth(sample)) {
      return { status: 'skipped', skipReason: 'no_ground_truth' };
    }

    // Chunk the repo
    const chunks = await chunker.chunkRepo(sample.metadata.repository);
    if (chunks.length === 0) {
      return { status: 'skipped', skipReason: 'empty_chunks' };
    }

    // Embed and retrieve
    const results = await embedAndRetrieve(chunks, sample.query, embedder);

    // Compute metrics
    const metrics = computeMetrics(results, sample.groundTruth);

    return { status: 'success', metrics };

  } catch (error) {
    if (error.code === 'ENOENT') {
      return { status: 'skipped', skipReason: 'missing_file' };
    }
    if (error.message?.includes('parse')) {
      return { status: 'skipped', skipReason: 'parse_error' };
    }
    return { status: 'error', error };
  }
}

function hasValidGroundTruth(sample: UnifiedSample): boolean {
  switch (sample.groundTruth.type) {
    case 'line_range':
      return !!sample.groundTruth.lineRange?.file;
    case 'snippet_index':
      return sample.groundTruth.snippetIndex !== undefined;
    case 'file_list':
      return (sample.groundTruth.files?.length ?? 0) > 0;
    case 'crossfile_deps':
      return (sample.groundTruth.crossFileDeps?.length ?? 0) > 0;
  }
}
```

---

## Quick Win: Reusing code-chunk's Eval Pipeline

Based on agent analysis, **~55% of code-chunk's eval can be directly reused**:

### What's Directly Reusable (0% modification)

| Component | File | Lines | Reusability |
|-----------|------|-------|-------------|
| Embedding + caching | `embeddings.ts` | 220 | 95% |
| Metrics (P@K, R@K, nDCG) | `metrics.ts` | 72 | 90% |
| Fixed chunker | `chunkers/fixed.ts` | 89 | 100% |
| AST chunker wrapper | `chunkers/ast.ts` | 40 | 80% |

### Integration Path

The memorybench `LocalProvider` pattern maps cleanly:

```
code-chunk Pipeline              memorybench Provider
────────────────────────────────────────────────────
chunk all files                  addContext() - called per file
embed chunks                     addContext() - store embeddings
embed query                      searchQuery() - embed query
topK similarity                  searchQuery() - vector search
compute metrics                  MetricCalculator
```

### Recommended Architecture

```
memorybench/
├── providers/
│   └── adapters/
│       └── code-chunk-provider.ts   # LocalProvider implementation
├── core/
│   └── chunkers/
│       ├── adapter.ts               # Unified chunker interface
│       ├── ast-wrapper.ts           # Reuse code-chunk's AST
│       └── fixed.ts                 # Reuse code-chunk's Fixed
└── benchmarks/
    └── configs/
        ├── repoeval.yaml
        ├── repobench-r.yaml
        ├── swebench-lite.yaml
        └── crosscodeeval.yaml
```

### Fastest Path to Working Benchmark

1. **Copy** `embeddings.ts` and `metrics.ts` from code-chunk (2 hrs)
2. **Wrap** chunkers with memorybench's interface (2 hrs)
3. **Create** `code-chunk-provider.ts` implementing `LocalProvider` (3 hrs)
4. **Add** RepoEval benchmark config + loader (2 hrs)
5. **Test** end-to-end (2 hrs)

**Total: ~11 hours to first working RepoEval benchmark**

---

## References

1. RepoEval/RepoCoder: [microsoft/CodeT](https://github.com/microsoft/CodeT/tree/main/RepoCoder)
2. RepoBench: [Leolty/repobench](https://github.com/Leolty/repobench)
3. SWE-bench: [princeton-nlp/SWE-bench](https://github.com/SWE-bench/SWE-bench)
4. CrossCodeEval: [amazon-science/cceval](https://github.com/amazon-science/cceval)
5. jsdiff (JS): [kpdecker/jsdiff](https://github.com/kpdecker/jsdiff)
6. simple-git (JS): [steveukx/git-js](https://github.com/steveukx/git-js)
