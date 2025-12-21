# Codebase Audit Report

**Generated:** December 21, 2025  
**Project:** CodeChunkBench - Benchmarking Framework for Code Chunking Strategies

---

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total Directories** | 26 |
| **Total Files** | 145 |
| **Total Lines of Code** | 102,256 |
| **TypeScript Files** | 89 |
| **Python Files** | 3 |
| **YAML Configuration Files** | 23 |
| **Markdown Documentation** | 21 |
| **JSON Files** | 4 |
| **SQL Files** | 1 |

---

## File Type Breakdown

| File Type | Count | Total Lines | Percentage |
|-----------|-------|-------------|------------|
| TypeScript (`.ts`) | 89 | 17,481 | 17.1% |
| Python (`.py`) | 3 | 516 | 0.5% |
| YAML (`.yaml`, `.yml`) | 23 | 1,258 | 1.2% |
| Markdown (`.md`) | 21 | 15,231 | 14.9% |
| JSON (`.json`) | 4 | 67,074 | 65.6% |
| SQL (`.sql`) | 1 | 25 | <0.1% |
| Other | 4 | 671 | 0.7% |

**Note:** The large JSON line count (67,074) is primarily due to `benchmarks/data/locomo10.json` (66,750 lines), which is a dataset file.

---

## Code Statistics (Excluding Data Files & Documentation)

| Metric | Count |
|--------|-------|
| **TypeScript Files** | 89 |
| **Python Files** | 3 |
| **YAML Config Files** | 23 |
| **Total Lines of Code (TS + PY)** | 17,997 |

---

## File Size Distribution

| Size Category | Count | Description |
|---------------|-------|-------------|
| **Small** (< 50 lines) | 32 | Utility files, configs, small modules |
| **Medium** (50-200 lines) | 50 | Standard implementation files |
| **Large** (200-500 lines) | 27 | Complex modules, test files |
| **Very Large** (500+ lines) | 7 | Core runners, evaluators, large tests |

---

## Directory Structure & File Counts

### Root Level (17 files)
- `ENGINEERING_TASKS.md` - 1,546 lines
- `ARCHITECTURE.md` - 1,516 lines
- `METRICS_AND_ORCHESTRATION.md` - 1,128 lines
- `PROVIDER_CUSTOMIZATION_GUIDE.md` - 983 lines
- `VISION_2025.md` - 662 lines
- `CODEBASE_GUIDE.md` - 650 lines
- `ANALYSIS.md` - 620 lines
- `bun.lock` - 437 lines
- `README.md` - 220 lines
- `per_sample_results.csv` - 200 lines
- `CLAUDE.md` - 143 lines
- `package.json` - 38 lines
- `test_loader.ts` - 34 lines
- `.env.example` - 34 lines
- `tsconfig.json` - 29 lines
- `docker-compose.yml` - 23 lines
- `results.db` - 0 lines (binary)

### `/benchmarks` (1 file)
- `index.ts` - 15 lines

### `/benchmarks/configs` (7 files)
- `longmemeval.yaml` - 86 lines
- `repoeval.yaml` - 71 lines
- `swebench-lite.yaml` - 70 lines
- `locomo.yaml` - 79 lines
- `crosscodeeval.yaml` - 70 lines
- `rag-template.yaml` - 63 lines
- `repobench-r.yaml` - 65 lines

### `/benchmarks/data` (1 file)
- `locomo10.json` - 66,750 lines (dataset)

### `/benchmarks/evaluators` (2 files)
- `llm-judge.ts` - 671 lines
- `index.ts` - 6 lines

### `/benchmarks/loaders` (4 files)
- `loader.ts` - 575 lines
- `generic-loader.ts` - 151 lines
- `local.ts` - 135 lines
- `index.ts` - 19 lines

### `/benchmarks/loaders/download` (4 files)
- `dataset-registry.ts` - 702 lines
- `download-utils.ts` - 414 lines
- `yaml-config.ts` - 184 lines
- `datasets.yaml` - 118 lines

### `/benchmarks/packs` (10 files)
- `generic-code-retrieval-pack.test.ts` - 562 lines
- `relevance.test.ts` - 443 lines
- `generic-code-retrieval-pack.ts` - 454 lines
- `relevance.ts` - 350 lines
- `longmemeval.ts` - 325 lines
- `locomo.ts` - 236 lines
- `golden-tests.ts` - 180 lines
- `interface.ts` - 130 lines
- `index.ts` - 96 lines
- `utils.ts` - 24 lines

