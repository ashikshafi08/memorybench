# Phase 9: Multi-Hop Retrieval Evaluation

**Status:** Planning
**Priority:** High
**Dependencies:** Phases 1-8 (single-hop evaluation must work first)

---

## Overview: Two-Part Structure

| Part | Scope | Effort | New Ground Truth? | LLM Needed? |
|------|-------|--------|-------------------|-------------|
| **Phase 9A** | Add multi-hop policy to existing benchmark | 20-30 hrs | No (reuse existing) | No |
| **Phase 9B** | New multi-hop benchmark with dependency graphs | 120-160 hrs | Yes (create new) | Optional (offline) |

**This document focuses on Phase 9A.** Phase 9B is optional future work.

---

# Phase 9A: Multi-Hop Policy Mode

## 1. What We're Adding

A **retrieval policy** axis to the existing evaluation:

```
Existing:  Benchmark × Provider × Embedding → Metrics
New:       Benchmark × Provider × Embedding × Policy → Metrics
                                              ↑
                                     1-hop | H-hop
```

For each (benchmark, provider, embedding) we already run, we now also run it with multi-hop retrieval and report both.

---

## 2. Retrieval Policies

### 2.1 Single-Hop (1-hop@K) — Baseline

```typescript
async function singleHop(
  query: string,
  provider: LocalProvider,
  k: number
): Promise<Chunk[]> {
  return provider.searchQuery(query, { limit: k });
}
```

- 1 embedding call (query)
- 1 retrieval pass
- Returns top-K chunks

### 2.2 Multi-Hop (H-hop@K) — With Fixed Budget

```typescript
interface MultiHopConfig {
  maxHops: number;           // Default: 2
  chunksPerHop: number;      // Default: 3
  totalBudget: number;       // Fixed total slots (e.g., 15)
  expansionMethod: 'text';   // Text-only, fair to all chunkers
}

async function multiHop(
  query: string,
  provider: LocalProvider,
  k: number,
  config: MultiHopConfig
): Promise<Chunk[]> {
  const seen = new Set<string>();
  const allChunks: ScoredChunk[] = [];
  let currentQueries = [query];
  let budgetRemaining = config.totalBudget;

  for (let hop = 0; hop < config.maxHops && budgetRemaining > 0; hop++) {
    const hopLimit = Math.min(config.chunksPerHop, budgetRemaining);

    for (const q of currentQueries) {
      const chunks = await provider.searchQuery(q, { limit: hopLimit });

      for (const chunk of chunks) {
        if (!seen.has(chunk.id)) {
          seen.add(chunk.id);
          allChunks.push({ ...chunk, hop });
          budgetRemaining--;
        }
      }
    }

    // Text-only expansion (fair to all chunkers)
    currentQueries = extractExpansionQueriesFromText(
      allChunks.filter(c => c.hop === hop)
    );
  }

  // Return top-K by original relevance
  return allChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
```

**Key Design Decisions:**

1. **Fixed total budget**: Multi-hop sees at most `totalBudget` chunks (e.g., 15), same as doing 1-hop with K=15. Apples-to-apples.

2. **Text-only expansion**: Extract queries from chunk text, not structured metadata. Fair to all chunkers.

3. **No new ground truth**: We evaluate against the **same ground truth** as single-hop (RepoEval line overlap, SWE-bench patch files).

---

## 3. Text-Only Expansion (Fair to All Chunkers)

The expansion logic must work on any chunk's text, not just code-chunk's structured context:

