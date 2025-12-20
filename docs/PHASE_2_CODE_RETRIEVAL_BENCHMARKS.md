# Phase 2: Code Retrieval Benchmark Suite

## Overview

This document outlines the benchmark suite for evaluating code chunking strategies. The suite focuses exclusively on **true-chunking benchmarks** where we chunk raw repositories ourselves, ensuring we measure chunking quality rather than embedding quality.

**Goal:** Measure and compare code chunking strategies for retrieval tasks.

---

## Critical Design Decision: True-Chunking Only

### Why True-Chunking Benchmarks?

| Type | Benchmarks | What They Test | For Code Chunking? |
|------|------------|----------------|-------------------|
| **True Chunking** | RepoEval, RepoBench-R, SWE-bench Lite, CrossCodeEval | Raw repos WE chunk | ✅ YES - Tests chunking quality |
| **Pre-Chunked** | CoIR, CodeSearchNet, MTEB | Fixed corpus already chunked | ❌ NO - Tests embedding/retrieval only |

**Why this matters:** Pre-chunked benchmarks (CoIR, CodeSearchNet, MTEB) have pre-defined document corpora. Using them tests embedding quality, NOT chunking quality. To evaluate "which chunker is best", we MUST use **true-chunking benchmarks** where chunking decisions affect results.

### What We Include

```
✅ TRUE-CHUNKING BENCHMARKS (we chunk raw repos):
├── RepoEval        - Function/line/API completion (Python)
├── RepoBench-R     - Explicit retrieval task (Python, Java)
├── SWE-bench Lite  - Bug localization (Python)
└── CrossCodeEval   - Cross-file dependencies (Python, Java, TS, C#)

❌ EXCLUDED (pre-chunked, tests embeddings not chunking):
├── CoIR            - Fixed corpus with explicit qrels
├── CodeSearchNet   - Pre-defined document pairs
├── MTEB            - Embedding-focused benchmark
└── CodeRAG-Bench   - Pre-chunked 25M doc corpus
```

> **Note:** Pre-chunked benchmarks could be added later as a separate "embedding-only" evaluation track, but they are out of scope for chunking quality measurement.

---

## Benchmark Selection

### Selected Benchmarks (True-Chunking)

| Benchmark | Languages | Samples | Ground Truth | Priority |
|-----------|-----------|---------|--------------|----------|
| **RepoEval** | Python | 3,655 | Line-range overlap | **P0** |
| **RepoBench-R** | Python, Java | 192K | Gold snippet Jaccard | **P1** |
| **SWE-bench Lite** | Python | 323 | Patch file list | **P2** |
| **CrossCodeEval** | Python, Java, TS, C# | 10K | Cross-file dependencies | **P3** |

### Benchmark Details

#### 1. RepoEval (P0 - Essential)

