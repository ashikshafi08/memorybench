# CodeChunkBench: Complete Benchmark Overview

## What Is This?

**CodeChunkBench** is a benchmark suite that **measures and compares** code chunking strategies for retrieval tasks (the retrieval stage of RAG systems). It includes **code-chunk**, **fixed-size**, and **chonkie** as built-in providers, but any chunker implementing the provider interface can be benchmarked.

> **Note:** This benchmarks retrieval quality (embedding + similarity search), not code generation. Results show which chunking strategy produces better chunks for retrieval; downstream generation is out of scope.

---

## Chunker-Agnostic Design

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CodeChunkBench is chunker-agnostic: any chunker that implements the       │
│  Provider interface can be benchmarked.                                    │
│                                                                             │
│  Built-in providers:                                                        │
│  • code-chunk-ast    (AST-aware, includes contextualizedText)              │
│  • code-chunk-fixed  (NWS character baseline)                              │
│  • chonkie-code      (tree-sitter semantic)                                │
│  • chonkie-recursive (character fallback)                                  │
│                                                                             │
│  To add your own chunker:                                                  │
│  1. Implement the Provider interface (addContext, searchQuery, clear)      │
│  2. Register in providers/                                                 │
│  3. Run: bun run cli eval --providers your-chunker --benchmarks repoeval   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## The Problem We're Solving

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  "Which code chunker should I use for my RAG system?"                       │
│                                                                              │
│  Current State:                                                              │
│  • No standard benchmark for comparing code chunkers                         │
│  • Most benchmarks (CoIR, MTEB) test embeddings, NOT chunking quality       │
│  • Claims like "AST-aware is better" lack rigorous measurement              │
│                                                                              │
│  CodeChunkBench Addresses This:                                             │
│  • Apples-to-apples comparison of chunking strategies                        │
│  • Real code retrieval tasks (true-chunking benchmarks)                     │
│  • Multiple benchmarks, embeddings, and retrieval policies                  │
│  • Reproducible results with standard IR metrics                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Visual Architecture

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                           CODECHUNKBENCH PIPELINE                             ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║                                                                               ║
║  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐ ║
║  │ BENCHMARKS  │     │  PROVIDERS  │     │ EMBEDDINGS  │     │  POLICIES   │ ║
║  │  (Phase 2-6)│     │  (Phase 7)  │     │  (Phase 8)  │     │  (Phase 9)  │ ║
║  ├─────────────┤     ├─────────────┤     ├─────────────┤     ├─────────────┤ ║
║  │ RepoEval    │     │ code-chunk  │     │ OpenAI      │     │ 1-hop       │ ║
║  │ RepoBench-R │  ×  │ (AST-aware) │  ×  │ small       │  ×  │ (baseline)  │ ║
║  │ SWE-bench   │     │ Fixed       │     │             │     │             │ ║
║  │ Lite        │     │ (NWS-based) │     │ Voyage      │     │ H-hop       │ ║
║  │             │     │ Chonkie     │     │ code-3      │     │ (multi-hop) │ ║
║  └─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘ ║
║         │                   │                   │                   │        ║
║         └───────────────────┴───────────────────┴───────────────────┘        ║
║                                     │                                         ║
║                                     ▼                                         ║
║  ┌───────────────────────────────────────────────────────────────────────┐   ║
║  │                         EVALUATION ENGINE                              │   ║
║  │                           (Phase 1)                                    │   ║
║  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │   ║
║  │  │  nDCG@K ✅  │  │ Recall@K ✅ │  │   MRR ✅    │  │ Precision@K │   │   ║
║  │  │ (implemented)│  │(implemented)│  │(implemented)│  │    ✅       │   │   ║
║  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │   ║
║  │                                                                        │   ║
║  │  ┌─────────────────────────────────────────────────────────────────┐  │   ║
║  │  │ File-Recall@K (planned - Phase 6, for SWE-bench multi-file)     │  │   ║
║  │  └─────────────────────────────────────────────────────────────────┘  │   ║
║  └───────────────────────────────────────────────────────────────────────┘   ║
║                                     │                                         ║
║                                     ▼                                         ║
║  ┌───────────────────────────────────────────────────────────────────────┐   ║
║  │                          RESULTS & COMPARISON                          │   ║
║  │                                                                        │   ║
║  │   Provider         │ nDCG@10 │ Recall@10 │ MRR   │ Δ Multi-hop        │   ║
║  │   ─────────────────┼─────────┼───────────┼───────┼───────────────────  │   ║
║  │   code-chunk-ast   │  (TBD)  │   (TBD)   │ (TBD) │    (TBD)           │   ║
║  │   chonkie-code     │  (TBD)  │   (TBD)   │ (TBD) │    (TBD)           │   ║
║  │   code-chunk-fixed │  (TBD)  │   (TBD)   │ (TBD) │    (TBD)           │   ║
║  │                                                                        │   ║
║  │   Results will show which chunking strategy performs best.            │   ║
║  └───────────────────────────────────────────────────────────────────────┘   ║
║                                                                               ║
╚═══════════════════════════════════════════════════════════════════════════════╝
```

---

## The 4 Evaluation Axes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│    For each sample, we run:                                                  │
│                                                                              │
│    Benchmark × Provider × Embedding × Policy → Metrics                       │
│       │           │          │          │                                    │
│       │           │          │          └─── 1-hop (baseline)                │
│       │           │          │               H-hop (multi-hop, tests synergy)│
│       │           │          │                                               │
│       │           │          └─── OpenAI text-embedding-3-small              │
│       │           │               Voyage voyage-code-3 (code-optimized)      │
│       │           │                                                          │
│       │           └─── code-chunk-ast (contextualizedText)                   │
│       │                code-chunk-fixed (NWS baseline)                       │
│       │                chonkie-code (tree-sitter semantic)                   │
│       │                chonkie-recursive (character fallback)                │
│       │                                                                      │
│       └─── RepoEval (Python, 3,655 samples, line-range overlap)             │
│            RepoBench-R (Python+Java, 192K samples, Jaccard matching)        │
│            SWE-bench Lite (Python, 323 samples, patch file ground truth)    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase-by-Phase Breakdown

### Phase 1: Retrieval Metrics (IMPLEMENTED)
```
┌──────────────────────────────────────────────────────────────────┐
│  METRICS ENGINE                                                  │
│                                                                  │
│  ✅ nDCG@K  = Ranking quality (higher = better ranking)         │
│  ────────────────────────────────────────────────────────────── │
│  Formula: DCG@K / IDCG@K                                         │
│  DCG = Σ(i=1→K) [rel_i / log₂(i+1)]                             │
│  Uses: Ground truth relevance (line overlap, Jaccard, etc.)     │
│                                                                  │
│  ✅ Recall@K = Coverage (did we find the relevant chunks?)      │
│  ────────────────────────────────────────────────────────────── │
│  Formula: |retrieved ∩ relevant| / |relevant|                   │
│                                                                  │
│  ✅ MRR = First hit quality (where's the first relevant chunk?) │
│  ────────────────────────────────────────────────────────────── │
│  Formula: 1 / rank_of_first_relevant                            │
│                                                                  │
│  ✅ Precision@K = Precision at K                                │
│  ────────────────────────────────────────────────────────────── │
│  Formula: |relevant in top-K| / K                               │
│                                                                  │
│  ⏳ File-Recall@K = Multi-file coverage (PLANNED - Phase 6)     │
│  ────────────────────────────────────────────────────────────── │
│  Formula: |files_with_chunk_in_topK| / |required_files|         │
│  For SWE-bench where ground truth spans multiple files          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Phase 2-3: Benchmark Selection & Validation
```
┌──────────────────────────────────────────────────────────────────┐
│  BENCHMARK SELECTION CRITERIA                                    │
│                                                                  │
│  ✅ TRUE CHUNKING benchmarks (we chunk raw repos):              │
│     • RepoEval - function/line/API completion                   │
│     • RepoBench-R - explicit retrieval task                     │
│     • SWE-bench Lite - real bug localization                    │
│     • CrossCodeEval - cross-file dependencies                   │
│                                                                  │
│  ❌ PRE-CHUNKED benchmarks (already chunked, tests embedding):  │
│     • CoIR - fixed corpus                                        │
│     • CodeSearchNet - pre-defined documents                      │
│     • MTEB - embedding-focused                                   │
│                                                                  │
│  Why this matters: We want to test CHUNKING quality,            │
│  not embedding quality. Pre-chunked benchmarks don't help.      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Phase 4-6: Benchmark Implementations
```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  REPOEVAL (Phase 4)                    REPOBENCH-R (Phase 5)               │
│  ─────────────────                     ──────────────────                  │
│  • 3,655 Python samples                • 192K samples (Python + Java)      │
│  • 8 repositories                      • Gold snippet with index           │
│  • Line-range overlap matching         • Jaccard similarity matching       │
│                                                                             │
│  Ground Truth:                         Ground Truth:                       │
│  chunk.startLine ≤ target ≤ endLine    jaccard(chunk, gold) ≥ 0.7          │
│                                                                             │
│  ───────────────────────────────────────────────────────────────────────── │
│                                                                             │
│  SWE-BENCH LITE (Phase 6)                                                  │
│  ────────────────────────                                                  │
│  • 323 real GitHub issues (dev + test splits)                              │
│  • Issue description → find files to modify                                │
│  • Ground truth = files in the patch                                       │
│                                                                             │
│  Ground Truth:                                                             │
│  parsePatch(sample.patch) → ["file1.py", "file2.py"]                       │
│  File-Recall = did we retrieve chunks from these files?                    │
│                                                                             │
│  Infrastructure:                                                           │
│  • Bare clone + worktree strategy (save disk space)                        │
│  • Cache repos across samples                                              │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Phase 7: Chunker Providers
```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  PROVIDER INTERFACE (from providers/base/types.ts)                         │
│  ─────────────────────────────────────────────────                         │
│                                                                             │
│  interface Provider {                                                       │
│    readonly name: string;                                                  │
│    readonly displayName: string;                                           │
│    readonly capabilities: ProviderCapabilities;                            │
│                                                                             │
│    addContext(data: PreparedData, runTag: string): Promise<void>;          │
│    searchQuery(                                                            │
│      query: string,                                                        │
│      runTag: string,                                                       │
│      options?: SearchOptions                                               │
│    ): Promise<SearchResult[]>;                                             │
│    clear(runTag: string): Promise<void>;                                   │
│  }                                                                          │
│                                                                             │
│  interface SearchResult {                                                  │
│    id: string;                                                             │
│    content: string;                                                        │
│    score: number;                                                          │
│    chunks?: Array<{ content: string; score: number }>;                     │
│    metadata?: Record<string, unknown>;                                     │
│  }                                                                          │
│                                                                             │
│  ───────────────────────────────────────────────────────────────────────── │
│                                                                             │
│  BUILT-IN PROVIDERS                                                        │
│                                                                             │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐ │
│  │  code-chunk-ast     │  │  code-chunk-fixed   │  │  chonkie-code       │ │
│  │  ───────────────    │  │  ─────────────────  │  │  ─────────────      │ │
│  │  • AST-aware        │  │  • NWS character    │  │  • tree-sitter      │ │
│  │  • Preserves scope  │  │    based splitting  │  │    semantic         │ │
│  │  • contextualizedTxt│  │  • Baseline control │  │  • Multi-strategy   │ │
│  │    with imports,    │  │  • No context       │  │  • Code-aware       │ │
│  │    types, siblings  │  │    preservation     │  │    boundaries       │ │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────────┘ │
│                                                                             │
│  Note: runTag is used for scoping/isolation between benchmark runs.        │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Phase 8: Embedding Support
```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  EMBEDDING PROVIDERS                                                       │
│                                                                             │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐  │
│  │  OpenAI text-embedding-3-small  │  │  Voyage voyage-code-3           │  │
│  │  ─────────────────────────────  │  │  ─────────────────              │  │
│  │  • 1536 dimensions              │  │  • 1024 dimensions              │  │
│  │  • $0.02 / 1M tokens            │  │  • $0.18 / 1M tokens            │  │
│  │  • General purpose              │  │  • Code-optimized               │  │
│  │  • Good baseline                │  │  • Expected to perform better   │  │
│  └─────────────────────────────────┘  └─────────────────────────────────┘  │
│                                                                             │
│  DISK-BASED CACHING                                                        │
│  ──────────────────                                                        │
│  • Sharded by hash prefix (256 subdirectories)                             │
│  • Binary Float32Array storage                                             │
│  • Saves $$ on repeated evaluations                                        │
│  • Cache path: ~/.codechunkbench/embeddings/{provider}/{shard}/{hash}.bin │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Phase 9: Multi-Hop Evaluation
```
┌────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  WHY MULTI-HOP MATTERS                                                     │
│  ─────────────────────                                                     │
│                                                                             │
│  Real agentic code retrieval is NOT single-query:                          │
│                                                                             │
│  Query: "How does auth middleware work?"                                   │
│      │                                                                      │
│      ▼                                                                      │
│  Hop 1: Retrieve auth/middleware.ts                                        │
│      │   Found: validateJWT(token) call                                    │
│      ▼                                                                      │
│  Hop 2: Retrieve auth/jwt.ts (expand on "validateJWT")                     │
│      │   Found: getUserFromToken(decoded) call                             │
│      ▼                                                                      │
│  Hop 3: Retrieve auth/user.ts (expand on "getUserFromToken")               │
│                                                                             │
│  ───────────────────────────────────────────────────────────────────────── │
│                                                                             │
│  PHASE 9A: POLICY COMPARISON (28 hours)                                    │
│                                                                             │
│  For each (benchmark, provider, embedding):                                │
│                                                                             │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐          │
│  │  1-hop (baseline)           │  │  H-hop (multi-hop)          │          │
│  │  ───────────────            │  │  ─────────────────          │          │
│  │  • Single query → top-K     │  │  • Query → retrieve →       │          │
│  │  • 1 embedding call         │  │    expand → retrieve        │          │
│  │  • Isolates chunk quality   │  │  • 2-3 embedding calls      │          │
│  │                             │  │  • Tests synergy with policy │          │
│  └─────────────────────────────┘  └─────────────────────────────┘          │
│                                                                             │
│  Report: Δ Recall, Δ File-Recall, cost multiplier                          │
│                                                                             │
│  Key Design Decisions:                                                     │
│  • Fixed budget (apples-to-apples)                                         │
│  • Text-only expansion (fair to all providers)                             │
│  • Reuse existing ground truth (no new annotations)                        │
│                                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## CLI Usage

The CLI uses `--benchmarks` and `--providers` (not `--datasets` / `--chunkers`):

```bash
# Full evaluation across all axes
bun run cli eval \
  --benchmarks repoeval,repobench-r,swebench-lite \
  --providers code-chunk-ast,code-chunk-fixed,chonkie-code \
  --output results/full-eval.json

# Quick comparison (single benchmark)
bun run cli eval \
  --benchmarks repoeval \
  --providers code-chunk-ast,code-chunk-fixed \
  --limit 100 \
  --output results/quick-eval.json

# Policy comparison (1-hop vs H-hop) - Phase 9A
bun run cli eval:policy-compare \
  --benchmarks swebench-lite \
  --providers code-chunk-ast \
  --budget 15 \
  --output results/policy-compare.json

# List available benchmarks and providers
bun run cli list --benchmarks
bun run cli list --providers
```

---

## Implementation Status

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Phase │ Description                        │ Status          │ Effort     │
│────────┼────────────────────────────────────┼─────────────────┼────────────│
│   1    │ Retrieval Metrics (nDCG, Recall)   │ ✅ IMPLEMENTED  │ Done       │
│   2    │ Benchmark Selection                │ ✅ DOCUMENTED   │ Done       │
│   3    │ Dataset Validation                 │ ✅ DOCUMENTED   │ Done       │
│   4    │ RepoEval Implementation            │ ⏳ DOCUMENTED   │ 3-4 hrs    │
│   5    │ RepoBench-R Implementation         │ ⏳ DOCUMENTED   │ 4-5 hrs    │
│   6    │ SWE-bench Lite Implementation      │ ⏳ DOCUMENTED   │ 6-8 hrs    │
│   7    │ Chunker Providers                  │ ⏳ DOCUMENTED   │ 8-10 hrs   │
│   8    │ Embedding Support                  │ ⏳ DOCUMENTED   │ 4-6 hrs    │
│   9A   │ Multi-Hop Policy Mode              │ ⏳ DOCUMENTED   │ 28 hrs     │
│   9B   │ Advanced Multi-Hop (optional)      │ ⏳ DOCUMENTED   │ 120-160 hrs│
│────────┼────────────────────────────────────┼─────────────────┼────────────│
│ TOTAL  │ Phases 1-9A                        │                 │ ~60 hrs    │
└─────────────────────────────────────────────────────────────────────────────┘

Legend: ✅ = Implemented, ⏳ = Documented (code not yet written)
```

---

## File Structure

```
/memorybench-bench-code-chunk/
├── docs/
│   ├── CODECHUNKBENCH_OVERVIEW.md    # This file
│   ├── PHASE_1_RETRIEVAL_METRICS.md
│   ├── PHASE_2_CODE_RETRIEVAL_BENCHMARKS.md
│   ├── PHASE_3_DATASET_VALIDATION.md
│   ├── PHASE_4_REPOEVAL_IMPLEMENTATION.md
│   ├── PHASE_5_REPOBENCH_R_IMPLEMENTATION.md
│   ├── PHASE_6_SWEBENCH_LITE_IMPLEMENTATION.md
│   ├── PHASE_7_CHUNKER_PROVIDERS.md
│   ├── PHASE_8_EMBEDDING_SUPPORT.md
│   └── PHASE_9_MULTI_HOP_BENCHMARK.md
├── core/
│   ├── config.ts          # SearchResult, PreparedData interfaces
│   ├── runner.ts          # Benchmark execution engine
│   └── metrics/           # nDCG, Recall, MRR, Precision (Phase 1)
├── providers/
│   ├── base/
│   │   └── types.ts       # Provider interface with runTag
│   ├── adapters/          # Provider implementations
│   └── configs/           # YAML provider configs
├── benchmarks/            # Benchmark pack definitions (Phase 4-6)
├── cli/                   # CLI commands
└── results/               # Evaluation outputs
```

---

## What CodeChunkBench Measures

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  HYPOTHESIS 1: AST-aware chunking produces better chunks for retrieval     │
│  ───────────────────────────────────────────────────────────────────────    │
│  Measured by: nDCG@10 and Recall@10 across benchmarks                       │
│  Mechanism: contextualizedText includes imports, types, scope               │
│                                                                              │
│  HYPOTHESIS 2: AST-aware chunking benefits more from multi-hop retrieval   │
│  ───────────────────────────────────────────────────────────────────────    │
│  Measured by: Δ File-Recall when comparing 1-hop vs H-hop                   │
│  Mechanism: AST boundaries preserve dependency information in chunk text    │
│                                                                              │
│  HYPOTHESIS 3: The effect is consistent across embeddings                   │
│  ───────────────────────────────────────────────────────────────────────    │
│  Measured by: Results with both OpenAI and Voyage embeddings                │
│  Mechanism: Better chunks help any embedding model                          │
│                                                                              │
│  HYPOTHESIS 4: The effect is consistent across languages                    │
│  ───────────────────────────────────────────────────────────────────────    │
│  Measured by: Results on Python (RepoEval) and Java (RepoBench-R)           │
│  Mechanism: AST-aware approach is language-agnostic                         │
│                                                                              │
│  NOTE: These are hypotheses to be tested. Results will show whether         │
│  AST-aware chunking provides measurable benefits over baselines.            │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

**CodeChunkBench** is a benchmark suite that:

1. **Tests chunking quality** (not just embeddings) using true-chunking benchmarks
2. **Is chunker-agnostic**: any provider implementing the interface can be benchmarked
3. **Compares apples-to-apples** across 4 axes (benchmark × provider × embedding × policy)
4. **Reports standard IR metrics** (nDCG, Recall, MRR, Precision) with proper IDCG calculation
5. **Includes multi-hop evaluation** to measure real-world agentic retrieval scenarios
6. **Produces reproducible results** for comparing code chunking strategies

The goal: A **rigorous, reproducible benchmark** for the question "which code chunker should I use for RAG retrieval?"
