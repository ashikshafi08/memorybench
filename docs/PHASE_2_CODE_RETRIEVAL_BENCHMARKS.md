# Phase 2: Code Retrieval Benchmarks for memorybench

## Overview

This document outlines the implementation plan for adding code retrieval benchmarks to memorybench to evaluate code chunking strategies (code-chunk, Chonkie, Fixed chunkers).

### Target Benchmarks

| Benchmark | Datasets | Languages | Primary Use |
|-----------|----------|-----------|-------------|
| **CoIR** | 10 datasets | 14+ languages | Comprehensive code retrieval |
| **CodeSearchNet** | 6 language sets | Python, Java, JS, PHP, Ruby, Go | Text-to-code retrieval |
| **RepoBench** | 2 settings | Python, Java | Repository-level retrieval |

### Primary Metric

**nDCG@10** (implemented in Phase 1) - the gold standard for code retrieval evaluation, used by CoIR, MTEB, and BEIR.

---

## 1. CoIR Benchmark

### Academic Reference

**CoIR: A Comprehensive Benchmark for Code Information Retrieval Models** (2024)
- Paper: [arXiv:2407.02883](https://arxiv.org/abs/2407.02883)
- Hugging Face: [CoIR-Retrieval](https://huggingface.co/CoIR-Retrieval)
- GitHub: [CoIR-team/coir](https://github.com/CoIR-team/coir)

### The 10 CoIR Datasets

| # | Dataset | Task Type | Domain | Corpus Size | Languages |
|---|---------|-----------|--------|-------------|-----------|
| 1 | **apps** | Text-to-Code | Code Contest | 9K | Python |
| 2 | **cosqa** | Text-to-Code | Web Query | 21K | Python |
| 3 | **synthetic-text2sql** | Text-to-Code | Database | 106K | SQL |
| 4 | **codesearchnet** | Code-to-Text | GitHub | 1M | 6 languages |
| 5 | **codesearchnet-ccr** | Code-to-Code | GitHub | 1M | 6 languages |
| 6 | **codetrans-dl** | Code-to-Code | Deep Learning | 816 | Python |
| 7 | **codetrans-contest** | Code-to-Code | Contest | 1K | C++, Python |
| 8 | **stackoverflow-qa** | Hybrid | Stack Overflow | 20K | Mixed |
| 9 | **codefeedback-st** | Hybrid | Instruction | 156K | 11+ languages |
| 10 | **codefeedback-mt** | Hybrid | Instruction | 66K | Mixed |

### Data Format (BEIR/MTEB Compatible)

CoIR uses the standard BEIR schema with three components:

#### Corpus (documents/code snippets)
```json
{
  "_id": "doc_123",
  "text": "<code content>",
  "partition": "test",
  "language": "python",
  "title": "Function name",
  "meta_information": {"url": "...", "starter_code": "..."}
}
```

#### Queries (search queries)
```json
{
  "_id": "q_456",
  "text": "Find a function that sorts an array in ascending order",
  "partition": "test",
  "language": "python"
}
```

#### Qrels (relevance judgments)
```json
{
  "query-id": "q_456",
  "corpus-id": "doc_123",
  "score": 1
}
```

### Access via Hugging Face

```python
from datasets import load_dataset

# Load corpus
corpus = load_dataset("CoIR-Retrieval/apps", "corpus")

# Load queries
queries = load_dataset("CoIR-Retrieval/apps", "queries")

# Load qrels (relevance judgments)
qrels = load_dataset("CoIR-Retrieval/apps", "default")
```

---

## 2. CodeSearchNet Benchmark

### Academic Reference

**CodeSearchNet Challenge: Evaluating the State of Semantic Code Search** (2019)
- Paper: [arXiv:1909.09436](https://arxiv.org/abs/1909.09436)
- GitHub: [github/CodeSearchNet](https://github.com/github/CodeSearchNet)

### Data Format (JSONL)

```json
{
  "code": "def sort_array(arr):\n    return sorted(arr)",
  "docstring": "Sort an array in ascending order",
  "code_tokens": ["def", "sort_array", "(", "arr", ")", "..."],
  "docstring_tokens": ["Sort", "an", "array", "..."],
  "func_name": "sort_array",
  "repo": "owner/repo-name",
  "path": "src/utils/sorting.py",
  "language": "python",
  "url": "https://github.com/..."
}
```

### Key Characteristics

| Property | Value |
|----------|-------|
| **Size** | ~2 million (code, docstring) pairs |
| **Languages** | Python, JavaScript, Java, PHP, Ruby, Go |
| **Task** | Natural language → Code retrieval |
| **Evaluation** | 99 hand-crafted queries with human relevance (0-3 scale) |

### Access Methods

```python
# Via Hugging Face
from datasets import load_dataset
dataset = load_dataset("code-search-net/code_search_net", "python")

# Direct S3 download
# https://s3.amazonaws.com/code-search-net/CodeSearchNet/v2/{language}.zip
```

---

## 3. RepoBench Benchmark

### Academic Reference

**RepoBench: Benchmarking Repository-Level Code Auto-Completion Systems** (2023)
- Paper: [arXiv:2306.03091](https://arxiv.org/abs/2306.03091)
- GitHub: [Leolty/repobench](https://github.com/Leolty/repobench)

### Three Tasks

| Task | Description | Relevance to Chunking |
|------|-------------|----------------------|
| **RepoBench-R** | Retrieve relevant cross-file context | **Primary** - tests chunking quality |
| **RepoBench-C** | Code completion with given context | Secondary |
| **RepoBench-P** | Pipeline (retrieval + completion) | End-to-end |

### Data Format

```python
{
  "repo_name": "owner/repo",
  "file_path": "src/utils.py",
  "context": "<surrounding code>",
  "import_statement": "from utils import helper",
  "cross_file_context": "<relevant code from other files>",
  "next_line": "<line to predict>",
  "language": "python"
}
```

### Access

```python
from datasets import load_dataset

# Python
python_data = load_dataset("tianyang/repobench_python_v1.1")

# Java
java_data = load_dataset("tianyang/repobench_java_v1.1")
```

---

## Implementation Plan for memorybench

### 1. Benchmark Loader Architecture

memorybench already has a flexible loader system in `benchmarks/loaders/`. We need to add CoIR/BEIR-compatible loaders.

#### File Structure

```
memorybench/
├── benchmarks/
│   ├── loaders/
│   │   ├── coir.ts          # NEW: CoIR dataset loader
│   │   ├── codesearchnet.ts # NEW: CodeSearchNet loader
│   │   ├── repobench.ts     # NEW: RepoBench loader
│   │   └── beir-schema.ts   # NEW: Shared BEIR schema types
│   └── packs/
│       ├── coir/            # NEW: CoIR benchmark packs
│       │   ├── apps.ts
│       │   ├── cosqa.ts
│       │   └── index.ts
│       ├── codesearchnet/   # NEW: CodeSearchNet pack
│       └── repobench/       # NEW: RepoBench pack
```

### 2. BEIR Schema Types

```typescript
// benchmarks/loaders/beir-schema.ts

/**
 * BEIR/MTEB/CoIR standard schema types.
 * Used by CoIR, MTEB retrieval tasks, and BEIR benchmark.
 */

export interface BEIRCorpusItem {
  _id: string;
  text: string;
  title?: string;
  partition?: "train" | "dev" | "test";
  language?: string;
  meta_information?: Record<string, unknown>;
}

export interface BEIRQueryItem {
  _id: string;
  text: string;
  partition?: "train" | "dev" | "test";
  language?: string;
  meta_information?: Record<string, unknown>;
}

export interface BEIRQrel {
  "query-id": string;
  "corpus-id": string;
  score: number; // Typically 0 or 1 for binary relevance
}

export interface BEIRDataset {
  corpus: BEIRCorpusItem[];
  queries: BEIRQueryItem[];
  qrels: BEIRQrel[];
}
```

### 3. CoIR Loader Implementation

```typescript
// benchmarks/loaders/coir.ts

import type { BenchmarkItem } from "../interface.ts";
import type { BEIRDataset, BEIRQrel } from "./beir-schema.ts";

/**
 * CoIR dataset names matching Hugging Face repository names.
 */
export const COIR_DATASETS = [
  "apps",
  "cosqa",
  "synthetic-text2sql",
  "codesearchnet",
  "codesearchnet-ccr",
  "codetrans-dl",
  "codetrans-contest",
  "stackoverflow-qa",
  "codefeedback-st",
  "codefeedback-mt",
] as const;

export type CoIRDatasetName = (typeof COIR_DATASETS)[number];

/**
 * Load a CoIR dataset from Hugging Face.
 *
 * @param datasetName - One of the 10 CoIR dataset names
 * @param options - Loading options (split, limit, etc.)
 */
export async function loadCoIRDataset(
  datasetName: CoIRDatasetName,
  options: {
    split?: "train" | "dev" | "test";
    limit?: number;
    cacheDir?: string;
  } = {},
): Promise<{
  items: BenchmarkItem[];
  corpus: Map<string, string>;
  qrels: Map<string, Set<string>>;
}> {
  const { split = "test", limit, cacheDir } = options;

  // Download from Hugging Face using existing download infrastructure
  const baseUrl = `https://huggingface.co/datasets/CoIR-Retrieval/${datasetName}`;

  // Load corpus, queries, qrels (implementation details below)
  const corpus = await loadParquet(`${baseUrl}/corpus`);
  const queries = await loadParquet(`${baseUrl}/queries`);
  const qrels = await loadParquet(`${baseUrl}/default`);

  // Build qrels lookup: query_id -> Set<corpus_ids>
  const qrelsMap = new Map<string, Set<string>>();
  for (const qrel of qrels) {
    if (qrel.score > 0) {
      const existing = qrelsMap.get(qrel["query-id"]) ?? new Set();
      existing.add(qrel["corpus-id"]);
      qrelsMap.set(qrel["query-id"], existing);
    }
  }

  // Build corpus lookup: corpus_id -> text
  const corpusMap = new Map<string, string>();
  for (const doc of corpus) {
    corpusMap.set(doc._id, doc.text);
  }

  // Convert to BenchmarkItems
  const items: BenchmarkItem[] = queries
    .filter((q) => q.partition === split || !q.partition)
    .slice(0, limit)
    .map((query) => {
      const relevantIds = qrelsMap.get(query._id) ?? new Set();
      return {
        id: query._id,
        question: query.text,
        answer: "", // Retrieval task - no answer, use qrels
        contexts: [], // Will be populated during evaluation
        metadata: {
          language: query.language,
          relevantIds: Array.from(relevantIds),
          dataset: datasetName,
          taskType: getTaskType(datasetName),
        },
      };
    });

  return { items, corpus: corpusMap, qrels: qrelsMap };
}

function getTaskType(dataset: CoIRDatasetName): string {
  const taskTypes: Record<CoIRDatasetName, string> = {
    apps: "text-to-code",
    cosqa: "text-to-code",
    "synthetic-text2sql": "text-to-code",
    codesearchnet: "code-to-text",
    "codesearchnet-ccr": "code-to-code",
    "codetrans-dl": "code-to-code",
    "codetrans-contest": "code-to-code",
    "stackoverflow-qa": "hybrid",
    "codefeedback-st": "hybrid",
    "codefeedback-mt": "hybrid",
  };
  return taskTypes[dataset];
}
```

### 4. CoIR Benchmark Pack

```typescript
// benchmarks/packs/coir/apps.ts

import { definePack } from "../define.ts";
import { loadCoIRDataset } from "../../loaders/coir.ts";

export const appsPack = definePack({
  name: "coir-apps",
  description: "CoIR APPS dataset - Code contest text-to-code retrieval",

  sealedSemantics: {
    relevance: true, // Use qrels for relevance, not token matching
  },

  async load(options) {
    const { items, corpus, qrels } = await loadCoIRDataset("apps", {
      split: options?.split ?? "test",
      limit: options?.limit,
    });

    return {
      items,
      metadata: {
        corpus,
        qrels,
        taskType: "text-to-code",
        languages: ["python"],
      },
    };
  },

  isRelevant({ item, result }) {
    const relevantIds = item.metadata?.relevantIds as string[] | undefined;
    if (!relevantIds) return false;
    return relevantIds.includes(result.id);
  },
});
```

### 5. Dataset Download & Caching

Extend existing `benchmarks/loaders/download.ts`:

```typescript
// Add Hugging Face parquet support

export interface HuggingFaceSource {
  type: "huggingface";
  repo: string;       // e.g., "CoIR-Retrieval/apps"
  config?: string;    // e.g., "corpus", "queries", "default"
  split?: string;     // e.g., "train", "test"
}

/**
 * Download parquet files from Hugging Face datasets.
 * Uses the datasets library format with automatic caching.
 */
export async function downloadHuggingFaceDataset(
  source: HuggingFaceSource,
  cacheDir = "~/.memorybench/datasets/huggingface",
): Promise<string> {
  const { repo, config = "default", split = "train" } = source;

  // Construct parquet URL
  // Format: https://huggingface.co/datasets/{repo}/resolve/main/{config}/{split}-00000-of-00001.parquet
  const baseUrl = `https://huggingface.co/datasets/${repo}/resolve/main`;
  const parquetUrl = `${baseUrl}/${config}/${split}-00000-of-00001.parquet`;

  // Download with caching (reuse existing download infrastructure)
  const cachePath = path.join(cacheDir, repo, config, `${split}.parquet`);

  if (await fileExists(cachePath)) {
    return cachePath;
  }

  await downloadFile(parquetUrl, cachePath);
  return cachePath;
}
```

### 6. Parquet Reader

memorybench needs parquet reading capability. Options:

#### Option A: Use `parquetjs` (Pure JS)
```typescript
import parquet from "parquetjs";

async function loadParquet<T>(filePath: string): Promise<T[]> {
  const reader = await parquet.ParquetReader.openFile(filePath);
  const cursor = reader.getCursor();
  const records: T[] = [];

  let record = null;
  while ((record = await cursor.next())) {
    records.push(record as T);
  }

  await reader.close();
  return records;
}
```

#### Option B: Convert to JSON on download (simpler)
```typescript
// Use Python to convert parquet to JSON during download
async function downloadAndConvertParquet(url: string, outputPath: string) {
  const parquetPath = outputPath.replace(".json", ".parquet");
  await downloadFile(url, parquetPath);

  // Convert with Python
  await Bun.spawn([
    "python3", "-c", `
import pandas as pd
import json
df = pd.read_parquet("${parquetPath}")
df.to_json("${outputPath}", orient="records", lines=True)
`
  ]).exited;
}
```

**Recommendation**: Option B is simpler and avoids adding a parquet dependency. The conversion happens once on download.

---

## Evaluation Flow

### How Code Retrieval Benchmarks Work

```
┌─────────────────────────────────────────────────────────────┐
│                    EVALUATION FLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Load Benchmark                                          │
│     ┌────────────┐    ┌────────────┐    ┌────────────┐     │
│     │   Corpus   │    │  Queries   │    │   Qrels    │     │
│     │ (code docs)│    │  (NL text) │    │(relevance) │     │
│     └─────┬──────┘    └─────┬──────┘    └─────┬──────┘     │
│           │                 │                 │             │
│  2. Chunk & Embed Corpus    │                 │             │
│     ┌─────▼──────┐          │                 │             │
│     │  Chunker   │ ◄─── code-chunk / Chonkie / Fixed       │
│     │ (AST/Fixed)│                            │             │
│     └─────┬──────┘                            │             │
│           │                                   │             │
│     ┌─────▼──────┐                            │             │
│     │  Embedder  │ ◄─── OpenAI / Voyage / Nomic            │
│     └─────┬──────┘                            │             │
│           │                                   │             │
│     ┌─────▼──────┐                            │             │
│     │ Vector DB  │                            │             │
│     └─────┬──────┘                            │             │
│           │                                   │             │
│  3. Query & Retrieve        │                 │             │
│           │      ┌──────────┘                 │             │
│           │      │                            │             │
│     ┌─────▼──────▼─────┐                      │             │
│     │ Embed Query &    │                      │             │
│     │ Retrieve Top-K   │                      │             │
│     └─────────┬────────┘                      │             │
│               │                               │             │
│  4. Evaluate  │                               │             │
│     ┌─────────▼────────┐    ┌────────────────┘             │
│     │  Compare to      │◄───┤                              │
│     │  Ground Truth    │    │                              │
│     └─────────┬────────┘                                   │
│               │                                             │
│     ┌─────────▼────────┐                                   │
│     │  Compute Metrics │                                   │
│     │  nDCG@10, MAP,   │                                   │
│     │  Recall@K, etc.  │                                   │
│     └──────────────────┘                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Difference from Memory Benchmarks

| Aspect | Memory Benchmarks | Code Retrieval Benchmarks |
|--------|-------------------|---------------------------|
| **Relevance** | Token F1 matching | Ground-truth qrels (IDs) |
| **Answer** | Expected text response | N/A (retrieval only) |
| **Corpus** | Pre-chunked contexts | Raw code to be chunked |
| **Goal** | Find context for QA | Find relevant code |
| **Primary Metric** | Success@K, Accuracy | nDCG@10 |

---

## Priority Implementation Order

### Phase 2a: Core Infrastructure (Week 1)

1. **Add BEIR schema types** (`beir-schema.ts`)
2. **Add parquet loading** (via Python conversion or parquetjs)
3. **Add Hugging Face download support** (extend `download.ts`)

### Phase 2b: CoIR Integration (Week 2)

1. **Implement CoIR loader** (`coir.ts`)
2. **Add CoIR benchmark packs** (start with `apps` and `cosqa`)
3. **Test with existing nDCG metric**

### Phase 2c: Additional Benchmarks (Week 3)

1. **Add CodeSearchNet loader** (`codesearchnet.ts`)
2. **Add RepoBench loader** (`repobench.ts`)
3. **Create unified evaluation runner**

---

## CLI Usage (Target API)

```bash
# Run CoIR benchmark with code-chunk
memorybench eval \
  --benchmark coir-apps \
  --provider code-chunk \
  --metrics ndcg_at_10 recall_at_10 precision_at_10 \
  --limit 100

# Compare chunkers on CodeSearchNet
memorybench eval \
  --benchmark codesearchnet-python \
  --providers code-chunk,chonkie,fixed-500 \
  --metrics ndcg_at_10 \
  --output results/codesearchnet-comparison.json

# Full matrix evaluation
memorybench eval \
  --benchmarks coir-apps,coir-cosqa,codesearchnet-python \
  --providers code-chunk,chonkie,fixed-500,fixed-1000 \
  --embeddings openai-small,voyage-code-3,nomic-embed-code \
  --metrics ndcg_at_5 ndcg_at_10 recall_at_10 mrr \
  --output results/full-matrix.json
```

---

## Testing Plan

### Unit Tests

```typescript
// test/benchmarks/loaders/coir.test.ts

describe("CoIR Loader", () => {
  it("loads apps dataset with correct schema", async () => {
    const { items, corpus, qrels } = await loadCoIRDataset("apps", { limit: 10 });

    expect(items.length).toBe(10);
    expect(items[0].metadata.relevantIds).toBeDefined();
    expect(corpus.size).toBeGreaterThan(0);
  });

  it("builds correct qrels mapping", async () => {
    const { qrels } = await loadCoIRDataset("apps", { limit: 10 });

    // Each query should have at least one relevant document
    for (const [queryId, relevantIds] of qrels) {
      expect(relevantIds.size).toBeGreaterThan(0);
    }
  });
});
```

### Integration Tests

```bash
# Test end-to-end with small dataset
bun run cli eval \
  --benchmark coir-cosqa \
  --provider aqrag \
  --metrics ndcg_at_10 \
  --limit 5 \
  --verbose
```

---

## Dependencies

### Required

| Package | Purpose | Version |
|---------|---------|---------|
| None | Uses existing memorybench infrastructure | - |

### Optional (for parquet support)

| Package | Purpose | Notes |
|---------|---------|-------|
| `parquetjs` | Pure JS parquet reader | ~2MB, no native deps |
| `@duckdb/duckdb-wasm` | Fast parquet reader | Larger, but faster |

**Recommendation**: Start with Python conversion on download, add native parquet later if needed.

---

## References

1. **CoIR Paper**: [arXiv:2407.02883](https://arxiv.org/abs/2407.02883)
2. **CodeSearchNet Paper**: [arXiv:1909.09436](https://arxiv.org/abs/1909.09436)
3. **RepoBench Paper**: [arXiv:2306.03091](https://arxiv.org/abs/2306.03091)
4. **BEIR Benchmark**: [github.com/beir-cellar/beir](https://github.com/beir-cellar/beir)
5. **MTEB Leaderboard**: [huggingface.co/spaces/mteb/leaderboard](https://huggingface.co/spaces/mteb/leaderboard)

---

## Summary

| Task | Files | Effort |
|------|-------|--------|
| BEIR schema types | `beir-schema.ts` | 30 min |
| HuggingFace download support | `download.ts` | 1 hour |
| Parquet loading | `parquet.ts` or Python conversion | 1-2 hours |
| CoIR loader | `coir.ts` | 2 hours |
| CoIR packs (10 datasets) | `packs/coir/*.ts` | 3 hours |
| CodeSearchNet loader + pack | `codesearchnet.ts`, pack | 2 hours |
| RepoBench loader + pack | `repobench.ts`, pack | 2 hours |
| Tests | `*.test.ts` | 2 hours |
| **Total** | | **~14 hours** |
