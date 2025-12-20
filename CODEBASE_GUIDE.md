# CodeChunkBench: AI Agent Navigation Guide

> A comprehensive guide for AI agents to understand, navigate, and contribute to the CodeChunkBench codebase.

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Directory Structure](#3-directory-structure)
4. [Core Data Types](#4-core-data-types)
5. [Key Modules Deep Dive](#5-key-modules-deep-dive)
6. [Execution Flow](#6-execution-flow)
7. [Implementation Status](#7-implementation-status)
8. [Known Issues & Bugs](#8-known-issues--bugs)
9. [How to Extend](#9-how-to-extend)
10. [Quick Reference](#10-quick-reference)

---

## 1. Project Overview

### What Problem Does CodeChunkBench Solve?

**Core Problem**: No standard benchmark exists for comparing code chunking strategies. Existing benchmarks (CoIR, MTEB, CodeSearchNet) test embeddings or use pre-chunked data, NOT chunking quality.

**Solution**: CodeChunkBench measures and compares code chunking strategies for retrieval tasks (the retrieval stage of RAG systems).

**Key Question Answered**: *"Which code chunker should I use for my RAG system?"*

### Target Audience
- RAG System Builders
- LLM/AI Product Teams
- Researchers studying optimal chunking
- Vendors benchmarking their solutions

### Key Differentiators
| Aspect | CodeChunkBench | Others (CoIR/MTEB) |
|--------|----------------|-------------------|
| Focus | Chunking quality | Embedding quality |
| Real Chunking | ✅ Chunks raw repos | ❌ Pre-chunked |
| Chunker-Agnostic | ✅ Any provider | ❌ Fixed |
| Multi-Hop Eval | ✅ Agentic patterns | ❌ Single-query |

---

## 2. Architecture

### High-Level Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CODECHUNKBENCH PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  BENCHMARKS              PROVIDERS           EMBEDDINGS       POLICIES   │
│  ──────────────          ─────────────       ──────────────   ────────   │
│  • RepoEval              • code-chunk-ast    • OpenAI         • 1-hop    │
│  • RepoBench-R      ×    • code-chunk-fixed  • Voyage Code    • H-hop    │
│  • SWE-bench Lite        • chonkie-code                                  │
│  • CrossCodeEval         • chonkie-recursive                             │
│                                                                          │
│         └───────────────────────┬────────────────────────────┘          │
│                                 ▼                                        │
│         ┌────────────────────────────────────────────────────────────┐  │
│         │              EVALUATION ENGINE                              │  │
│         │  • nDCG@K   - Ranking quality                              │  │
│         │  • Recall@K - Coverage                                      │  │
│         │  • MRR      - First relevant hit                           │  │
│         │  • Precision@K, File-Recall@K                              │  │
│         └────────────────────────────────────────────────────────────┘  │
│                                 ▼                                        │
│         ┌────────────────────────────────────────────────────────────┐  │
│         │              RESULTS STORE (SQLite)                         │  │
│         │  • Per-run results with telemetry                          │  │
│         │  • Aggregated metrics                                       │  │
│         │  • Statistical analysis (Bootstrap CI, Cohen's d)          │  │
│         └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Interconnections

```
CLI (cli/index.ts)
    │
    ▼
Registry (core/registry.ts) ─────► Loads YAML configs
    │                              Validates with Zod
    │                              Interpolates env vars
    │
    ├──────────────┬──────────────┐
    ▼              ▼              ▼
Runner         Checkpoint     ResultsStore
(executor)     (resumable)    (SQLite)
    │
    ▼
Provider Interface
    │
    ├─────────────┬─────────────┬─────────────┐
    ▼             ▼             ▼             ▼
REST Hosted   Local Adapter   Docker      GenericChunker
(HttpProvider) (factory.ts)   (compose)   (registry-based)
                                              │
                                              ▼
                                         ChunkerRegistry
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
              code-chunk-ast          chonkie-code              code-chunk-fixed
              (tree-sitter)        (Python bridge)            (character windows)
```

---

## 3. Directory Structure

```
memorybench-bench-code-chunk/
├── cli/                          # Command-line interface
│   ├── index.ts                  # Main CLI entry point
│   └── table.ts                  # Results table formatter
│
├── core/                         # Core evaluation engine
│   ├── config.ts                 # Zod schemas for all configs
│   ├── runner.ts                 # BenchmarkRunner orchestration
│   ├── results.ts                # SQLite ResultsStore
│   ├── registry.ts               # Provider/benchmark discovery
│   ├── checkpoint.ts             # Resumable run state
│   ├── sealed-semantics.ts       # Pack vs YAML conflict detection
│   ├── metrics/                  # Metric calculators
│   │   ├── interface.ts          # MetricCalculator interface
│   │   ├── registry.ts           # MetricRegistry singleton
│   │   └── builtin/              # 21+ built-in metrics
│   │       ├── ndcg.ts           # nDCG@K
│   │       ├── precision.ts      # Precision@K
│   │       ├── recall.ts         # Recall@K
│   │       ├── mrr.ts            # Mean Reciprocal Rank
│   │       ├── file-recall.ts    # File-level recall
│   │       └── file-mrr.ts       # File-level MRR
│   ├── analysis/                 # Statistical analysis
│   │   └── statistics.ts         # Bootstrap CI, t-test, Cohen's d
│   └── types/                    # Shared TypeScript types
│
├── providers/                    # Chunker/retrieval providers
│   ├── factory.ts                # Provider creation from config
│   ├── base/                     # Base classes & interfaces
│   │   ├── types.ts              # Provider interface
│   │   ├── http-provider.ts      # Generic HTTP adapter
│   │   └── local-provider.ts     # Abstract local base
│   ├── adapters/                 # Provider implementations
│   │   ├── generic-chunker.ts    # Unified chunker dispatcher
│   │   ├── chunker-registry.ts   # Chunker registration
│   │   ├── chunking-base.ts      # Chunk + embed + store
│   │   ├── chonkie-bridge.ts     # Python subprocess bridge
│   │   └── full-context.ts       # Baseline providers
│   ├── embeddings/               # Embedding providers
│   │   ├── core.ts               # Interface & cache
│   │   └── providers.ts          # OpenAI, Voyage implementations
│   └── configs/                  # YAML provider configs
│       ├── code-chunk-ast.yaml
│       ├── code-chunk-fixed.yaml
│       ├── chonkie-code.yaml
│       └── chonkie-recursive.yaml
│
├── benchmarks/                   # Benchmark definitions
│   ├── index.ts                  # Benchmark registry
│   ├── packs/                    # Sealed benchmark implementations
│   │   ├── interface.ts          # BenchmarkPack interface
│   │   ├── index.ts              # Pack registry
│   │   ├── relevance.ts          # Ground-truth matchers (CRITICAL)
│   │   ├── generic-code-retrieval-pack.ts  # Factory for code benchmarks
│   │   ├── longmemeval.ts        # LongMemEval pack
│   │   └── locomo.ts             # LoCoMo pack
│   ├── loaders/                  # Data loading
│   │   ├── loader.ts             # Schema mapping
│   │   ├── generic-loader.ts     # Code retrieval loader
│   │   └── download/
│   │       └── dataset-registry.ts  # HuggingFace integration
│   ├── evaluators/
│   │   └── llm-judge.ts          # LLM evaluation
│   └── configs/                  # YAML benchmark configs
│       ├── repoeval.yaml
│       ├── repobench-r.yaml
│       └── swebench-lite.yaml
│
├── docs/                         # Phase documentation
│   ├── CODECHUNKBENCH_OVERVIEW.md
│   ├── PHASE_1_RETRIEVAL_METRICS.md
│   ├── PHASE_2_CODE_RETRIEVAL_BENCHMARKS.md
│   ├── PHASE_3_DATASET_VALIDATION.md
│   ├── PHASE_4_REPOEVAL_IMPLEMENTATION.md
│   ├── PHASE_5_REPOBENCH_R_IMPLEMENTATION.md
│   ├── PHASE_6_SWEBENCH_LITE_IMPLEMENTATION.md
│   ├── PHASE_7_CHUNKER_PROVIDERS.md
│   ├── PHASE_8_EMBEDDING_SUPPORT.md
│   └── PHASE_9_MULTI_HOP_BENCHMARK.md
│
├── results/                      # SQLite database
│   └── results.db
│
└── checkpoints/                  # Resumable run state
```

---

## 4. Core Data Types

### EvalResult (Primary evaluation record)
```typescript
interface EvalResult {
  runId: string;                    // Unique run identifier
  benchmark: string;                // Benchmark name
  provider: string;                 // Provider name
  itemId: string;                   // Question/item ID
  question: string;                 // Original question
  expected: string;                 // Expected answer
  actual: string;                   // Generated/retrieved answer
  score: number;                    // Score (0-1)
  correct: boolean;                 // Boolean correctness
  retrievedContext: SearchResult[]; // Retrieved chunks
  metadata: Record<string, unknown>; // Telemetry + item metadata
}
```

### SearchResult (Retrieved chunk)
```typescript
interface SearchResult {
  id: string;                       // Chunk ID (e.g., "file.py:10-25")
  content: string;                  // Chunk text
  score: number;                    // Similarity score
  chunks?: Array<{ content: string; score: number }>;
  metadata?: {
    filepath?: string;
    startLine?: number;
    endLine?: number;
    [key: string]: unknown;
  };
}
```

### Provider Interface
```typescript
interface Provider {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  addContext(data: PreparedData, runTag: string): Promise<void>;
  searchQuery(query: string, runTag: string, options?: SearchOptions): Promise<SearchResult[]>;
  clear(runTag: string): Promise<void>;
  initialize?(): Promise<void>;
  cleanup?(): Promise<void>;
}
```

### BenchmarkPack Interface
```typescript
interface BenchmarkPack {
  benchmarkName: string;
  packId: PackId;  // e.g., "repoeval@chunking-v1"

  sealedSemantics: {
    prompts: boolean;    // Pack owns prompts
    scoring: boolean;    // Pack owns scoring
    relevance: boolean;  // Pack owns relevance
  };

  evaluate(input: {
    item: BenchmarkItem;
    retrieved: SearchResult[];
    run: RunConfig;
  }): Promise<PackEvaluationResult>;

  isRelevant(input: {
    item: BenchmarkItem;
    result: SearchResult;
  }): boolean;
}
```

### MetricCalculator Interface
```typescript
interface MetricCalculator {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description?: string;
  compute(results: EvalResult[]): MetricResult;
}

interface MetricResult {
  name: string;
  value: number;
  details?: Record<string, unknown>;
}
```

---

## 5. Key Modules Deep Dive

### 5.1 Relevance Matching (`benchmarks/packs/relevance.ts`)

**CRITICAL FILE** - Contains all ground-truth matching logic.

```typescript
// Path utilities
normalizePath(path: string): string      // Normalize for comparison
pathMatches(path1: string, path2: string): boolean  // Suffix-safe matching

// RepoEval: Line range matching
lineRangeOverlaps(chunk: LineSpan, target: LineSpan): boolean
lineRangeIoU(chunk: LineSpan, target: LineSpan): number
isLocationRelevant(chunkLocation, targetFile, targetSpan?): boolean

// RepoBench-R: Content matching
jaccardSimilarity(a: string, b: string): number  // Token-based
isJaccardMatch(chunkContent, goldContent, threshold = 0.7): boolean

// SWE-bench: File matching
fileMatches(chunkFile: string, modifiedFiles: string[]): boolean
isSWEBenchRelevant(chunkLocation, modifiedFiles, lineRanges?): boolean

// CrossCodeEval: Coverage
crossFileCoverage(retrievedFiles, groundTruthFiles): number
```

### 5.2 Chunker Registry (`providers/adapters/chunker-registry.ts`)

Consolidates 4 chunker implementations into ~120 lines:

```typescript
interface ChunkerDefinition {
  name: string;
  chunkFn: (content, filepath, config) => Promise<ChunkResult[]>;
  preflight?: () => Promise<void>;  // Dependency check
}

// Registered chunkers:
// - code-chunk-ast: AST-aware (tree-sitter)
// - code-chunk-fixed: Character windows
// - chonkie-code: Python semantic
// - chonkie-recursive: Python fallback
```

### 5.3 Generic Chunker Provider (`providers/adapters/generic-chunker.ts`)

Single provider class dispatching to registered chunkers:

```typescript
class GenericChunkerProvider extends ChunkingProvider {
  async doInitialize() {
    // 1. Get chunker from registry by config.name
    // 2. Run preflight check (e.g., Python deps)
  }

  protected async chunkText(content, filepath, config) {
    // Dispatch to registered chunker
    return this.chunker.chunkFn(content, filepath, config);
  }
}
```

### 5.4 Metrics System (`core/metrics/`)

21+ built-in metrics with registry pattern:

**Memory Metrics**: accuracy, f1, bleu_1, rouge_l
**Retrieval Metrics**: ndcg_at_K, precision_at_K, recall_at_K, mrr, file_recall_at_K, file_mrr
**Performance Metrics**: avg_search_latency_ms, p95_latency_ms

### 5.5 Statistical Analysis (`core/analysis/statistics.ts`)

```typescript
bootstrapCI(values, { iterations: 10000, confidence: 0.95 })
  -> { mean, std, lower, upper }

pairedTTest(valuesA, valuesB)
  -> { tStatistic, pValue, df }

cohensD(valuesA, valuesB)
  -> number  // Effect size: <0.2 negligible, 0.2-0.5 small, 0.5-0.8 medium, ≥0.8 large
```

### 5.6 Results Store (`core/results.ts`)

SQLite storage with these tables:

```sql
-- runs: Benchmark run metadata
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  started_at TEXT, completed_at TEXT,
  benchmarks TEXT, providers TEXT, config TEXT
);

-- results: Individual evaluation results
CREATE TABLE results (
  id INTEGER PRIMARY KEY,
  run_id TEXT, benchmark TEXT, provider TEXT,
  item_id TEXT, question TEXT, expected TEXT, actual TEXT,
  score REAL, correct INTEGER,
  retrieved_context TEXT, metadata TEXT,
  created_at TEXT
);
```

---

## 6. Execution Flow

### Running a Benchmark

```bash
# 1. Run evaluation
memorybench eval --benchmarks repoeval --providers code-chunk-ast code-chunk-fixed

# 2. View results table
memorybench table --run <runId> --benchmark repoeval

# 3. Export results
memorybench results --run <runId> --format json
```

### Internal Flow

```
1. CLI parses arguments
2. Registry loads YAML configs + validates
3. BenchmarkRunner creates tasks (benchmark × provider)
4. For each task:
   a. INGEST PHASE:
      - Load benchmark items
      - Chunk content via provider.addContext()
      - Embed and store chunks
   b. EVALUATE PHASE:
      - For each item: provider.searchQuery()
      - Measure latency
      - Compute relevance via pack.isRelevant()
      - Build EvalResult
5. Compute metrics via MetricRegistry
6. Save to ResultsStore (SQLite)
7. Display results table
```

---

## 7. Implementation Status

### Phase Status Matrix

| Phase | Component | Status | Notes |
|-------|-----------|--------|-------|
| **1** | Metric Interface | ✅ Done | 21+ metrics implemented |
| **1** | Metric Registry | ✅ Done | Alias support, validation |
| **2** | Benchmark Design | ✅ Done | 4 benchmarks defined |
| **3** | Dataset Validation | ✅ Done | Ground truth schemas |
| **4** | RepoEval | ✅ Done | Line-range overlap |
| **5** | RepoBench-R | ✅ Done | Jaccard similarity |
| **6** | SWE-bench Lite | ✅ Done | File recall |
| **7** | Chunker Providers | ✅ Done | 4 chunkers registered |
| **8** | Embedding Support | ✅ Done | OpenAI, Voyage |
| **9** | Multi-Hop | ⏳ Pending | Design complete |

### What's Working
- All 4 chunkers (code-chunk-ast, code-chunk-fixed, chonkie-code, chonkie-recursive)
- All 4 benchmarks (RepoEval, RepoBench-R, SWE-bench Lite, CrossCodeEval)
- All retrieval metrics (nDCG, Precision, Recall, MRR, File-Recall, File-MRR)
- Embedding with caching (OpenAI, Voyage)
- Results storage (SQLite)
- CLI table generation with statistics

### What's Pending
- Phase 9: Multi-hop retrieval evaluation
- LlamaIndex/LangChain chunker integrations
- Leaderboard web UI

---

## 8. Known Issues & Bugs

### Critical Bugs

#### 1. Factory.ts Path Resolution (ACTIVE BUG)
**File**: `providers/factory.ts` lines 114-120
**Issue**: Adapter path duplication `./adapters/adapters/generic-chunker.ts`
**Root Cause**: Path manipulation logic can fail when:
- Registry lookup fails unexpectedly
- Config has unexpected adapter path format

**Fix Needed**: Ensure `localAdapterRegistry.get(config.adapter)` or `providerByNameRegistry.get(config.name)` returns before dynamic import fallback.

#### 2. Factory.ts Prototype Check
**File**: `providers/factory.ts` lines 136-141
```typescript
const provider: Provider =
    typeof AdapterClass === "function"
        ? AdapterClass.prototype    // BUG: Always truthy
            ? new AdapterClass(config)
            : await AdapterClass(config)
        : AdapterClass;
```
**Issue**: Never falls back to factory function approach.

### Medium Issues

#### 3. Silent Chunking Failures
**File**: `providers/adapters/chunking-base.ts`
**Issue**: If chunking fails, file is skipped with only warning.
**Impact**: Data loss without error propagation.

#### 4. No Cache TTL
**File**: `providers/embeddings/core.ts`
**Issue**: Embedding cache grows unbounded.

---

## 9. How to Extend

### Adding a New Chunker

1. **Register in chunker-registry.ts**:
```typescript
registerChunker({
  name: "my-chunker",
  chunkFn: async (content, filepath, config) => {
    // Return ChunkResult[]
    return [{
      id: `${filepath}:0`,
      content: content,
      startLine: 1,
      endLine: content.split('\n').length
    }];
  },
  preflight: async () => {
    // Check dependencies
  }
});
```

2. **Create YAML config** in `providers/configs/my-chunker.yaml`:
```yaml
name: my-chunker
displayName: My Chunker
type: local
adapter: ./adapters/generic-chunker.ts
local:
  chunking:
    size: 1500
  embedding:
    provider: openai
    model: text-embedding-3-small
```

3. **Register in factory.ts**:
```typescript
providerByNameRegistry.set("my-chunker", GenericChunkerProvider);
```

### Adding a New Metric

1. **Create metric file** in `core/metrics/builtin/my-metric.ts`:
```typescript
export class MyMetric implements MetricCalculator {
  readonly name = "my_metric";
  readonly aliases = ["my-metric"] as const;

  compute(results: EvalResult[]): MetricResult {
    // Calculate metric
    return { name: this.name, value: 0.85 };
  }
}
```

2. **Register in index.ts**:
```typescript
import { MyMetric } from "./my-metric.ts";
// Add to getBuiltinMetrics()
new MyMetric(),
```

### Adding a New Benchmark

1. **Create pack** in `benchmarks/packs/my-benchmark.ts` implementing `BenchmarkPack`
2. **Create config** in `benchmarks/configs/my-benchmark.yaml`
3. **Register in pack index** `benchmarks/packs/index.ts`

---

## 10. Quick Reference

### Environment Variables
```bash
OPENAI_API_KEY=sk-...       # For OpenAI embeddings
VOYAGE_API_KEY=pa-...       # For Voyage embeddings
CHONKIE_PYTHON_PATH=python3 # For Chonkie chunker
```

### CLI Commands
```bash
memorybench list providers          # List available providers
memorybench list benchmarks         # List available benchmarks
memorybench eval --benchmarks X --providers Y  # Run evaluation
memorybench table --run <id>        # Show results table
memorybench results --run <id>      # Export results
```

### Key File Locations
| Purpose | File |
|---------|------|
| CLI entry | `cli/index.ts` |
| Evaluation runner | `core/runner.ts` |
| Results storage | `core/results.ts` |
| Provider factory | `providers/factory.ts` |
| Chunker registry | `providers/adapters/chunker-registry.ts` |
| Relevance matchers | `benchmarks/packs/relevance.ts` |
| Metrics registry | `core/metrics/registry.ts` |
| Statistics | `core/analysis/statistics.ts` |

### Database Location
- Default: `./results/results.db`
- Checkpoints: `./checkpoints/<runId>/`

### Test Commands
```bash
bun test                    # Run all tests
bun test relevance          # Run relevance tests
bun test chunker-registry   # Run chunker tests
```

---

## Summary

CodeChunkBench is a well-architected benchmarking framework with:

- **Registry patterns** for extensibility (metrics, chunkers, providers)
- **Sealed semantics** preventing config drift from paper specs
- **Robust relevance matching** with multiple strategies
- **Statistical rigor** (Bootstrap CI, paired t-tests, effect sizes)
- **Resumable execution** via checkpointing

The main work remaining is:
1. Fix the factory.ts path resolution bug
2. Complete Phase 9 multi-hop evaluation
3. Add more chunker integrations (LlamaIndex, LangChain)

For any AI agent working on this codebase, start by understanding:
1. `relevance.ts` - Ground truth matching
2. `chunker-registry.ts` - How chunkers are registered
3. `generic-chunker.ts` - How chunking is dispatched
4. `runner.ts` - Evaluation orchestration