**Source:** Microsoft CodeT/RepoCoder
**Paper:** [arXiv:2303.12570](https://arxiv.org/abs/2303.12570)

```
Task: Given code completion prompt, retrieve relevant context from repo
Ground Truth: Chunk overlaps with target line range
Metrics: nDCG@5, nDCG@10, Recall@K, MRR
```

**Data:**
- 8 Python repositories
- 3 task types: function_completion, line_completion, api_completion
- 3,655 total samples

**Why Essential:**
- code-chunk's existing eval uses RepoEval
- Enables direct comparison with published results
- Well-defined ground truth (line-range overlap)

#### 2. RepoBench-R (P1 - High)

**Source:** [RepoBench](https://github.com/Leolty/repobench)
**Paper:** [arXiv:2306.03091](https://arxiv.org/abs/2306.03091)

```
Task: Retrieve relevant code snippet for completion
Ground Truth: Gold snippet with index, Jaccard similarity matching
Metrics: nDCG@K, Recall@K
```

**Data:**
- Python: ~96K samples
- Java: ~96K samples
- Gold snippet provided with explicit index

**Why Include:**
- Explicit retrieval benchmark (not completion-focused)
- Multi-language (Python + Java)
- Large scale validates statistical significance

#### 3. SWE-bench Lite (P2 - High)

**Source:** [SWE-bench](https://www.swebench.com/)
**Paper:** [arXiv:2310.06770](https://arxiv.org/abs/2310.06770)

```
Task: Given issue description, retrieve files to modify
Ground Truth: Files modified in ground-truth patch
Metrics: File-Recall@K
```

**Data:**
- 323 real GitHub issues (dev + test)
- Real-world bug localization task

**Why Include:**
- Tests retrieval for real-world code repair
- File-level ground truth (tests multi-file retrieval)
- Industry-standard benchmark

#### 4. CrossCodeEval (P3 - Medium)

**Source:** [CrossCodeEval](https://github.com/anthropics/cross-code-eval)
**Paper:** [arXiv:2310.11248](https://arxiv.org/abs/2310.11248)

```
Task: Retrieve cross-file dependencies for code completion
Ground Truth: Import/dependency analysis
Metrics: Retrieval accuracy
```

**Data:**
- Python, Java, TypeScript, C#
- Cross-file dependency tasks

**Why Include:**
- Tests cross-file understanding
- Critical for real-world codebases
- Shows chunker advantage for dependency tracking

---

## Provider (Chunker) Selection

### MVP Providers

| Provider | Type | Languages | Integration | Priority |
|----------|------|-----------|-------------|----------|
| **code-chunk-ast** | AST-aware | 10+ | Native TypeScript | **Essential** |
| **code-chunk-fixed** | NWS character | Any | Native TypeScript | **Essential** |
| **chonkie-code** | tree-sitter semantic | 56+ | Python subprocess | **Essential** |
| **chonkie-recursive** | Character fallback | Any | Python subprocess | **Essential** |

### Extension Providers (Optional)

| Provider | Type | Integration | Notes |
|----------|------|-------------|-------|
| LangChain CodeSplitter | Language-aware | Python subprocess | Industry standard |
| LlamaIndex CodeSplitter | AST-aware | Python subprocess | Direct AST competitor |
| cAST | AST-aware | Python subprocess | Research baseline |

### Provider Details

#### 1. code-chunk-ast (Essential)

```typescript
import { chunk } from 'code-chunk';

const chunks = await chunk(filepath, code, {
  maxChunkSize: 1500,  // NWS tokens
  contextMode: 'full',
});

// Uses contextualizedText for embeddings (includes imports, scope, siblings)
const textForEmbedding = chunks.map(c => c.contextualizedText);
```

- **Type:** AST-aware via tree-sitter
- **Key Feature:** `contextualizedText` includes imports, types, scope
- **Languages:** Python, TypeScript, Java, Go, Rust, C++, etc.

#### 2. code-chunk-fixed (Essential Baseline)

```typescript
import { chunkFixed } from 'code-chunk';

const chunks = chunkFixed(code, {
  maxNws: 1500,
});
```

- **Type:** NWS (non-whitespace) character-based
- **Key Feature:** Baseline control, no syntax awareness
- **Languages:** Any (language-agnostic)

#### 3. chonkie-code (Essential)

```python
from chonkie import CodeChunker

chunker = CodeChunker(
    chunk_size=1500,
    chunk_overlap=200,
)
chunks = chunker.chunk(code)
```

- **Type:** tree-sitter semantic chunking
- **Key Feature:** 56+ languages, automatic detection
- **Integration:** Python subprocess from TypeScript

#### 4. chonkie-recursive (Essential)

```python
from chonkie import RecursiveChunker

chunker = RecursiveChunker(
    chunk_size=1500,
    chunk_overlap=200,
)
chunks = chunker.chunk(code)
```

- **Type:** Character-based with recursive splitting
- **Key Feature:** Fallback baseline from chonkie
- **Integration:** Python subprocess from TypeScript

---

## Embedding Selection

### Selected Embeddings

| Model | Provider | Dimensions | Cost | Priority |
|-------|----------|------------|------|----------|
| **voyage-code-3** | Voyage | 1024 | $0.18/1M | **Primary** |
| **text-embedding-3-small** | OpenAI | 1536 | $0.02/1M | **Secondary** |

### Why These Two?

1. **voyage-code-3**: Code-specialized, state-of-art for code retrieval
2. **text-embedding-3-small**: General-purpose baseline, cost-effective

### Expected Insights

| Scenario | Hypothesis |
|----------|------------|
| AST + Voyage | Strong improvement (code-aware embedding + code-aware chunking) |
| AST + OpenAI | Improvement (proves chunking helps even with general embeddings) |
| Fixed + Voyage | Better than Fixed + OpenAI (embedding quality helps) |

If a chunker wins across **both** embedding models, it proves chunking quality is independent of embedding choice.

---

## Scope Options

### Option A: MVP (Recommended)

| Dimension | Coverage |
|-----------|----------|
| Benchmarks | RepoEval only |
| Providers | code-chunk-ast, code-chunk-fixed, chonkie-code, chonkie-recursive |
| Embeddings | voyage-code-3 |
| Languages | Python |

**Effort:** ~15-20 hours
**Output:** Clear comparison on code-chunk's home turf

### Option B: Multi-Dataset

| Dimension | Coverage |
|-----------|----------|
| Benchmarks | RepoEval + RepoBench-R + SWE-bench Lite |
| Providers | 4 MVP providers |
| Embeddings | voyage-code-3, openai-small |
| Languages | Python, Java |

**Effort:** ~35-40 hours
**Output:** Multi-dataset validation, stronger claims

### Option C: Full Suite

| Dimension | Coverage |
|-----------|----------|
| Benchmarks | All 4 true-chunking benchmarks |
| Providers | 4 MVP + 3 extension providers |
| Embeddings | voyage-code-3, openai-small |
| Languages | Python, Java, TypeScript, C# |

**Effort:** ~60-70 hours
**Output:** Comprehensive benchmark suite

### Recommendation: Start with Option A

1. **Phase A:** RepoEval with 4 providers + voyage-code-3
2. **Phase B:** If results are promising, add RepoBench-R + SWE-bench Lite
3. **Phase C:** If needed for publication, add CrossCodeEval + extension providers

---

## Statistical Analysis Protocol

### Requirements

All comparisons must include:

```typescript
interface StatisticalRequirements {
  // Minimum runs
  runsPerConfiguration: 3;

  // Confidence intervals
  confidenceLevel: 0.95;
  bootstrapSamples: 10000;

  // Significance testing
  significanceThreshold: 0.05;
  test: "paired-t-test" | "wilcoxon-signed-rank";

  // Multiple comparison correction
  correction: "bonferroni";

  // Effect size
  effectSizeMetric: "cohens-d";
  effectSizeThresholds: {
    small: 0.2,
    medium: 0.5,
    large: 0.8,
  };
}
```

### Reporting Format

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BENCHMARK RESULTS: RepoEval                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Provider         │ nDCG@10       │ Recall@10     │ MRR            │
│  ─────────────────┼───────────────┼───────────────┼────────────────│
│  code-chunk-ast   │ (TBD) ± (TBD) │ (TBD) ± (TBD) │ (TBD) ± (TBD)  │
│  chonkie-code     │ (TBD) ± (TBD) │ (TBD) ± (TBD) │ (TBD) ± (TBD)  │
│  chonkie-recursive│ (TBD) ± (TBD) │ (TBD) ± (TBD) │ (TBD) ± (TBD)  │
│  code-chunk-fixed │ (TBD) ± (TBD) │ (TBD) ± (TBD) │ (TBD) ± (TBD)  │
│                                                                     │
│  ** p < 0.01 vs code-chunk-fixed baseline (Bonferroni-corrected)   │
│  *  p < 0.05 vs code-chunk-fixed baseline                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 2a: Core Infrastructure (~5 hours)

| Task | Files | Effort |
|------|-------|--------|
| RepoEval loader | `loaders/repoeval.ts` | 2 hours |
| RepoEval benchmark pack | `benchmarks/repoeval/` | 2 hours |
| Ground truth matching | `evaluation/relevance.ts` | 1 hour |

### Phase 2b: Provider Adapters (~8 hours)

| Task | Files | Effort |
|------|-------|--------|
| code-chunk-ast adapter | `providers/code-chunk-ast.ts` | 2 hours |
| code-chunk-fixed adapter | `providers/code-chunk-fixed.ts` | 1 hour |
| chonkie Python bridge | `providers/chonkie-bridge.ts` | 3 hours |
| chonkie-code adapter | `providers/chonkie-code.ts` | 1 hour |
| chonkie-recursive adapter | `providers/chonkie-recursive.ts` | 1 hour |

### Phase 2c: Embedding Integration (~4 hours)

| Task | Files | Effort |
|------|-------|--------|
| Voyage Code 3 integration | `embeddings/voyage.ts` | 2 hours |
| OpenAI small integration | `embeddings/openai.ts` | 1 hour |
| Embedding cache | `embeddings/cache.ts` | 1 hour |

### Phase 2d: Additional Benchmarks (~12 hours)

| Task | Files | Effort |
|------|-------|--------|
| RepoBench-R loader | `loaders/repobench.ts` | 4 hours |
| SWE-bench Lite loader | `loaders/swebench.ts` | 5 hours |
| CrossCodeEval loader | `loaders/crosscodeeval.ts` | 3 hours |

### Phase 2e: Statistical Framework (~4 hours)

| Task | Files | Effort |
|------|-------|--------|
| Bootstrap CI implementation | `stats/bootstrap.ts` | 1 hour |
| Significance tests | `stats/significance.ts` | 1 hour |
| Effect size calculations | `stats/effect-size.ts` | 1 hour |
| Report generation | `stats/report.ts` | 1 hour |

### Total Effort

| Scope | Phases | Hours |
|-------|--------|-------|
| **MVP (Option A)** | 2a + 2b + 2c (partial) + 2e | ~18 hours |
| **Multi-Dataset (Option B)** | 2a + 2b + 2c + 2d (partial) + 2e | ~30 hours |
| **Full Suite (Option C)** | All phases | ~33 hours |

---

## CLI Usage

### Basic Evaluation

```bash
# Run RepoEval with code-chunk-ast
bun run cli eval \
  --benchmarks repoeval \
  --providers code-chunk-ast \
  --output results/repoeval-ast.json
```

### Provider Comparison

```bash
# Compare all MVP providers on RepoEval
bun run cli eval \
  --benchmarks repoeval \
  --providers code-chunk-ast,code-chunk-fixed,chonkie-code,chonkie-recursive \
  --runs 3 \
  --stats \
  --output results/repoeval-comparison.json
```

### Embedding Comparison

```bash
# Test providers across both embeddings
bun run cli eval \
  --benchmarks repoeval \
  --providers code-chunk-ast,code-chunk-fixed \
  --embeddings voyage-code-3,openai-small \
  --output results/embedding-comparison.json
```

### Multi-Benchmark Evaluation

```bash
# Run on multiple true-chunking benchmarks
bun run cli eval \
  --benchmarks repoeval,repobench-r,swebench-lite \
  --providers code-chunk-ast,code-chunk-fixed,chonkie-code \
  --runs 3 \
  --stats \
  --output results/multi-benchmark.json
```

---

## Expected Output Format

### JSON Results

```json
{
  "meta": {
    "timestamp": "2025-01-15T10:30:00Z",
    "benchmarks": ["repoeval"],
    "providers": ["code-chunk-ast", "code-chunk-fixed", "chonkie-code", "chonkie-recursive"],
    "embedding": "voyage-code-3",
    "runs": 3
  },
  "results": {
    "repoeval": {
      "code-chunk-ast": {
        "ndcg_at_10": { "mean": 0.0, "std": 0.0, "ci_lower": 0.0, "ci_upper": 0.0 },
        "recall_at_10": { "mean": 0.0, "std": 0.0, "ci_lower": 0.0, "ci_upper": 0.0 },
        "mrr": { "mean": 0.0, "std": 0.0, "ci_lower": 0.0, "ci_upper": 0.0 }
      }
    }
  },
  "comparisons": {
    "code-chunk-ast_vs_code-chunk-fixed": {
      "ndcg_at_10": { "difference": 0.0, "p_value": 0.0, "effect_size": 0.0, "significant": false }
    }
  }
}
```

---

## Success Criteria

### Minimum Viable Results

| Criterion | Requirement |
|-----------|-------------|
| Runs on RepoEval | All 4 providers complete |
| Statistical validity | 3 runs per config, 95% CIs reported |
| Reproducible | Same results on re-run |

### Publication-Quality Results

| Criterion | Requirement |
|-----------|-------------|
| Multiple benchmarks | ≥3 true-chunking benchmarks |
| Statistical significance | p < 0.05 (Bonferroni-corrected) |
| Effect sizes | Cohen's d reported |
| Multi-embedding | Results with ≥2 embedding models |

---

## References

### Benchmarks
1. **RepoEval/RepoCoder**: [arXiv:2303.12570](https://arxiv.org/abs/2303.12570)
2. **RepoBench**: [arXiv:2306.03091](https://arxiv.org/abs/2306.03091)
3. **SWE-bench**: [arXiv:2310.06770](https://arxiv.org/abs/2310.06770)
4. **CrossCodeEval**: [arXiv:2310.11248](https://arxiv.org/abs/2310.11248)

### Chunkers
5. **Chonkie**: [GitHub](https://github.com/bhavnicksm/chonkie)
6. **LangChain**: [docs.langchain.com](https://docs.langchain.com)
7. **LlamaIndex**: [docs.llamaindex.ai](https://docs.llamaindex.ai)

### Statistical Methods
8. Efron, B. (1979). Bootstrap methods: Another look at the jackknife.
9. Cohen, J. (1988). Statistical power analysis for the behavioral sciences.

---

## Summary

| Dimension | Coverage |
|-----------|----------|
| **Benchmarks** | 4 true-chunking (RepoEval, RepoBench-R, SWE-bench Lite, CrossCodeEval) |
| **Providers** | 4 MVP (code-chunk-ast, code-chunk-fixed, chonkie-code, chonkie-recursive) |
| **Embeddings** | 2 models (voyage-code-3, openai-small) |
| **Statistics** | Bootstrap CIs, paired t-tests, effect sizes |

**Key Decision:** Pre-chunked benchmarks (CoIR, CodeSearchNet, MTEB, CodeRAG-Bench) are **excluded** because they test embedding quality, not chunking quality. This suite focuses exclusively on **true-chunking benchmarks** where chunking decisions directly impact results.
