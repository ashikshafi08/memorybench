# Phase 5: RepoBench-R Benchmark Implementation

## Overview

This document provides comprehensive implementation details for adding RepoBench-R benchmark support to memorybench.

**Estimated Effort**: 4-5 hours
**Priority**: P1 (Second benchmark after RepoEval)
**Paper**: RepoBench: Benchmarking Repository-Level Code Auto-Completion Systems (ICLR 2024)

---

## 1. Dataset Structure

### HuggingFace Location
```
tianyang/repobench-r
```

### Subsets and Splits

| Subset | Splits | Total Samples |
|--------|--------|---------------|
| `python_cff` (cross-file first) | train_easy (24k), train_hard (24k), test_easy (8k), test_hard (8k) | 64,000 |
| `python_cfr` (cross-file random) | train_easy, train_hard, test_easy, test_hard | 32,000 |
| `java_cff` | train_easy, train_hard, test_easy, test_hard | 64,000 |
| `java_cfr` | train_easy, train_hard, test_easy, test_hard | 32,000 |

**Total**: ~192,000 samples across Python and Java

### Task Difficulty
- **Easy**: 5-9 candidate snippets to retrieve from
- **Hard**: 10+ candidate snippets to retrieve from

---

## 2. Dataset Schema

```typescript
interface RepoBenchRSample {
  repo_name: string;           // e.g., "sastix/cms", "DLYuanGod/TinyGPT-V"
  file_path: string;           // e.g., "server/src/main/.../ZipHandlerServiceImpl.java"
  context: string[];           // Array of code snippet strings (candidates)
  import_statement: string;    // Import statements for context
  code: string;                // Code before the target line
  next_line: string;           // The line to predict
  gold_snippet_index: number;  // Index of correct snippet in context array (0-based)
}
```

### Sample Data

```json
{
  "repo_name": "DLYuanGod/TinyGPT-V",
  "file_path": "minigpt4/processors/blip_processors.py",
  "context": [
    "class Registry:\n    def register_builder(cls, name):\n        def wrap(builder_cls):...",
    "class BlipImageEvalProcessor:\n    def __init__(self, image_size=384):...",
    "..."
  ],
  "import_statement": "from minigpt4.common.registry import registry\nimport torch...",
  "code": "class BlipCaptionProcessor(BaseProcessor):\n    def __init__(self, prompt=''):\n        self.prompt = prompt\n\n    def __call__(self, caption):\n",
  "next_line": "        return self.prompt + self.pre_caption(caption)",
  "gold_snippet_index": 0
}
```

---

## 3. Ground Truth Definition

### Critical Challenge: Content-Based Matching

Unlike RepoEval where we have line ranges, RepoBench-R provides a `gold_snippet_index` pointing to the correct snippet in their pre-defined `context` array. **When we chunk the repository ourselves, our chunk indices won't match theirs.**

**Solution**: Content-based matching using Jaccard text similarity.

```typescript
interface GroundTruth {
  type: 'content_match';
  goldSnippetText: string;      // The actual gold snippet content
  goldSnippetIndex: number;     // Original index (for reference only)
  matchThreshold: number;       // Jaccard similarity threshold (0.7 recommended)
}

/**
 * Compute Jaccard similarity between two code snippets
 * Uses token-level matching for robustness to whitespace differences
 */
function computeJaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.split(/\s+/).filter(Boolean));

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Check if a retrieved chunk matches the ground truth
 */
function isChunkRelevant(
  chunk: { text: string },
  goldSnippet: string,
  threshold = 0.7
): boolean {
  return computeJaccardSimilarity(chunk.text, goldSnippet) >= threshold;
}
```

### Alternative: Line-Based Fallback

For cases where Jaccard matching is unreliable:

```typescript
/**
 * Extract key identifiers for matching
 * Useful when whitespace/formatting differs significantly
 */
function extractIdentifiers(code: string): Set<string> {
  const identifierPattern = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
  const matches = code.match(identifierPattern) || [];
  // Filter out common keywords
  const keywords = new Set(['if', 'else', 'for', 'while', 'return', 'class', 'def', 'import', 'from']);
  return new Set(matches.filter(m => !keywords.has(m)));
}

function identifierOverlap(a: string, b: string): number {
  const idsA = extractIdentifiers(a);
  const idsB = extractIdentifiers(b);

  let intersection = 0;
  for (const id of idsA) {
    if (idsB.has(id)) intersection++;
  }

  return idsA.size > 0 ? intersection / idsA.size : 0;
}
```