```typescript
function extractExpansionQueriesFromText(chunks: Chunk[]): string[] {
  const queries: string[] = [];

  for (const chunk of chunks) {
    const text = chunk.text;

    // Extract import statements (works on raw text)
    const importMatches = text.matchAll(
      /(?:import|from)\s+([a-zA-Z_][\w.]*)/g
    );
    for (const match of importMatches) {
      queries.push(`${match[1]} implementation`);
    }

    // Extract function calls (works on raw text)
    const callMatches = text.matchAll(
      /([a-zA-Z_]\w*)\s*\(/g
    );
    for (const match of callMatches) {
      const fnName = match[1];
      // Skip common builtins/keywords
      if (!['if', 'for', 'while', 'return', 'print', 'len', 'str', 'int'].includes(fnName)) {
        queries.push(`function ${fnName} definition`);
      }
    }

    // Extract class references (works on raw text)
    const classMatches = text.matchAll(
      /class\s+(\w+)|extends\s+(\w+)|:\s*(\w+)\s*[,)]/g
    );
    for (const match of classMatches) {
      const className = match[1] || match[2] || match[3];
      if (className) {
        queries.push(`class ${className}`);
      }
    }
  }

  // Deduplicate and limit
  return [...new Set(queries)].slice(0, 5);
}
```

**Why text-only is fair:**
- Fixed chunkers can still benefit from multi-hop if their text happens to contain import/call patterns
- AST chunkers don't get special treatment from structured metadata
- Tests whether the chunking itself preserves readable dependency signals

---

## 4. Budget Fairness

### 4.1 The Problem

Multi-hop naturally sees more chunks before truncating to K. This is unfair unless controlled.

### 4.2 The Solution: Fixed Total Budget

```typescript
// Option A: Equal total slots
const singleHopConfig = { k: 10 };
const multiHopConfig = { totalBudget: 10, k: 10 };  // Same total exposure

// Option B: Allow multi-hop more slots but report cost
const multiHopConfig = { totalBudget: 15, k: 10 };  // 1.5x budget
// Report: "multi-hop uses 1.5x budget for +X% recall"
```

### 4.3 Cost Metrics to Report

```typescript
interface CostMetrics {
  embedding_calls: number;    // 1 for single-hop, 1+ for multi-hop
  chunks_examined: number;    // How many chunks were scored/seen
  retrieval_passes: number;   // Number of search calls
}
```

---

## 5. Using Existing Ground Truth

**No new annotations needed.** We reuse what Phases 4-6 already define:

| Dataset | Existing Ground Truth | How Multi-Hop Uses It |
|---------|----------------------|----------------------|
| **RepoEval** | Line range overlap (startLine, endLine) | Same: did we retrieve a chunk covering the target lines? |
| **RepoBench-R** | Gold snippet Jaccard similarity | Same: does retrieved chunk match gold snippet? |
| **SWE-bench** | Patch file list | Same: File-Recall = did we hit all patched files? |

Multi-hop might find the same ground truth chunks through a different path, but **success is measured the same way**.

---

## 6. Evaluation Output

### 6.1 Per-Sample Results

```typescript
interface PolicyComparisonResult {
  sample_id: string;
  benchmark: string;
  provider: string;
  embedding: string;

  single_hop: {
    recall_at_5: number;
    recall_at_10: number;
    ndcg_at_10: number;
    mrr: number;
    file_recall_at_10: number;  // For SWE-bench
    embedding_calls: 1;
    chunks_examined: number;
  };

  multi_hop: {
    recall_at_5: number;
    recall_at_10: number;
    ndcg_at_10: number;
    mrr: number;
    file_recall_at_10: number;
    embedding_calls: number;
    chunks_examined: number;
    hops_used: number;
  };

  delta: {
    delta_recall_10: number;       // multi - single
    delta_file_recall_10: number;
    delta_ndcg_10: number;
    pct_improvement: number;       // (multi - single) / single * 100
  };

  cost: {
    embed_call_ratio: number;      // multi / single
    chunks_examined_ratio: number;
  };
}
```

### 6.2 Aggregated Results Table

