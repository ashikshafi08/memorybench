# Phase 4: RepoEval Benchmark Implementation

## Overview

This document provides comprehensive implementation details for adding RepoEval benchmark support to memorybench-bench-code-chunk.

**Estimated Effort**: 3-4 hours
**Priority**: P0 (First benchmark to implement)

---

## 1. Dataset Structure

### Location
```
/code-chunk/packages/eval/data/repoeval/
├── datasets/                    # JSONL test files
│   ├── function_level_completion_2k_context_codex.test.jsonl (455 samples, 2.1 MB)
│   ├── line_level_completion_2k_context_codex.test.jsonl (1,600 samples, 7.3 MB)
│   └── api_level_completion_2k_context_codex.test.jsonl (1,600 samples, 8.6 MB)
└── repositories/function_level/ # 8 Python repositories (495 files total)
    ├── amazon-science_patchcore-inspection/
    ├── CarperAI_trlx/
    ├── deepmind_tracr/
    ├── facebookresearch_omnivore/
    ├── google_lightweight_mmm/
    ├── leopard-ai_betty/
    ├── lucidrains_imagen-pytorch/
    └── maxhumber_redframes/
```

### Task Levels

| Level | File | Samples | Description |
|-------|------|---------|-------------|
| Function | `function_level_completion_2k_context_codex.test.jsonl` | 455 | Complete function bodies |
| Line | `line_level_completion_2k_context_codex.test.jsonl` | 1,600 | Complete single lines |
| API | `api_level_completion_2k_context_codex.test.jsonl` | 1,600 | Complete API invocations |

---

## 2. JSONL Schema

```typescript
interface RepoEvalSample {
  prompt: string;                    // Code context (up to 2k tokens)
  metadata: {
    task_id: string;                 // Format: "repo_name/idx" or "repo_name--repo/idx"
    ground_truth: string;            // Expected completion text
    fpath_tuple: string[];           // ["repo_name", "path", "to", "file.py"]
    context_start_lineno: number;    // Context window start line (0-indexed)
    lineno: number;                  // Target line number (0-indexed)
    line_no: number;                 // Alias for lineno
    function_name?: string;          // Present in function-level tasks
  };
}
```

### Sample Data

**Function-Level Sample:**
```json
{
  "prompt": "import random\nimport sys\nfrom abc import abstractmethod...\ndef register_datapipeline(name):\n    \"\"\"Decorator used register...",
  "metadata": {
    "task_id": "CarperAI--trlx/idx",
    "ground_truth": "    def register_class(cls, name):\n        _DATAPIPELINE[name] = cls\n        setattr(sys.modules[__name__], name, cls)\n        return cls\n...",
    "fpath_tuple": ["CarperAI_trlx", "trlx", "pipeline", "__init__.py"],
    "context_start_lineno": 0,
    "lineno": 19,
    "function_name": "register_datapipeline"
  }
}
```

---

## 3. Ground Truth Definition

### Line-Range Overlap

A chunk is **relevant** if it overlaps with the target line range:

```typescript
interface GroundTruthSpan {
  file: string;           // fpath_tuple.slice(1).join('/')
  startLine: number;      // context_start_lineno
  endLine: number;        // lineno + ground_truth.split('\n').length
}

function isChunkRelevant(
  chunk: { filepath: string; startLine: number; endLine: number },
  target: GroundTruthSpan
): boolean {
  // Must be same file
  if (chunk.filepath !== target.file) return false;

  // Check line overlap (inclusive)
  return !(chunk.endLine < target.startLine || chunk.startLine > target.endLine);
}
```

### IoU Scoring (Optional)

For graded relevance instead of binary:

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

---

## 4. Benchmark Config (YAML)

```yaml
# benchmarks/configs/repoeval.yaml
name: repoeval
displayName: "RepoEval"
description: "Repository-level code completion benchmark from RepoCoder paper"
version: "1.0"
source: "https://github.com/microsoft/CodeT/tree/main/RepoCoder"
paper: "https://arxiv.org/abs/2303.12570"
tags:
  - code
  - retrieval
  - python
  - repository-level

data:
  type: local
  path: "../code-chunk/packages/eval/data/repoeval/datasets/function_level_completion_2k_context_codex.test.jsonl"
  format: jsonl

schema:
  itemId: "metadata.task_id"
  question: "prompt"
  answer: "metadata.ground_truth"
  metadata:
    filepath: "metadata.fpath_tuple"
    startLine: "metadata.context_start_lineno"
    endLine: "metadata.lineno"
    functionName: "metadata.function_name"

# Custom pack for code retrieval evaluation
packId: "repoeval@chunking-v1"

# Repository data for chunking
repositories:
  path: "../code-chunk/packages/eval/data/repoeval/repositories/function_level"
  language: python
  filePattern: "**/*.py"

# Evaluation settings
evaluation:
  method: retrieval-overlap
  groundTruth:
    type: line_range
    fileField: "metadata.fpath_tuple"
    startLineField: "metadata.context_start_lineno"
    endLineField: "metadata.lineno"

search:
  defaultLimit: 10
  includeChunks: true

metrics:
  - precision_at_5
  - precision_at_10
  - recall_at_5
  - recall_at_10
  - mrr
  - ndcg_at_5
  - ndcg_at_10
```

