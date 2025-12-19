# Phase 1: Retrieval Metrics for Code Chunking Evaluation

## Overview

This document outlines the implementation of retrieval metrics in memorybench-bench-code-chunk to support code chunking evaluation (code-chunk, Chonkie, Fixed chunkers).

### Metric Status

| Metric | Status | File |
|--------|--------|------|
| **Precision@K** | ✅ Implemented | `core/metrics/builtin/precision.ts` |
| **Recall@K** | ✅ Implemented | `core/metrics/builtin/recall.ts` |
| **MRR** | ✅ Implemented | `core/metrics/builtin/mrr.ts` |
| **nDCG@K** | ✅ Implemented | `core/metrics/builtin/ndcg.ts` |
| **MAP** | ❌ Not implemented | Optional (less common for code retrieval) |

---

## nDCG: Academic Foundation

### Original Paper

**Citation**: Järvelin, K., & Kekäläinen, J. (2002). *Cumulated gain-based evaluation of IR techniques*. ACM Transactions on Information Systems, 20(4), 422-446.

> "We propose several novel measures based on graded relevance judgments. These measures credit IR techniques for retrieving highly relevant documents."

### Why nDCG?

nDCG is the **primary metric** used by:
- **CoIR Benchmark** - Uses nDCG@10 as the main metric
- **MTEB Leaderboard** - Reports nDCG@10 for retrieval tasks
- **BEIR Benchmark** - Uses nDCG@10 alongside MAP and Recall
- **code-chunk's eval** - Uses nDCG@5 and nDCG@10

---

## Mathematical Definitions

### Discounted Cumulative Gain (DCG)

**Standard Formula** (Järvelin & Kekäläinen 2002):

```
DCG@K = Σ(i=1 to K) [rel_i / log₂(i+1)]
```

Where:
- `K` = rank position (e.g., 5, 10)
- `rel_i` = relevance of item at position i (binary: 0 or 1)
- `log₂(i+1)` = discount factor (position 1 → log₂(2)=1, position 2 → log₂(3)≈1.58, ...)

### Ideal DCG (IDCG)

**IMPORTANT**: IDCG uses the **total number of relevant items in the ground truth set**, NOT just the count of relevant items found in the top-K results.

```
IDCG@K = Σ(i=1 to min(K, |REL|)) [1 / log₂(i+1)]
```

Where `|REL|` = **total number of relevant items in the ground truth set** (qrels).

**Example**: If there are 3 relevant items in ground truth and K=5:
```
IDCG@5 = 1/log₂(2) + 1/log₂(3) + 1/log₂(4) = 1 + 0.63 + 0.5 = 2.13
```

This matches `code-chunk/packages/eval/src/metrics.ts`:
```typescript
const idealK = Math.min(k, relevantSet.size);
const idcg = Array.from({ length: idealK }).reduce<number>(
    (sum, _, i) => sum + 1 / Math.log2(i + 2),
    0,
);
```

### Normalized DCG (nDCG)

```
nDCG@K = DCG@K / IDCG@K
```

- **Range**: [0, 1]
- **1.0** = perfect ranking (all relevant items at top positions)
- **0.0** = no relevant items retrieved (or IDCG=0)

### Edge Cases

| Case | Handling |
|------|----------|
| No relevant items exist (`IDCG=0`) | Return `0` |
| No items retrieved | Return `0` |
| All relevant items retrieved perfectly | Return `1` |

---

## Relevance Determination Strategy

### Priority-Based Approach

The nDCG implementation uses a **three-tier priority** for determining relevance:

#### (A) Explicit qrels in metadata (Recommended for code-chunk)

When `result.metadata.relevantIds` (or `relevantChunkIds`) contains ground-truth IDs:

```typescript
// Build relevance set from metadata
const qrels = new Set(result.metadata.relevantIds);

// Check each retrieved item
const isRelevant = qrels.has(ctx.id) ? 1 : 0;

// IDCG uses the full qrels size
const totalRelevant = qrels.size;
```

**This is the recommended approach for code-chunk benchmarks** where ground-truth chunk IDs are known from file/line overlap detection.

#### (B) Pack-owned relevance (LoCoMo/LongMemEval style)

When a benchmark pack exists with `pack.sealedSemantics.relevance === true`:

```typescript
// Use pack's isRelevant method
const isRelevant = pack.isRelevant({ item, result: ctx }) ? 1 : 0;

// Try to infer totalRelevant from metadata (e.g., evidence IDs)
const totalRelevant = inferFromMetadata(result);
```