```markdown
## RepoEval: Single-Hop vs Multi-Hop (Budget=15)

| Chunker | Embedding | Policy | Recall@10 | File-R@10 | Embed Calls |
|---------|-----------|--------|-----------|-----------|-------------|
| code-chunk-ast | voyage-3 | 1-hop | 0.681 | 0.523 | 1 |
| code-chunk-ast | voyage-3 | H-hop | 0.723 | 0.589 | 2.1 |
| code-chunk-ast | voyage-3 | **Δ** | **+0.042** | **+0.066** | 2.1x |
|---------|-----------|--------|-----------|-----------|-------------|
| code-chunk-fixed | voyage-3 | 1-hop | 0.612 | 0.467 | 1 |
| code-chunk-fixed | voyage-3 | H-hop | 0.634 | 0.489 | 2.3 |
| code-chunk-fixed | voyage-3 | **Δ** | +0.022 | +0.022 | 2.3x |
|---------|-----------|--------|-----------|-----------|-------------|
| chonkie-code | voyage-3 | 1-hop | 0.645 | 0.489 | 1 |
| chonkie-code | voyage-3 | H-hop | 0.678 | 0.534 | 2.2 |
| chonkie-code | voyage-3 | **Δ** | +0.033 | +0.045 | 2.2x |

### Key Finding
code-chunk-ast shows 3x better Δ File-Recall than fixed chunking,
suggesting AST-aware chunking preserves dependency signals even
when extracted via text-only heuristics.
```

---

## 7. Implementation

### 7.1 File Structure

```
/memorybench-bench-code-chunk/src/
├── evaluation/
│   ├── single-hop.ts       # Existing (or trivial wrapper)
│   ├── multi-hop.ts        # NEW: MultiHopExecutor
│   ├── text-expansion.ts   # NEW: extractExpansionQueriesFromText
│   └── policy-comparison.ts # NEW: Run both, compute deltas
└── cli/
    └── commands/
        └── eval-policy.ts  # NEW: CLI for policy comparison
```

### 7.2 MultiHopExecutor (Minimal)

```typescript
// /memorybench-bench-code-chunk/src/evaluation/multi-hop.ts

import { LocalProvider, SearchResult } from '../providers/types';
import { extractExpansionQueriesFromText } from './text-expansion';

export interface MultiHopConfig {
  maxHops: number;
  chunksPerHop: number;
  totalBudget: number;
}

export const DEFAULT_CONFIG: MultiHopConfig = {
  maxHops: 2,
  chunksPerHop: 5,
  totalBudget: 15,
};

export async function multiHopRetrieve(
  query: string,
  provider: LocalProvider,
  k: number,
  config: MultiHopConfig = DEFAULT_CONFIG
): Promise<{ results: SearchResult[]; stats: MultiHopStats }> {
  const seen = new Map<string, SearchResult & { hop: number }>();
  let currentQueries = [query];
  let embedCalls = 0;
  let budgetRemaining = config.totalBudget;

  for (let hop = 0; hop < config.maxHops && budgetRemaining > 0 && currentQueries.length > 0; hop++) {
    const hopLimit = Math.min(config.chunksPerHop, Math.ceil(budgetRemaining / currentQueries.length));

    for (const q of currentQueries) {
      embedCalls++;
      const results = await provider.searchQuery(q, { limit: hopLimit });

      for (const result of results) {
        if (!seen.has(result.id) && budgetRemaining > 0) {
          seen.set(result.id, { ...result, hop });
          budgetRemaining--;
        }
      }
    }

    // Text-only expansion for next hop
    const hopResults = [...seen.values()].filter(r => r.hop === hop);
    currentQueries = extractExpansionQueriesFromText(hopResults.map(r => r.text));
  }

  // Sort by score, return top-K
  const allResults = [...seen.values()].sort((a, b) => b.score - a.score);

  return {
    results: allResults.slice(0, k),
    stats: {
      embedCalls,
      chunksExamined: seen.size,
      hopsUsed: Math.max(...[...seen.values()].map(r => r.hop)) + 1,
    },
  };
}
```

### 7.3 CLI Command