---

## 5. Loader Implementation

```typescript
// benchmarks/loaders/repoeval-loader.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

interface RepoEvalTask {
  prompt: string;
  metadata: {
    task_id: string;
    ground_truth: string;
    fpath_tuple: string[];
    context_start_lineno: number;
    lineno: number;
    line_no: number;
    function_name?: string;
  };
}

interface RepoEvalBenchmarkItem {
  id: string;
  query: string;
  groundTruth: {
    type: 'line_range';
    file: string;
    startLine: number;
    endLine: number;
  };
  metadata: {
    taskId: string;
    repository: string;
    filepath: string;
    functionName?: string;
  };
}

export class RepoEvalLoader {
  private dataPath: string;
  private reposPath: string;

  constructor(config: {
    dataPath: string;
    reposPath: string;
  }) {
    this.dataPath = config.dataPath;
    this.reposPath = config.reposPath;
  }

  /**
   * Load tasks from JSONL file
   */
  loadTasks(
    taskLevel: 'function' | 'line' | 'api' = 'function',
    contextLength: '1k' | '2k' | '4k' = '2k'
  ): RepoEvalTask[] {
    const filename = `${taskLevel}_level_completion_${contextLength}_context_codex.test.jsonl`;
    const filepath = join(this.dataPath, filename);

    const content = readFileSync(filepath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);

    return lines.map(line => JSON.parse(line));
  }

  /**
   * Convert to memorybench format
   */
  toBenchmarkItems(tasks: RepoEvalTask[]): RepoEvalBenchmarkItem[] {
    return tasks.map((task, idx) => {
      // Normalize task_id (replace -- with _)
      const normalizedId = task.metadata.task_id.replace(/--/g, '_');

      // Extract file path (skip repo name)
      const filepath = task.metadata.fpath_tuple.slice(1).join('/');

      // Calculate ground truth line range
      const startLine = task.metadata.context_start_lineno;
      const endLine = task.metadata.lineno +
        task.metadata.ground_truth.split('\n').length - 1;

      return {
        id: `${normalizedId}-${idx}`,
        query: task.prompt,
        groundTruth: {
          type: 'line_range' as const,
          file: filepath,
          startLine,
          endLine,
        },
        metadata: {
          taskId: task.metadata.task_id,
          repository: task.metadata.fpath_tuple[0],
          filepath,
          functionName: task.metadata.function_name,
        },
      };
    });
  }

  /**
   * Get all Python files from a repository
   */
  getRepositoryFiles(repoName: string): string[] {
    const repoPath = join(this.reposPath, repoName);
    const files: string[] = [];

    function walk(dir: string) {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip __pycache__ and hidden directories
          if (!entry.startsWith('.') && entry !== '__pycache__') {
            walk(fullPath);
          }
        } else if (entry.endsWith('.py')) {
          files.push(relative(repoPath, fullPath));
        }
      }
    }

    walk(repoPath);
    return files;
  }

  /**
   * Load file content from repository
   */
  loadFileContent(repoName: string, filepath: string): string {
    const fullPath = join(this.reposPath, repoName, filepath);
    return readFileSync(fullPath, 'utf-8');
  }

  /**
   * Get unique repositories from tasks
   */
  getRepositories(tasks: RepoEvalTask[]): string[] {
    const repos = new Set(tasks.map(t => t.metadata.fpath_tuple[0]));
    return Array.from(repos);
  }
}
```

---

## 6. Benchmark Pack Implementation