### `/benchmarks/RAG-template-benchmark` (4 files)
- `data.json` - 257 lines
- `data.ts` - 97 lines
- `types.ts` - 16 lines
- `index.ts` - 1 line

### `/cli` (3 files)
- `index.ts` - 874 lines (CLI entry point)
- `table.ts` - 427 lines
- `policy-compare.ts` - 137 lines

### `/core` (8 files)
- `runner.ts` - 620 lines (core evaluation runner)
- `results.ts` - 474 lines
- `config.ts` - 331 lines
- `checkpoint.ts` - 328 lines
- `registry.ts` - 271 lines
- `sealed-semantics.ts` - 118 lines
- `telemetry.ts` - 100 lines
- `index.ts` - 14 lines

### `/core/analysis` (3 files)
- `statistics.ts` - 419 lines
- `comparison-report.ts` - 331 lines
- `index.ts` - 12 lines

### `/core/metrics` (3 files)
- `index.ts` - 236 lines
- `registry.ts` - 163 lines
- `interface.ts` - 44 lines

### `/core/metrics/builtin` (19 files)
- `ndcg.test.ts` - 322 lines
- `ndcg.ts` - 315 lines
- `precision.ts` - 204 lines
- `mrr.ts` - 200 lines
- `file-recall.ts` - 139 lines
- `recall.ts` - 148 lines
- `latency.ts` - 140 lines
- `file-mrr.ts` - 136 lines
- `success.ts` - 99 lines
- `utils.ts` - 93 lines
- `index.ts` - 102 lines
- `abstention-accuracy.ts` - 72 lines
- `bleu.ts` - 68 lines
- `rouge.ts` - 64 lines
- `accuracy-by-type.ts` - 58 lines
- `accuracy-by-category.ts` - 57 lines
- `f1.ts` - 52 lines
- `avg-retrieval-score.ts` - 34 lines
- `accuracy.ts` - 27 lines

### `/core/policies` (2 files)
- `multi-hop.ts` - 204 lines
- `index.ts` - 20 lines

### `/core/types` (1 file)
- `locomo.ts` - 26 lines

### `/docs` (12 files)
- `LEADERBOARD_DATA_MODEL_DESIGN.md` - 1,196 lines
- `PHASE_6_SWEBENCH_LITE_IMPLEMENTATION.md` - 818 lines
- `PHASE_7_CHUNKER_PROVIDERS.md` - 834 lines
- `PHASE_8_EMBEDDING_SUPPORT.md` - 833 lines
- `PHASE_3_DATASET_VALIDATION.md` - 867 lines
- `PHASE_5_REPOBENCH_R_IMPLEMENTATION.md` - 647 lines
- `PHASE_9_MULTI_HOP_BENCHMARK.md` - 497 lines
- `PHASE_2_CODE_RETRIEVAL_BENCHMARKS.md` - 537 lines
- `PHASE_4_REPOEVAL_IMPLEMENTATION.md` - 550 lines
- `CODECHUNKBENCH_OVERVIEW.md` - 474 lines
- `RECALL_METRIC_FIX_REPORT.md` - 242 lines
- `PHASE_1_RETRIEVAL_METRICS.md` - 268 lines

### `/providers` (2 files)
- `factory.ts` - 256 lines
- `index.ts` - 13 lines

### `/providers/adapters` (13 files)
- `chunker-registry.ts` - 362 lines
- `chunker-registry.test.ts` - 336 lines
- `chonkie_bridge.py` - 258 lines
- `chunking-base.ts` - 192 lines
- `chonkie-bridge.ts` - 161 lines
- `langchain-bridge.ts` - 154 lines
- `llamaindex-bridge.ts` - 144 lines
- `full-context.ts` - 144 lines
- `generic-chunker.ts` - 133 lines
- `llamaindex_bridge.py` - 133 lines
- `langchain_bridge.py` - 125 lines
- `openrouter-rag.ts` - 75 lines
- `index.ts` - 18 lines

### `/providers/base` (4 files)
- `http-provider.ts` - 445 lines
- `types.ts` - 140 lines
- `local-provider.ts` - 98 lines
- `index.ts` - 8 lines

### `/providers/configs` (14 files)
- `supermemory.yaml` - 63 lines
- `zep.yaml` - 64 lines
- `mem0.yaml` - 64 lines
- `chonkie-code.yaml` - 46 lines
- `llamaindex-code.yaml` - 46 lines
- `langchain-code.yaml` - 47 lines
- `aqrag.yaml` - 46 lines
- `chonkie-recursive.yaml` - 47 lines
- `contextual-retrieval.yaml` - 42 lines
- `code-chunk-ast.yaml` - 42 lines
- `code-chunk-fixed.yaml` - 39 lines
- `openrouter-rag.yaml` - 37 lines
- `full-context-session.yaml` - 15 lines
- `full-context-turn.yaml` - 15 lines