```typescript
// bun run cli/index.ts eval:policy-compare --benchmarks repoeval --providers code-chunk-ast

import { Command } from 'commander';
import { singleHopRetrieve } from '../evaluation/single-hop';
import { multiHopRetrieve, DEFAULT_CONFIG } from '../evaluation/multi-hop';
import { calculateMetrics } from '../metrics';

export const policyCompareCommand = new Command('eval:policy-compare')
  .requiredOption('--benchmarks <name>', 'Benchmark to evaluate')
  .requiredOption('--providers <name>', 'Provider to use')
  .option('--embeddings <name>', 'Embedding model(s)', 'voyage-code-3')
  .option('--budget <n>', 'Multi-hop total budget', '15')
  .option('--output <path>', 'Output file path')
  .action(async (opts) => {
    const samples = await loadDataset(opts.benchmarks);
    const provider = await createProvider(opts.providers, opts.embeddings);

    const results: PolicyComparisonResult[] = [];

    for (const sample of samples) {
      // Single-hop
      const singleResults = await singleHopRetrieve(sample.query, provider, 10);
      const singleMetrics = calculateMetrics(singleResults, sample.groundTruth);

      // Multi-hop
      const { results: multiResults, stats } = await multiHopRetrieve(
        sample.query,
        provider,
        10,
        { ...DEFAULT_CONFIG, totalBudget: parseInt(opts.budget) }
      );
      const multiMetrics = calculateMetrics(multiResults, sample.groundTruth);

      results.push({
        sample_id: sample.id,
        benchmark: opts.benchmarks,
        provider: opts.providers,
        embedding: opts.embeddings,
        single_hop: { ...singleMetrics, embedding_calls: 1 },
        multi_hop: { ...multiMetrics, ...stats },
        delta: computeDeltas(singleMetrics, multiMetrics),
        cost: {
          embed_call_ratio: stats.embedCalls,
          chunks_examined_ratio: stats.chunksExamined / 10,
        },
      });
    }

    // Output
    if (opts.output) {
      await writeFile(opts.output, JSON.stringify(results, null, 2));
    }

    // Print summary
    printPolicyComparisonSummary(results);
  });
```

---

## 8. Effort Estimate (Phase 9A Only)

| Task | Hours |
|------|-------|
| `multi-hop.ts` - MultiHopExecutor | 6 |
| `text-expansion.ts` - Text-only query extraction | 4 |
| `policy-comparison.ts` - Run both, compute deltas | 4 |
| CLI command `eval:policy-compare` | 4 |
| Integration tests | 4 |
| Run on RepoEval + SWE-bench | 4 |
| Documentation | 2 |
| **Total** | **28 hours** |

---

## 9. What Phase 9A Does NOT Include

These are deferred to **Phase 9B** (optional future work):

| Feature | Why Deferred |
|---------|--------------|
| Dependency graph extraction | Adds 40+ hours, not needed for policy comparison |
| New multi-hop ground truth | Big research effort, needs annotation |
| LLM-assisted query generation | Contradicts "no LLM" runtime story |
| Path coverage metrics | Requires dependency graph |
| Hop-wise metrics | Nice-to-have, not essential for delta analysis |
| Structured metadata expansion | Unfair to non-AST chunkers |

---

## 10. Success Criteria (Phase 9A)

| Criterion | Target |
|-----------|--------|
| Policy comparison runs on all datasets | ✅ |
| Uses existing ground truth (no new annotations) | ✅ |
| Text-only expansion (fair to all chunkers) | ✅ |
| Fixed budget enforced | ✅ |
| Reports Δ Recall, Δ File-Recall, cost | ✅ |
| Shows differentiation between chunkers | TBD (hypothesis: AST > fixed) |

---

# Phase 9B: Advanced Multi-Hop Benchmark (Future)

> **Note:** This is optional future work. Only pursue if Phase 9A shows promising results and you want publishable novelty.

## Scope

- Build dependency graphs (tree-sitter)
- Create new multi-hop ground truth with dependency paths
- Add path coverage metrics
- Optional LLM-assisted annotation (offline only)
- Statistical significance tests

## Estimated Effort

120-160 hours (see original Phase 9 doc for breakdown)

## When to Do Phase 9B

1. Phase 9A shows code-chunk has meaningfully higher Δ than baselines
2. You want to publish a paper on multi-hop code retrieval
3. You have 3-4 weeks of engineering capacity

---

**End of Phase 9 Specification**