```typescript
// benchmarks/packs/repoeval.ts
import type { BenchmarkPack, PackEvaluationResult } from './interface';
import type { BenchmarkItem, SearchResult } from '../../core/types';

export class RepoEvalPack implements BenchmarkPack {
  readonly benchmarkName = 'repoeval';
  readonly packId = 'repoeval@chunking-v1';

  readonly sealedSemantics = {
    prompts: true,      // Use code as query, not LLM prompts
    scoring: true,      // Line overlap scoring
    relevance: true,    // Line range based relevance
  };

  /**
   * Build query for retrieval (just use the prompt as-is)
   */
  buildAnswerPrompt(input: {
    item: BenchmarkItem;
    retrieved: SearchResult[];
  }): { text: string; sha256: string } {
    // For code retrieval, the "prompt" is the query
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
      file: string;
      startLine: number;
      endLine: number;
    };

    // Count relevant chunks in retrieved results
    const relevantRetrieved = input.retrieved.filter(result =>
      this.isRelevant({ item: input.item, result })
    );

    // Score based on how many relevant chunks were retrieved
    const score = relevantRetrieved.length > 0 ? 1 : 0;

    return {
      answer: `Retrieved ${relevantRetrieved.length} relevant chunks`,
      score,
      correct: score > 0,
      judgeResponse: undefined,
    };
  }

  /**
   * Check if a retrieved chunk overlaps with ground truth
   */
  isRelevant(input: {
    item: BenchmarkItem;
    result: SearchResult;
  }): boolean {
    const groundTruth = input.item.metadata?.groundTruth as {
      file: string;
      startLine: number;
      endLine: number;
    };

    if (!groundTruth) return false;

    // Extract chunk metadata
    const chunkFile = input.result.metadata?.filepath as string;
    const chunkStart = input.result.metadata?.startLine as number;
    const chunkEnd = input.result.metadata?.endLine as number;

    if (!chunkFile || chunkStart === undefined || chunkEnd === undefined) {
      return false;
    }

    // Must be same file
    if (chunkFile !== groundTruth.file) return false;

    // Check line overlap
    return !(chunkEnd < groundTruth.startLine || chunkStart > groundTruth.endLine);
  }

  private hash(text: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(text).digest('hex');
  }
}
```

---

## 7. Integration with code-chunk's Existing Eval

### Reusable Components from code-chunk

| Component | File | Lines | Reuse Strategy |
|-----------|------|-------|----------------|
| Embeddings + caching | `embeddings.ts` | 220 | Direct copy with modifications |
| Metrics (P@K, R@K, nDCG) | `metrics.ts` | 72 | Already in memorybench |
| Chunk overlap detection | `run.ts:107-112` | 5 | Copy logic |
| Task loading | `download.ts` | 150 | Adapt for loader |
| AST chunker wrapper | `chunkers/ast.ts` | 41 | Use as provider template |

### Key Functions to Reuse

```typescript
// From run.ts - chunk overlap detection
function chunksOverlap(
  chunk: { startLine: number; endLine: number },
  target: { start: number; end: number }
): boolean {
  return !(chunk.endLine < target.start || chunk.startLine > target.end);
}

// From metrics.ts - metric computation
function computeMetrics(
  retrievedIds: string[],
  relevantSet: Set<string>,
  k: number
): { precision: number; recall: number; ndcg: number } {
  const topK = retrievedIds.slice(0, k);

  // Precision@K
  const relevantInTopK = topK.filter(id => relevantSet.has(id)).length;
  const precision = relevantInTopK / k;

  // Recall@K
  const recall = relevantSet.size > 0
    ? relevantInTopK / relevantSet.size
    : 0;

  // nDCG@K
  const dcg = topK.reduce((sum, id, i) => {
    const rel = relevantSet.has(id) ? 1 : 0;
    return sum + rel / Math.log2(i + 2);
  }, 0);

  const idealK = Math.min(k, relevantSet.size);
  const idcg = Array.from({ length: idealK }).reduce((sum: number, _, i) => {
    return sum + 1 / Math.log2(i + 2);
  }, 0);

  const ndcg = idcg > 0 ? dcg / idcg : 0;

  return { precision, recall, ndcg };
}
```

---

## 8. CLI Usage

After implementation, usage will be:

```bash
# List RepoEval benchmark
memorybench list --benchmarks

# Run evaluation
memorybench eval \
  --benchmarks repoeval \
  --providers code-chunk-ast,code-chunk-fixed,chonkie \
  --metrics precision_at_5 recall_at_10 ndcg_at_5 ndcg_at_10 \
  --limit 100

# Export results
memorybench export <runId> --format json -o repoeval-results.json
```

---

## 9. Implementation Checklist

- [ ] Create `benchmarks/configs/repoeval.yaml`
- [ ] Create `benchmarks/loaders/repoeval-loader.ts`
- [ ] Create `benchmarks/packs/repoeval.ts`
- [ ] Register pack in `benchmarks/packs/index.ts`
- [ ] Add line-overlap relevance scorer
- [ ] Test with code-chunk AST chunker
- [ ] Test with fixed baseline chunker
- [ ] Verify metrics match code-chunk's eval results

---

## 10. Expected Results

Based on code-chunk's existing eval:

| Chunker | nDCG@5 | nDCG@10 | Recall@5 | Recall@10 |
|---------|--------|---------|----------|-----------|
| AST (code-chunk) | ~0.75 | ~0.82 | ~0.65 | ~0.78 |
| Fixed baseline | ~0.55 | ~0.62 | ~0.45 | ~0.58 |

Validate memorybench implementation produces similar numbers.
