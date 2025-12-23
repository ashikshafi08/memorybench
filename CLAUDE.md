# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CodeChunkBench is a benchmarking framework for comparing **code chunking strategies** in RAG systems. Unlike embedding benchmarks (CoIR, MTEB), this project measures chunking quality for code retrieval tasks.

**Key Question Answered**: "Which code chunker should I use for my RAG system?"

## Build & Development Commands

```bash
# Install dependencies
bun install

# Link CLI globally
bun link

# Run CLI directly
bun run ./cli/index.ts

# Run evaluation
superbench eval --benchmarks repoeval --providers code-chunk-ast --limit 10

# List available providers/benchmarks
superbench list

# Download benchmark datasets
superbench download --benchmark repoeval

# View results
superbench table --run <runId> --benchmark repoeval

# Run tests
bun test                        # All tests
bun test chunker-registry       # Specific test file
bun test core/metrics           # Test a directory
```

## Architecture

### Core Pipeline
```
CLI → Registry (YAML configs) → BenchmarkRunner → Provider → Metrics → ResultsStore (SQLite)
```

### Registry Pattern
The codebase uses a unified registry pattern via `BaseRegistry` for extensibility.
All registries share: `register()`, `get()`, `has()`, `list()`, `keys()`, alias support.

| Registry | Location | Purpose |
|----------|----------|---------|
| **BaseRegistry** | `core/registry/base-registry.ts` | Generic base class for all registries |
| **MetricRegistry** | `core/metrics/registry.ts` | Metrics with aliases (e.g., `ndcg@5` → `ndcg_at_5`) |
| **ChunkerRegistry** | `providers/adapters/chunker-registry.ts` | Chunker implementations |
| **LoaderRegistry** | `benchmarks/loaders/loader-registry.ts` | Custom data loaders for benchmarks |
| **DatasetRegistry** | `benchmarks/loaders/download/dataset-registry.ts` | Dataset download/load logic |
| **PackRegistry** | `benchmarks/packs/index.ts` | Benchmark-specific evaluation packs |
| **EmbeddingRegistry** | `providers/embeddings/registry.ts` | Embedding provider factories |

### Key Dispatch Flow
```
GenericChunkerProvider (single class)
    → getChunker(config.name)  // From chunker-registry
    → chunker.chunkFn(content, filepath, config)
```

All chunkers share `GenericChunkerProvider` - provider factory auto-populates from chunker registry.

### Three-Level Relevance Priority
Ranking metrics (nDCG, MRR, Recall) determine relevance in this order:
1. **Explicit qrels** - `metadata.relevantIds`, `relevantChunkIds`, `groundTruthIds`
2. **Pack-owned** - `pack.isRelevant()` when `sealedSemantics.relevance === true`
3. **Token fallback** - F1 ≥ 0.3 threshold

## Key File Locations

| Purpose | File |
|---------|------|
| CLI entry | `cli/index.ts` |
| Base registry class | `core/registry/base-registry.ts` |
| Evaluation runner | `core/runner.ts` |
| Relevance matchers | `benchmarks/packs/relevance.ts` |
| Chunker registry | `providers/adapters/chunker-registry.ts` |
| Loader registry | `benchmarks/loaders/loader-registry.ts` |
| Dataset registry | `benchmarks/loaders/download/dataset-registry.ts` |
| Provider factory | `providers/factory.ts` |
| Metrics registry | `core/metrics/registry.ts` |
| Results storage | `core/results.ts` |

## Adding New Components

### New Chunker (~15 lines, 1 file)
```typescript
// In providers/adapters/chunker-registry.ts
registerChunker({
  name: "my-chunker",
  preflight: async () => { /* check deps */ },
  chunkFn: async (content, filepath, config) => {
    return [{ content: "...", startLine: 1, endLine: 10, id: "..." }];
  },
});
// That's it! Provider factory auto-populates from chunker registry.
```

### New Metric (~20 lines, 2 files)
```typescript
// 1. Create core/metrics/builtin/my-metric.ts
export class MyMetric implements MetricCalculator {
  readonly name = "my_metric";
  readonly aliases = ["my-metric"] as const;
  compute(results: EvalResult[]): MetricResult {
    return { name: this.name, value: 0.85 };
  }
}

// 2. Register in core/metrics/builtin/index.ts
registry.register(new MyMetric());
```

### New Benchmark Loader (~10 lines, 1 file)
```typescript
// In benchmarks/loaders/builtin-loaders.ts
registerLoader({
  name: "my-benchmark",
  aliases: ["my-bench"],
  loadFn: async (config, options) => {
    // Load and return BenchmarkItem[]
    return [...items];
  },
});
```

### New Dataset (~50 lines)
```typescript
// In benchmarks/loaders/download/dataset-registry.ts
getDatasetRegistry().register({
  name: "my-dataset",
  dataDir: join(DATASETS_BASE_DIR, "my-dataset"),
  envVar: "MY_DATASET_DIR",
  isAvailable: () => existsSync(dataDir),
  download: async () => { /* download logic */ },
  loadTasks: async () => { /* parse tasks */ },
  toBenchmarkItem: async (task) => { /* convert to BenchmarkItem */ },
});
```

### New Embedding Provider (~5 lines)
```typescript
// In providers/embeddings/providers.ts (or create separate file)
registerEmbeddingProvider({
  name: "my-embeddings",
  aliases: ["myembed"],
  factory: (config) => new MyEmbeddingProvider(config),
});
```

### New Benchmark Pack
Implement `BenchmarkPack` interface in `benchmarks/packs/`, add YAML config in `benchmarks/configs/`.

## Relevance Matching by Benchmark

| Benchmark | Strategy | Key Function |
|-----------|----------|--------------|
| RepoEval | Line-range overlap | `lineRangeOverlaps()` in `relevance.ts` |
| RepoBench-R | Jaccard ≥ 0.7 | `jaccardSimilarity()` |
| SWE-bench Lite | File matching | `fileMatches()` |
| CrossCodeEval | Dependency coverage | `crossFileCoverage()` |

## Environment Variables

```bash
OPENAI_API_KEY=sk-...       # OpenAI embeddings
VOYAGE_API_KEY=pa-...       # Voyage embeddings
CHONKIE_PYTHON_PATH=python3 # For Chonkie chunkers (requires Python 3.10+)
```

## Code Conventions

- Uses Bun runtime with TypeScript
- YAML configs with Zod validation (`core/config.ts`)
- All line numbers are 1-indexed and inclusive
- Path matching uses suffix-safe comparison (prevents "oauth.py" matching "auth.py")
- Chunkers must preserve line information (`startLine`, `endLine`) for relevance matching
- All registries extend `BaseRegistry` for consistent patterns

## Known Issues

1. **factory.ts lines 136-141**: Prototype check `AdapterClass.prototype ? ... : ...` always takes the constructor path since `prototype` is truthy. Factory function path is never taken. Mitigated by pre-registration in `providerByNameRegistry`.

2. **Chonkie chunkers**: Require Python 3.10+ with `chonkie` and `tree-sitter-language-pack` installed. Preflight check runs during initialization.