### `/providers/embeddings` (3 files)
- `providers.ts` - 428 lines
- `core.ts` - 272 lines
- `index.ts` - 36 lines

### `/providers/OpenRouterRAG` (1 file)
- `schema.sql` - 25 lines

### `/providers/OpenRouterRAG/src` (4 files)
- `db.ts` - 105 lines
- `embeddings.ts` - 53 lines
- `add.ts` - 28 lines
- `retrieve.ts` - 23 lines

### `/scripts/ablation` (3 files)
- `scale-sweep.ts` - 208 lines
- `language-sweep.ts` - 181 lines
- `chunk-size-ablation.ts` - 169 lines

---

## Top 10 Largest Files

| Rank | File | Lines | Type |
|------|------|-------|------|
| 1 | `benchmarks/data/locomo10.json` | 66,750 | Dataset |
| 2 | `ENGINEERING_TASKS.md` | 1,546 | Documentation |
| 3 | `ARCHITECTURE.md` | 1,516 | Documentation |
| 4 | `docs/LEADERBOARD_DATA_MODEL_DESIGN.md` | 1,196 | Documentation |
| 5 | `METRICS_AND_ORCHESTRATION.md` | 1,128 | Documentation |
| 6 | `PROVIDER_CUSTOMIZATION_GUIDE.md` | 983 | Documentation |
| 7 | `cli/index.ts` | 874 | TypeScript |
| 8 | `docs/PHASE_3_DATASET_VALIDATION.md` | 867 | Documentation |
| 9 | `docs/PHASE_7_CHUNKER_PROVIDERS.md` | 834 | Documentation |
| 10 | `docs/PHASE_8_EMBEDDING_SUPPORT.md` | 833 | Documentation |

---

## Code Organization Analysis

### Core Components
- **CLI** (`/cli`): 3 files, 1,438 lines - Command-line interface
- **Core** (`/core`): 36 files, ~6,000 lines - Core evaluation engine
- **Benchmarks** (`/benchmarks`): 33 files, ~10,000 lines - Benchmark implementations
- **Providers** (`/providers`): 41 files, ~4,500 lines - Provider adapters and configs

### Test Coverage
- Test files identified: 3
  - `benchmarks/packs/generic-code-retrieval-pack.test.ts` - 562 lines
  - `benchmarks/packs/relevance.test.ts` - 443 lines
  - `providers/adapters/chunker-registry.test.ts` - 336 lines
- Total test code: ~1,341 lines

### Configuration Files
- **Benchmark configs**: 7 YAML files
- **Provider configs**: 14 YAML files
- **Dataset registry**: 1 YAML file
- Total: 23 YAML configuration files

### Documentation
- **Root-level docs**: 7 markdown files (6,142 lines)
- **Phase documentation**: 12 markdown files (7,156 lines)
- **Total documentation**: 19 markdown files, 13,298 lines

---

## Language Distribution

| Language | Files | Lines | Purpose |
|----------|-------|-------|---------|
| TypeScript | 89 | 17,481 | Main application code |
| Python | 3 | 516 | Bridge adapters for Python libraries |
| YAML | 23 | 1,258 | Configuration files |
| Markdown | 21 | 15,231 | Documentation |
| JSON | 4 | 67,074 | Data files and configs |
| SQL | 1 | 25 | Database schema |

---

## Key Observations

1. **Well-organized structure**: Clear separation between core, benchmarks, providers, and CLI
2. **Comprehensive documentation**: 21 markdown files totaling 15,231 lines
3. **Modular design**: Small to medium-sized files (majority under 500 lines)
4. **Test coverage**: Limited test files (3 identified), suggesting potential area for improvement
5. **Configuration-driven**: 23 YAML files for flexible provider/benchmark configuration
6. **Multi-language support**: TypeScript primary, with Python bridges for external libraries
7. **Large dataset file**: `locomo10.json` accounts for 65% of total lines (dataset, not code)

---

## Recommendations

1. **Test Coverage**: Consider expanding test coverage beyond the 3 current test files
2. **File Size**: Most files are well-sized; monitor the 7 files over 500 lines for potential refactoring
3. **Documentation**: Excellent documentation coverage; maintain as codebase grows
4. **Code Organization**: Strong modular structure; continue following established patterns

---

**End of Audit Report**