---

## 4. Benchmark Config (YAML)

```yaml
# benchmarks/configs/repobench-r.yaml
name: repobench-r
displayName: "RepoBench-R"
description: "Repository-level code retrieval benchmark from RepoBench (ICLR 2024)"
version: "1.0"
source: "https://github.com/Leolty/repobench"
paper: "https://arxiv.org/abs/2306.03091"
tags:
  - code
  - retrieval
  - python
  - java
  - repository-level
  - cross-file

data:
  type: huggingface
  dataset: "tianyang/repobench-r"
  subset: "python_cff"      # Options: python_cff, python_cfr, java_cff, java_cfr
  split: "test_hard"        # Options: train_easy, train_hard, test_easy, test_hard

schema:
  itemId: "repo_name + ':' + file_path"
  question: "code + import_statement"  # Context for retrieval query
  groundTruth:
    type: "content_match"
    snippetField: "context[gold_snippet_index]"

# Custom pack for code retrieval evaluation
packId: "repobench-r@chunking-v1"

# Evaluation settings
evaluation:
  method: retrieval-content-match
  groundTruth:
    type: content_match
    matchThreshold: 0.7

search:
  defaultLimit: 10
  includeChunks: true

metrics:
  - accuracy_at_1
  - accuracy_at_3
  - accuracy_at_5
  - precision_at_5
  - recall_at_5
  - mrr
```

---

## 5. Loader Implementation

```typescript
// benchmarks/loaders/repobench-r-loader.ts
import { HfInference } from '@huggingface/inference';

interface RepoBenchRTask {
  repo_name: string;
  file_path: string;
  context: string[];
  import_statement: string;
  code: string;
  next_line: string;
  gold_snippet_index: number;
}

interface RepoBenchRBenchmarkItem {
  id: string;
  query: string;
  groundTruth: {
    type: 'content_match';
    goldSnippetText: string;
    goldSnippetIndex: number;
    matchThreshold: number;
  };
  metadata: {
    repoName: string;
    filePath: string;
    nextLine: string;
    language: 'python' | 'java';
    difficulty: 'easy' | 'hard';
    candidateCount: number;
  };
}

export class RepoBenchRLoader {
  private hf: HfInference;

  constructor(private config: {
    subset: 'python_cff' | 'python_cfr' | 'java_cff' | 'java_cfr';
    split: 'train_easy' | 'train_hard' | 'test_easy' | 'test_hard';
    hfToken?: string;
  }) {
    this.hf = new HfInference(config.hfToken);
  }

  /**
   * Load tasks from HuggingFace using datasets library
   */
  async loadTasks(limit?: number): Promise<RepoBenchRTask[]> {
    // Use HuggingFace Hub API to fetch dataset
    const response = await fetch(
      `https://datasets-server.huggingface.co/rows?` +
      `dataset=tianyang/repobench-r&` +
      `config=${this.config.subset}&` +
      `split=${this.config.split}&` +
      `offset=0&` +
      `length=${limit || 100}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch RepoBench-R: ${response.statusText}`);
    }

    const data = await response.json();
    return data.rows.map((row: any) => row.row as RepoBenchRTask);
  }

  /**
   * Convert to memorybench format
   */
  toBenchmarkItems(tasks: RepoBenchRTask[]): RepoBenchRBenchmarkItem[] {
    const language = this.config.subset.startsWith('python') ? 'python' : 'java';
    const difficulty = this.config.split.includes('hard') ? 'hard' : 'easy';

    return tasks.map((task, idx) => {
      // Build query from code context + imports
      const query = `${task.import_statement}\n\n${task.code}`;

      // Get the gold snippet from context array
      const goldSnippetText = task.context[task.gold_snippet_index] || '';

      return {
        id: `${task.repo_name}:${task.file_path}:${idx}`,
        query,
        groundTruth: {
          type: 'content_match' as const,
          goldSnippetText,
          goldSnippetIndex: task.gold_snippet_index,
          matchThreshold: 0.7,
        },
        metadata: {
          repoName: task.repo_name,
          filePath: task.file_path,
          nextLine: task.next_line,
          language,
          difficulty,
          candidateCount: task.context.length,
        },
      };
    });
  }

  /**
   * Get unique repositories from tasks
   */
  getRepositories(tasks: RepoBenchRTask[]): string[] {
    const repos = new Set(tasks.map(t => t.repo_name));
    return Array.from(repos);
  }
}
```

---

## 6. Benchmark Pack Implementation

```typescript
// benchmarks/packs/repobench-r.ts
import type { BenchmarkPack, PackEvaluationResult } from './interface';
import type { BenchmarkItem, SearchResult } from '../../core/types';