This matches existing memorybench patterns for LoCoMo (`evidence` field) and LongMemEval (`answerCorpusIds`).

#### (C) Token-based fallback

When no labels exist, falls back to token-based F1 scoring:

```typescript
const f1 = computeTokenF1(expectedTokens, chunkTokens);
const isRelevant = f1 >= threshold ? 1 : 0;

// Without qrels, we can only count what we found
const totalRelevant = relevantInTopK;
```

**Note**: This fallback **may underestimate IDCG** since we don't know the true count of relevant items. It's intended for benchmarks without ground-truth labels.

---

## Implementation Details

### File: `core/metrics/builtin/ndcg.ts`

```typescript
export class NDCGAtKMetric implements MetricCalculator {
    readonly name: string;           // "ndcg_at_5", "ndcg_at_10"
    readonly aliases: readonly string[];  // ["ndcg@5"], ["ndcg@10"]
    
    constructor(k: number, f1Threshold = 0.3) { ... }
    
    compute(results: EvalResult[]): MetricResult { ... }
}

// Pre-built instances
export class NDCGAt5Metric extends NDCGAtKMetric { ... }
export class NDCGAt10Metric extends NDCGAtKMetric { ... }
```

### Registration

Added to `core/metrics/builtin/index.ts`:
- Export: `export * from "./ndcg.ts";`
- Import: `import { NDCGAt5Metric, NDCGAt10Metric } from "./ndcg.ts";`
- Registered in `getBuiltinMetrics()` under "Retrieval Metrics"

### Metric Result Details

The metric returns detailed breakdown:

```typescript
{
    name: "ndcg_at_10",
    value: 0.85,  // Average nDCG across all queries
    details: {
        avgNDCG: 0.85,
        queriesWithRelevant: 95,
        total: 100,
        k: 10,
        f1Threshold: 0.3,
        strategyUsed: "qrels",  // or "pack" or "token-fallback" or "mixed"
        strategyCounts: { qrels: 100, pack: 0, "token-fallback": 0 }
    }
}
```

---

## Comparison with code-chunk's Implementation

code-chunk's eval uses ID-based relevance from `packages/eval/src/metrics.ts`:

```typescript
export function computeMetrics(
    retrievedIds: string[],
    relevantSet: Set<string>,
    k: number,
): { precision: number; recall: number; ndcg: number } {
    const topK = retrievedIds.slice(0, k);
    
    // DCG calculation
    const dcg = topK.reduce((sum, id, i) => {
        const rel = relevantSet.has(id) ? 1 : 0;
        return sum + rel / Math.log2(i + 2);
    }, 0);
    
    // IDCG uses relevantSet.size (NOT relevantInTopK)
    const idealK = Math.min(k, relevantSet.size);
    const idcg = Array.from({ length: idealK }).reduce<number>(
        (sum, _, i) => sum + 1 / Math.log2(i + 2),
        0,
    );
    
    const ndcg = idcg > 0 ? dcg / idcg : 0;
    return { precision, recall, ndcg };
}
```

**Matching behavior**: When using Strategy (A) with explicit qrels, memorybench-bench-code-chunk's nDCG produces identical results to code-chunk's implementation.

---

## Usage

### CLI Usage

```bash
# Run evaluation with nDCG metrics
memorybench eval \
    --benchmarks rag-template \
    --providers aqrag \
    --metrics ndcg_at_5 ndcg_at_10 precision_at_5 recall_at_10 \
    --limit 10
```

### Aliases

Both naming conventions work:
- `ndcg_at_5` or `ndcg@5`
- `ndcg_at_10` or `ndcg@10`

---

## Key Differences from Original Plan

1. **IDCG Calculation**: Fixed to use `min(k, |relevantSet|)` instead of `min(k, relevantInTopK)` when qrels are available. This prevents inflated nDCG scores.

2. **Relevance Priority**: Added explicit support for qrels-based relevance (Strategy A) as the top priority, matching code-chunk's approach.

3. **Strategy Tracking**: Added `strategyUsed` and `strategyCounts` to metric details for debugging and verification.

---

## References

1. Järvelin, K., & Kekäläinen, J. (2002). *Cumulated gain-based evaluation of IR techniques*. ACM TOIS, 20(4), 422-446.
2. [Wikipedia: Discounted Cumulative Gain](https://en.wikipedia.org/wiki/Discounted_cumulative_gain)
3. [code-chunk metrics implementation](../../../code-chunk/packages/eval/src/metrics.ts)
4. [BEIR Benchmark](https://github.com/beir-cellar/beir)
5. [CoIR Benchmark](https://github.com/CoIR-team/coir)