export class RepoBenchRPack implements BenchmarkPack {
  readonly benchmarkName = 'repobench-r';
  readonly packId = 'repobench-r@chunking-v1';

  readonly sealedSemantics = {
    prompts: true,      // Use code as query
    scoring: true,      // Content-match scoring
    relevance: true,    // Jaccard-based relevance
  };

  private matchThreshold = 0.7;

  /**
   * Build query for retrieval (code + imports as query)
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
      goldSnippetText: string;
      matchThreshold: number;
    };

    // Find best matching chunk
    let bestMatch = 0;
    let bestRank = -1;

    for (let i = 0; i < input.retrieved.length; i++) {
      const similarity = this.computeJaccardSimilarity(
        input.retrieved[i].content,
        groundTruth.goldSnippetText
      );

      if (similarity > bestMatch) {
        bestMatch = similarity;
        if (similarity >= groundTruth.matchThreshold && bestRank === -1) {
          bestRank = i + 1; // 1-indexed rank
        }
      }
    }

    const found = bestRank > 0;
    const score = found ? 1 : 0;

    return {
      answer: `Best match at rank ${bestRank} with similarity ${bestMatch.toFixed(3)}`,
      score,
      correct: found,
      judgeResponse: undefined,
      details: {
        bestSimilarity: bestMatch,
        foundRank: bestRank,
        threshold: groundTruth.matchThreshold,
      },
    };
  }

  /**
   * Check if a retrieved chunk matches the gold snippet
   */
  isRelevant(input: {
    item: BenchmarkItem;
    result: SearchResult;
  }): boolean {
    const groundTruth = input.item.metadata?.groundTruth as {
      goldSnippetText: string;
      matchThreshold: number;
    };

    if (!groundTruth?.goldSnippetText) return false;

    const similarity = this.computeJaccardSimilarity(
      input.result.content,
      groundTruth.goldSnippetText
    );

    return similarity >= (groundTruth.matchThreshold || this.matchThreshold);
  }

  /**
   * Jaccard similarity for code snippets
   */
  private computeJaccardSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.split(/\s+/).filter(Boolean));
    const tokensB = new Set(b.split(/\s+/).filter(Boolean));

    let intersection = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) intersection++;
    }

    const union = tokensA.size + tokensB.size - intersection;
    return union > 0 ? intersection / union : 0;
  }

  private hash(text: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(text).digest('hex');
  }
}
```

---

## 7. Repository Handling

### Option A: Use Pre-Chunked Context (Simpler)

RepoBench-R provides `context` array with candidate snippets. For a fair chunking comparison:

```typescript
/**
 * Strategy: Use RepoBench's candidates but RE-CHUNK the gold snippet
 *
 * This tests whether our chunker would produce similar boundaries
 * to the gold snippet provided by RepoBench.
 */
interface ChunkingComparisonResult {
  goldSnippet: string;
  ourChunks: Array<{
    text: string;
    similarity: number;
  }>;
  bestMatchSimilarity: number;
}
```

### Option B: Clone and Chunk Repositories (Full Evaluation)

For complete chunking evaluation, clone repositories and chunk from scratch:

```typescript
import simpleGit from 'simple-git';
import { chunk } from 'code-chunk';

async function prepareRepository(repoName: string): Promise<string[]> {
  const targetDir = `/tmp/repobench-repos/${repoName.replace('/', '_')}`;
  const git = simpleGit();

  // Clone if not exists
  if (!existsSync(targetDir)) {
    await git.clone(`https://github.com/${repoName}.git`, targetDir);
  }

  // Get all Python/Java files
  const ext = repoName.includes('java') ? '*.java' : '*.py';
  const files = await glob(`${targetDir}/**/${ext}`);

  return files;
}

async function chunkRepository(
  files: string[],
  chunker: Chunker
): Promise<Map<string, Chunk[]>> {
  const result = new Map();

  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const chunks = await chunker.chunk(file, content);
    result.set(file, chunks);
  }

  return result;
}
```

---

## 8. Accuracy Metrics for RepoBench-R

RepoBench-R uses Accuracy@K (hit rate) rather than nDCG:

```typescript
/**
 * Accuracy@K for RepoBench-R style evaluation
 *
 * Measures: Is the gold snippet in the top-K retrieved results?
 */
export class AccuracyAtKMetric implements MetricCalculator {
  readonly name: string;
  private readonly k: number;

  constructor(k: number) {
    this.k = k;
    this.name = `accuracy_at_${k}`;
  }

  compute(results: EvalResult[]): MetricResult {
    if (results.length === 0) {
      return { name: this.name, value: 0 };
    }

    let hits = 0;

    for (const result of results) {
      const topK = result.retrievedContext.slice(0, this.k);
      const groundTruth = result.metadata?.groundTruth;

      if (!groundTruth) continue;

      // Check if any of top-K matches the gold snippet
      const hasHit = topK.some(chunk =>
        this.isMatch(chunk.content, groundTruth.goldSnippetText)
      );

      if (hasHit) hits++;
    }

    return {
      name: this.name,
      value: hits / results.length,
      details: {
        hits,
        total: results.length,
        k: this.k,
      },
    };
  }

  private isMatch(retrieved: string, gold: string, threshold = 0.7): boolean {
    // Jaccard similarity
    const tokensA = new Set(retrieved.split(/\s+/).filter(Boolean));
    const tokensB = new Set(gold.split(/\s+/).filter(Boolean));

    let intersection = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) intersection++;
    }

    const union = tokensA.size + tokensB.size - intersection;
    return (union > 0 ? intersection / union : 0) >= threshold;
  }
}
```

---

## 9. CLI Usage

```bash
# List RepoBench-R benchmark
memorybench list --benchmarks

# Run evaluation on Python (hard difficulty)
memorybench eval \
  --benchmarks repobench-r \
  --providers code-chunk-ast,code-chunk-fixed \
  --metrics accuracy_at_1 accuracy_at_5 mrr \
  --config subset=python_cff,split=test_hard \
  --limit 100

# Run on Java
memorybench eval \
  --benchmarks repobench-r \
  --providers code-chunk-ast \
  --config subset=java_cff,split=test_hard \
  --limit 100
```

---

## 10. Implementation Checklist

- [ ] Create `benchmarks/configs/repobench-r.yaml`
- [ ] Create `benchmarks/loaders/repobench-r-loader.ts`
- [ ] Create `benchmarks/packs/repobench-r.ts`
- [ ] Add HuggingFace Hub API integration
- [ ] Implement Jaccard similarity matching
- [ ] Add `AccuracyAtKMetric` class
- [ ] Register pack in `benchmarks/packs/index.ts`
- [ ] Test with Python subset (easier to verify)
- [ ] Test with Java subset
- [ ] Verify metrics match paper's baselines

---

## 11. Expected Results

Based on RepoBench paper (ICLR 2024):

| Model/Method | Acc@1 (Easy) | Acc@1 (Hard) | Acc@5 (Hard) |
|--------------|--------------|--------------|--------------|
| UniXcoder | ~45% | ~25% | ~55% |
| CodeBERT | ~40% | ~20% | ~48% |
| BM25 | ~35% | ~18% | ~42% |

Validate memorybench implementation produces similar relative ordering.

---

## 12. Key Differences from RepoEval

| Aspect | RepoEval | RepoBench-R |
|--------|----------|-------------|
| Ground Truth | Line ranges | Content match |
| Metric Focus | nDCG, Recall | Accuracy@K |
| Languages | Python only | Python + Java |
| Sample Size | ~455-1600 | ~192,000 |
| Repository Access | Local files | HuggingFace |
| Matching Strategy | Line overlap | Jaccard similarity |
