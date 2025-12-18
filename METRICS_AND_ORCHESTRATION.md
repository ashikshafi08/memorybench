# Metrics, Orchestration, and Standardization: Complete Guide

**Your Questions Answered:**
1. What can we learn from Mem0's evaluation?
2. How do we orchestrate all these metrics?
3. Do metrics change per benchmark?
4. Are we benchmarking providers or models?
5. How do we standardize everything?

---

## Part 1: What We Learned from Mem0's Evaluation

### Mem0's Approach (from https://github.com/mem0ai/mem0/tree/main/evaluation)

**Structure:**
```
mem0/evaluation/
├── run_experiments.py      # Orchestrator
├── evals.py                # Metric calculator
├── generate_scores.py      # Aggregator
├── src/
│   ├── mem0_add.py        # Mem0 implementation
│   ├── rag.py             # RAG baseline
│   ├── langmem.py         # LangMem implementation
│   ├── zep.py             # Zep implementation
│   └── openai_memory.py   # OpenAI memory implementation
└── Makefile               # CLI commands
```

**Key Insights:**

#### 1. Modular Technique Implementations
Each provider is a separate module:
```python
# mem0/evaluation/src/mem0_add.py
def add_memory(text: str, user_id: str, metadata: dict) -> None:
    # Provider-specific implementation
    ...

# mem0/evaluation/src/zep.py
def add_memory(text: str, session_id: str, metadata: dict) -> None:
    # Provider-specific implementation
    ...
```

**What we should copy:**
- ✅ One file per provider adapter
- ✅ Standardized interface (add, search, clear)
- ✅ Provider-specific parameters hidden behind interface

**What we already have:**
- ✅ We already do this with `providers/adapters/`!

#### 2. Multiple Metrics Tracked
```python
# mem0/evaluation/evals.py
metrics = {
    "bleu": calculate_bleu(expected, actual),
    "f1": calculate_f1(expected, actual),
    "llm_score": llm_judge(expected, actual, retrieved),
    "token_count": count_tokens(retrieved),
    "latency_ms": measure_latency()
}
```

**What we should copy:**
- ✅ Track multiple metrics simultaneously
- ✅ Include performance metrics (latency, tokens)
- ✅ Include quality metrics (BLEU, F1, LLM judge)

**Gap in our system:**
- ❌ We only track accuracy + basic retrieval metrics
- ❌ No latency tracking
- ❌ No token/cost tracking
- ❌ No BLEU/F1 scores

#### 3. Category-Based Breakdown
```python
# mem0/evaluation/generate_scores.py
def generate_scores_by_category(results):
    categories = [1, 2, 3]  # Question difficulty levels
    for category in categories:
        filtered = [r for r in results if r['category'] == category]
        print(f"Category {category}: {calculate_metrics(filtered)}")
```

**What we should copy:**
- ✅ Breakdown by category/question type
- ✅ Separate aggregation step

**What we already have:**
- ✅ We already do this with `calculateAccuracyByQuestionType()`!

#### 4. Makefile for Orchestration
```makefile
# Run Mem0 evaluation
mem0-add:
    python run_experiments.py --technique mem0 --action add

mem0-search:
    python run_experiments.py --technique mem0 --action search --chunk_size 512 --top_k 5

# Run all techniques
run-all: mem0-add mem0-search rag-add rag-search langmem-add ...
```

**What we should copy:**
- ✅ Simple CLI commands for common operations
- ✅ Parameterized runs (chunk_size, top_k, etc.)

**What we already have:**
- ✅ `memorybench eval` CLI already does this!
- ⚠️ But we need more parameter support (k values, model overrides)

#### 5. Three-Phase Execution
```
Phase 1: Add memories    (run_experiments.py --action add)
Phase 2: Search/retrieve (run_experiments.py --action search)
Phase 3: Evaluate        (evals.py)
Phase 4: Aggregate       (generate_scores.py)
```

**What we already have:**
- ✅ We do this in `runner.ts`! (ingest → search → evaluate)
- ✅ Checkpoint resumption between phases

### What to Adopt from Mem0

| Feature | Mem0 Has It? | We Have It? | Priority |
|---------|--------------|-------------|----------|
| Modular provider adapters | ✅ | ✅ | N/A - done |
| Multiple metrics | ✅ | ❌ | **HIGH** |
| BLEU/F1 scores | ✅ | ❌ | MEDIUM |
| Latency tracking | ✅ | ❌ | **HIGH** |
| Token/cost tracking | ✅ | ❌ | **HIGH** |
| Category breakdown | ✅ | ✅ | N/A - done |
| CLI orchestration | ✅ | ✅ | N/A - done |
| Parameterized runs | ✅ | ⚠️ | MEDIUM |

---

## Part 2: How to Orchestrate All These Metrics

### Current Problem

**From our codebase analysis:**
```typescript
// Current: Hardcoded metrics in runner
const correctCount = evalResults.filter((r) => r.correct).length;
const accuracy = evalResults.length > 0 ? correctCount / evalResults.length : 0;

// Problem: Adding new metrics requires modifying runner.ts!
```

### Solution: Metric Registry Pattern (from MTEB)

**How MTEB standardizes across 8 task types (56 datasets):**

#### 1. Task-Specific Metric Definitions
```python
# From MTEB architecture
class ClassificationTask:
    metrics = ["accuracy", "f1", "precision", "recall"]

class RetrievalTask:
    metrics = ["ndcg@10", "map", "mrr", "recall@100"]

class STSTask:
    metrics = ["pearson", "spearman"]
```

**Translation to Context Bench:**
```yaml
# benchmarks/configs/longmemeval.yaml
metrics:
  - accuracy               # All benchmarks
  - recall_at_5           # Memory benchmarks
  - recall_at_10          # Memory benchmarks
  - latency_p95           # All benchmarks
  - cost_per_query        # All benchmarks

# benchmarks/configs/legal-rag.yaml
metrics:
  - accuracy
  - ndcg_at_10            # RAG-specific
  - map                   # RAG-specific
  - citation_accuracy     # Domain-specific!
  - latency_p95
```

#### 2. Standardized Metric Interface
```typescript
// core/metrics/interface.ts
interface MetricCalculator {
    name: string;
    category: "retrieval" | "generation" | "performance" | "cost" | "custom";

    calculate(
        results: EvalResult[],
        config?: MetricConfig
    ): MetricResult;

    // Optional: Breakdown support
    calculateWithBreakdown?(
        results: EvalResult[],
        dimension: string
    ): Record<string, MetricResult>;
}

interface MetricResult {
    value: number;
    details?: {
        total?: number;
        correct?: number;
        stats?: {
            mean?: number;
            p50?: number;
            p95?: number;
            p99?: number;
        };
    };
}
```

#### 3. Metric Registry
```typescript
// core/metrics/registry.ts
class MetricRegistry {
    private metrics = new Map<string, MetricCalculator>();

    register(metric: MetricCalculator) {
        this.metrics.set(metric.name, metric);
    }

    calculateAll(
        results: EvalResult[],
        requestedMetrics: string[]
    ): MetricResult[] {
        return requestedMetrics.map(name => {
            const calculator = this.metrics.get(name);
            return calculator.calculate(results);
        });
    }
}

// Usage in runner
const registry = new MetricRegistry();
registry.register(new AccuracyMetric());
registry.register(new NDCGMetric());
registry.register(new LatencyMetric());
registry.register(new CostMetric());

const metrics = registry.calculateAll(results, benchmarkConfig.metrics);
```

#### 4. Built-in Metrics

**Retrieval Metrics:**
```typescript
class NDCGMetric implements MetricCalculator {
    name = "ndcg_at_10";
    category = "retrieval";

    calculate(results: EvalResult[], config?: {k?: number}): MetricResult {
        const k = config?.k ?? 10;
        // NDCG calculation logic
        return { value: ndcg, details: { k } };
    }
}

class MAPMetric implements MetricCalculator {
    name = "map";
    category = "retrieval";
    // ...
}
```

**Performance Metrics:**
```typescript
class LatencyMetric implements MetricCalculator {
    name = "latency";
    category = "performance";

    calculate(results: EvalResult[]): MetricResult {
        const latencies = results.map(r => r.metadata?.latency_ms ?? 0).sort();

        return {
            value: mean(latencies),
            details: {
                stats: {
                    mean: mean(latencies),
                    p50: percentile(latencies, 50),
                    p95: percentile(latencies, 95),
                    p99: percentile(latencies, 99),
                }
            }
        };
    }
}
```

**Cost Metrics:**
```typescript
class CostMetric implements MetricCalculator {
    name = "cost_per_query";
    category = "cost";

    calculate(results: EvalResult[]): MetricResult {
        const totalCost = results.reduce((sum, r) => {
            const tokens = r.metadata?.total_tokens ?? 0;
            const costPerToken = 0.00001; // $0.01 per 1K tokens
            return sum + (tokens * costPerToken);
        }, 0);

        return {
            value: totalCost / results.length,
            details: {
                totalCost,
                totalQueries: results.length
            }
        };
    }
}
```

**Domain-Specific Metrics:**
```typescript
class LegalCitationAccuracyMetric implements MetricCalculator {
    name = "legal_citation_accuracy";
    category = "custom";

    async calculate(results: EvalResult[]): Promise<MetricResult> {
        // Use LLM to check if citations are valid
        const correct = await Promise.all(
            results.map(r => this.verifyCitations(r.actual, r.expected))
        );

        return {
            value: correct.filter(Boolean).length / results.length,
            details: { correct: correct.filter(Boolean).length }
        };
    }
}
```

#### 5. Orchestration Flow

```typescript
// core/runner.ts - Updated flow
async runSingle(params: RunParams): Promise<BenchmarkProviderResult> {
    // Phase 1: Ingest
    await this.ingestContexts(provider, items, runTag);

    // Phase 2: Search & Track Metrics
    const startTime = Date.now();
    const searchResults = await provider.searchQuery(question, runTag);
    const searchLatency = Date.now() - startTime;

    // Phase 3: Evaluate & Track Metrics
    const answerStartTime = Date.now();
    const answer = await this.generateAnswer(searchResults, question);
    const answerLatency = Date.now() - answerStartTime;

    const score = await this.judge(answer, expected);

    // Store all metadata for metrics
    const evalResult: EvalResult = {
        ...baseFields,
        metadata: {
            searchLatency,
            answerLatency,
            totalTokens: answer.usage.total_tokens,
            retrievedDocs: searchResults.length,
            ...item.metadata
        }
    };

    // Phase 4: Calculate Metrics (after all results collected)
    const metricRegistry = this.getMetricRegistry();
    const metrics = metricRegistry.calculateAll(
        evalResults,
        benchmarkConfig.metrics
    );

    return {
        benchmark,
        provider,
        metrics,  // ← Array of MetricResult
        results: evalResults
    };
}
```

### Answer: Do We Need Scripts for Each Metric?

**NO! We use the Registry Pattern.**

**Instead of:**
```bash
# BAD: One script per metric
./scripts/calculate_accuracy.ts
./scripts/calculate_ndcg.ts
./scripts/calculate_latency.ts
./scripts/calculate_cost.ts
```

**We do:**
```typescript
// GOOD: Registry auto-discovers metrics
const registry = new MetricRegistry();

// Register once at startup
registry.register(new AccuracyMetric());
registry.register(new NDCGMetric());
registry.register(new LatencyMetric());

// Use everywhere
const metrics = registry.calculateAll(results, ["accuracy", "ndcg", "latency"]);
```

**Benefits:**
- ✅ One registry, infinite metrics
- ✅ Metrics are pluggable (drop in new file, auto-registered)
- ✅ YAML config selects which metrics to run
- ✅ No switch statements

---

## Part 3: Do Metrics Change Per Benchmark?

### Short Answer: **YES, but we standardize the interface.**

### Analysis from Papers

**LoCoMo Paper:**
- Metrics: Accuracy by category (1-hop, 2-hop, temporal, open-domain)
- Formula: Exact string match (strict)

**LongMemEval Paper:**
- Metrics: Accuracy by question type (6 types)
- Formula: LLM judge (flexible)

**Zep Paper (your image):**
- Metrics: Accuracy by question type (6 types) + Latency (p95) + Token count
- Formula: LLM judge + performance measurement

**Legal-RAG (domain-specific):**
- Metrics: NDCG@10, MAP, Recall@100
- Formula: Retrieval-based (no generation)

### The Pattern: Same Metric Name, Different Implementations

**Example: "Accuracy"**

```typescript
// LoCoMo: Exact match
class ExactMatchAccuracy implements MetricCalculator {
    name = "accuracy";
    calculate(results: EvalResult[]): MetricResult {
        const correct = results.filter(r =>
            r.actual.trim() === r.expected.trim()
        ).length;
        return { value: correct / results.length };
    }
}

// LongMemEval: LLM judge
class LLMJudgeAccuracy implements MetricCalculator {
    name = "accuracy";
    async calculate(results: EvalResult[]): Promise<MetricResult> {
        const scores = await Promise.all(
            results.map(r => this.judge(r.actual, r.expected))
        );
        const correct = scores.filter(s => s >= 0.8).length;
        return { value: correct / results.length };
    }
}
```

### How MTEB Solves This

From the research:
> "MTEB uses task definitions that encapsulate evaluation logic for different paradigms (classification, clustering, retrieval, etc.)"

**MTEB's Approach:**
```python
# Classification task
class ClassificationTask:
    def evaluate(self, predictions, labels):
        return {
            "accuracy": accuracy_score(labels, predictions),
            "f1": f1_score(labels, predictions)
        }

# Retrieval task (different metrics!)
class RetrievalTask:
    def evaluate(self, retrieved, relevant):
        return {
            "ndcg@10": ndcg_score(relevant, retrieved, k=10),
            "map": map_score(relevant, retrieved)
        }
```

### Our Solution: Benchmark-Specific Metric Selection

```yaml
# benchmarks/configs/locomo.yaml
metrics:
  - name: accuracy
    method: exact_match         # ← Benchmark specifies method
  - name: accuracy_by_category
    method: exact_match
    breakdown: [category]

# benchmarks/configs/longmemeval.yaml
metrics:
  - name: accuracy
    method: llm_judge            # ← Different method!
    config:
      model: "gpt-4o"
      threshold: 0.8
  - name: accuracy_by_question_type
    method: llm_judge
    breakdown: [questionType]

# benchmarks/configs/legal-rag.yaml
metrics:
  - name: ndcg_at_10             # ← Completely different metric!
  - name: map
  - name: legal_citation_accuracy
    method: custom
    evaluator: ./legal_evaluator.ts
```

### Registry Supports Multiple Implementations

```typescript
// core/metrics/registry.ts
class MetricRegistry {
    register(metric: MetricCalculator, alias?: string) {
        this.metrics.set(alias ?? metric.name, metric);
    }
}

// Registration
registry.register(new ExactMatchAccuracy(), "accuracy.exact_match");
registry.register(new LLMJudgeAccuracy(), "accuracy.llm_judge");
registry.register(new NDCGMetric(), "ndcg_at_10");

// Benchmark config selects implementation
const benchmarkConfig = {
    metrics: [
        { name: "accuracy.llm_judge" }  // Explicit selection
    ]
};
```

### Answer: Yes, Metrics Change, But We Standardize

**Standardization Strategy:**

1. **Common metric names** (accuracy, ndcg, latency)
2. **Multiple implementations** per metric (exact_match, llm_judge, semantic_similarity)
3. **Benchmark selects** which implementation via config
4. **Registry manages** all implementations
5. **Interface is uniform** (all return `MetricResult`)

**This allows:**
- LoCoMo to use exact match
- LongMemEval to use LLM judge
- Legal-RAG to use retrieval metrics
- **All stored in same results database**
- **All displayed on same leaderboard**

---

## Part 4: Provider vs Model - CRITICAL FINDING

### The Confusion: What Are We Actually Benchmarking?

**From Zep paper (your image):**
```
"Zep + gpt-4o-mini" vs "Zep + gpt-4o"
```

**This tests TWO variables:**
1. Provider: Zep (retrieval system)
2. Model: gpt-4o-mini vs gpt-4o (answer generation)

### Critical Discovery from Codebase Analysis

**Currently, we conflate 3 different "models":**

```typescript
// 1. Provider's embedding model (for search)
// providers/configs/aqrag.yaml
embedding:
  provider: google
  model: "gemini-embedding-001"     // ← MODEL 1

// 2. Answer generation model (for creating answers)
// benchmarks/configs/longmemeval.yaml
evaluation:
  answeringModel:
    model: "gpt-4o"                 // ← MODEL 2

// 3. Judge model (for evaluating answers)
evaluation:
  judge:
    model: "gpt-4o"                 // ← MODEL 3
```

**But results only track provider:**
```typescript
interface EvalResult {
    provider: string;        // ✅ Tracked
    // ❌ NOT TRACKED: embedding model
    // ❌ NOT TRACKED: answering model
    // ❌ NOT TRACKED: judge model
}
```

### The Problem

**Example confusion:**
```
Result 1: AQRAG + Google embeddings + Claude answers + GPT-4o judge = 85% accuracy
Result 2: OpenRouter RAG + OpenAI embeddings + Claude answers + GPT-4o judge = 90% accuracy

Question: Is the 5% difference due to:
- Provider retrieval logic?
- Embedding model quality?
- Random variance?

Answer: WE DON'T KNOW! Results don't track embedding model.
```

### What We SHOULD Be Benchmarking

**Two separate benchmarks:**

#### Benchmark A: Provider Comparison (Fixed Models)
```yaml
# Fix all models, vary provider
benchmarks: [longmemeval]
providers: [aqrag, openrouter-rag, mem0, zep]
answeringModel: "gpt-4o"          # ← FIXED
judgeModel: "gpt-4o"              # ← FIXED

# Result: Pure provider comparison
```

#### Benchmark B: Model Comparison (Fixed Provider)
```yaml
# Fix provider, vary models
benchmarks: [longmemeval]
providers: [zep]                   # ← FIXED
answeringModels: ["gpt-4o-mini", "gpt-4o", "claude-3-5-sonnet"]
judgeModel: "gpt-4o"               # ← FIXED

# Result: Pure model comparison
```

### Solution: Track All Models in Results

```typescript
// Updated EvalResult interface
interface EvalResult {
    // Existing
    provider: string;

    // NEW: Track all models
    embeddingModel?: string;      // Provider's embedding model
    answeringModel: string;        // Model that generated answer
    judgeModel: string;            // Model that evaluated answer

    // Existing
    score: number;
    metadata: object;
}

// Updated runner to track models
const evalResult: EvalResult = {
    provider: providerName,
    embeddingModel: providerConfig.embedding?.model,
    answeringModel: answeringModelConfig.model,
    judgeModel: judgeConfig.model,
    // ...
};
```

### Leaderboard Implications

**Current leaderboard (WRONG):**
```
Provider      Accuracy
Zep           75.1%
Mem0          66.9%
Supermemory   68.4%
```
**Problem:** These used different models! Can't compare.

**Correct leaderboard:**
```
Provider      Embedding        Answering     Judge      Accuracy
Zep           (builtin)        gpt-4o        gpt-4o     75.1%
Mem0          (builtin)        gpt-4o        gpt-4o     66.9%
Supermemory   (builtin)        gpt-4o        gpt-4o     68.4%
AQRAG         gemini-embed     gpt-4o        gpt-4o     82.3%
OpenRouter    openai-embed     gpt-4o        gpt-4o     85.1%
```

**Now we can see:**
- Provider comparison: All use same answering/judge models
- Embedding matters: AQRAG (Google) vs OpenRouter (OpenAI)

### Model Override Support

```typescript
// cli/commands/eval.ts
interface EvalOptions {
    benchmarks: string[];
    providers: string[];

    // NEW: Model overrides
    answeringModel?: string;      // Override benchmark config
    judgeModel?: string;          // Override benchmark config
}

// Usage
memorybench eval longmemeval zep \
    --answering-model gpt-4o-mini \
    --judge-model gpt-4o
```

### Answer: We're Benchmarking Provider + Models

**The full picture:**
```
Benchmark Result =
    Provider (retrieval system)
    + Embedding Model (search quality)
    + Answering Model (generation quality)
    + Judge Model (evaluation bias)
    + Benchmark (dataset difficulty)
```

**To isolate variables:**
1. **Provider comparison:** Fix all models
2. **Model comparison:** Fix provider
3. **Full system:** Vary everything, track all variables

**Critical requirement:** Track ALL models in results database.

---

## Part 5: How to Standardize Everything

### Lessons from MTEB

From research:
> "MTEB's primary objective is to standardize and broaden the evaluation of text embedding models by aggregating a diverse set of tasks and datasets under a unified, task-agnostic interface."

**MTEB's standardization approach:**

1. **Standardized Model Interface**
   ```python
   class Model:
       def encode(texts: List[str]) -> np.ndarray:
           # All models implement this
   ```

2. **Standardized Task Interface**
   ```python
   class Task:
       def evaluate(model: Model) -> Dict[str, float]:
           # All tasks implement this
   ```

3. **Standardized Result Format**
   ```python
   {
       "task_name": "classification",
       "dataset": "amazon_reviews",
       "metrics": {
           "accuracy": 0.85,
           "f1": 0.83
       }
   }
   ```

### Our Standardization Strategy

#### 1. Standardized Provider Interface ✅ (Already Done)

```typescript
// providers/base/types.ts
interface Provider {
    initialize(): Promise<void>;
    addContext(data: PreparedData, runTag: string): Promise<void>;
    searchQuery(query: string, runTag: string, options?: SearchOptions): Promise<SearchResult[]>;
    clear(runTag: string): Promise<void>;
}
```

**All providers implement this** (AQRAG, Mem0, Supermemory, OpenRouter RAG)

#### 2. Standardized Benchmark Schema ✅ (Already Done)

```yaml
# All benchmarks follow this structure
name: benchmark-name
schema:
  itemId: "id"
  question: "question"
  answer: "answer"
  context: { ... }

evaluation:
  method: llm-judge | exact-match | semantic-similarity
  answeringModel: { ... }
  judge: { ... }

metrics:
  - accuracy
  - ...
```

#### 3. Standardized Metric Interface ⚠️ (Needs Implementation)

```typescript
// core/metrics/interface.ts
interface MetricCalculator {
    name: string;
    category: MetricCategory;
    calculate(results: EvalResult[], config?: MetricConfig): MetricResult;
}

interface MetricResult {
    value: number;
    details?: object;
}
```

**Status:** Need to implement (Phase 1 of roadmap)

#### 4. Standardized Result Format ✅ (Already Done)

```typescript
// core/config.ts
interface EvalResult {
    runId: string;
    benchmark: string;
    provider: string;
    itemId: string;
    question: string;
    expected: string;
    actual: string;
    score: number;
    correct: boolean;
    retrievedContext: string[];
    metadata: object;
}
```

**Enhancement needed:** Add model tracking

#### 5. Standardized Breakdown Dimensions ✅ (Already Done)

```typescript
// All benchmarks support these breakdowns
- byQuestionType: metadata.questionType
- byCategory: metadata.category
- overall: all results
```

#### 6. Standardized Reporting Format ⚠️ (Partially Done)

**Current:**
```typescript
interface BenchmarkProviderResult {
    benchmark: string;
    provider: string;
    accuracy: number;  // ← Only accuracy
    results: EvalResult[];
}
```

**Needed:**
```typescript
interface BenchmarkProviderResult {
    benchmark: string;
    provider: string;
    embeddingModel?: string;     // NEW
    answeringModel: string;       // NEW
    judgeModel: string;           // NEW
    metrics: MetricResult[];      // NEW: Array of all metrics
    results: EvalResult[];
}
```

### Standardization Checklist

| Component | Current State | Needs Work |
|-----------|---------------|------------|
| Provider interface | ✅ Standardized | ✅ Complete |
| Benchmark schema | ✅ Standardized | ⚠️ Add metric config |
| Metric interface | ❌ Hardcoded | ❌ Need registry |
| Result format | ✅ Standardized | ⚠️ Add model tracking |
| Breakdown dimensions | ✅ Standardized | ✅ Complete |
| Reporting format | ⚠️ Partial | ⚠️ Add multi-metric support |

---

## Part 6: Complete Architecture Proposal

### The Full System Design

```
┌─────────────────────────────────────────────────────────────┐
│                     CONTEXT BENCH                           │
└─────────────────────────────────────────────────────────────┘

┌──────────── BENCHMARKS ────────────┐
│ - LoCoMo                           │
│ - LongMemEval                      │
│ - Legal-RAG                        │
│ - Financial-RAG                    │
│ - ...                              │
│                                    │
│ Each defines:                      │
│   • Dataset                        │
│   • Evaluation method              │
│   • Metrics to calculate           │
│   • Question type breakdowns       │
└────────────────────────────────────┘
              ↓
┌──────────── RUNNER ────────────────┐
│ For each benchmark x provider:    │
│   1. Ingest contexts               │
│   2. Search queries (track time)   │
│   3. Generate answers (track time) │
│   4. Evaluate answers              │
│   5. Store results                 │
└────────────────────────────────────┘
              ↓
┌──────────── METRIC REGISTRY ───────┐
│ Built-in:                          │
│   • AccuracyMetric                 │
│   • NDCGMetric                     │
│   • LatencyMetric                  │
│   • CostMetric                     │
│                                    │
│ Custom (per benchmark):            │
│   • LegalCitationMetric            │
│   • CodeCorrectnessMetric          │
│                                    │
│ For each metric:                   │
│   • Calculate overall              │
│   • Calculate by question type     │
│   • Calculate by category          │
└────────────────────────────────────┘
              ↓
┌──────────── RESULTS STORE ─────────┐
│ Tables:                            │
│   • results (per-item results)     │
│   • run_metrics (aggregated)       │
│   • result_metrics (detailed)      │
│                                    │
│ Stores:                            │
│   • Provider name                  │
│   • All models used                │
│   • All metric values              │
│   • Breakdown dimensions           │
└────────────────────────────────────┘
              ↓
┌──────────── LEADERBOARD ───────────┐
│ Views:                             │
│   • Overall (all benchmarks)       │
│   • Per-benchmark                  │
│   • Per-question-type              │
│   • Provider comparison            │
│   • Model comparison               │
│                                    │
│ Filters:                           │
│   • Benchmark category             │
│   • Provider type                  │
│   • Metric (accuracy/latency/cost) │
└────────────────────────────────────┘
```

### File Structure

```
memorybench/
├── benchmarks/
│   ├── configs/
│   │   ├── locomo.yaml
│   │   ├── longmemeval.yaml
│   │   ├── legal-rag.yaml
│   │   └── financial-rag.yaml
│   └── evaluators/
│       ├── llm-judge.ts
│       ├── exact-match.ts
│       └── semantic-similarity.ts
│
├── core/
│   ├── runner.ts
│   ├── config.ts
│   ├── results.ts
│   └── metrics/
│       ├── interface.ts          # NEW
│       ├── registry.ts           # NEW
│       ├── builtin/              # NEW
│       │   ├── accuracy.ts
│       │   ├── ndcg.ts
│       │   ├── latency.ts
│       │   └── cost.ts
│       └── custom/               # NEW
│           ├── legal-citation.ts
│           └── code-correctness.ts
│
├── providers/
│   ├── adapters/
│   │   ├── aqrag.ts
│   │   ├── mem0.ts
│   │   ├── zep.ts              # To be added
│   │   └── pinecone.ts         # To be added
│   └── configs/
│       ├── aqrag.yaml
│       ├── mem0.yaml
│       └── zep.yaml            # To be added
│
└── leaderboard/
    ├── generate.ts               # NEW
    ├── app.py                    # NEW (HuggingFace Space)
    └── templates/
        └── index.html
```

---

## Summary: Your Questions Answered

### 1. What can we learn from Mem0?
✅ **Multiple metrics** (BLEU, F1, LLM, latency, tokens)
✅ **Modular provider adapters** (we already do this)
✅ **Category-based breakdowns** (we already do this)
✅ **Makefile orchestration** (we already do this with CLI)

**What to add:** BLEU/F1 scores, latency tracking, cost tracking

### 2. How do we orchestrate metrics?
✅ **Metric Registry Pattern** (like MTEB)
- One interface, many implementations
- YAML config selects which metrics
- No switch statements
- Pluggable and extensible

**No need for separate scripts per metric!**

### 3. Do metrics change per benchmark?
✅ **YES, but we standardize the interface**
- Accuracy: exact_match vs llm_judge vs semantic_similarity
- Retrieval: NDCG, MAP, MRR
- Domain: legal_citation, code_correctness
- Performance: latency, cost

**Benchmark config selects implementation**

### 4. Provider vs Model?
✅ **We're benchmarking BOTH, must track BOTH**
- Provider: Retrieval system
- Embedding Model: Search quality
- Answering Model: Generation quality
- Judge Model: Evaluation bias

**CRITICAL:** Track all 3 models in results

### 5. How to standardize?
✅ **Follow MTEB's approach**
- Standardized provider interface ✅ (done)
- Standardized benchmark schema ✅ (done)
- Standardized metric interface ⚠️ (needs work)
- Standardized result format ✅ (done, needs model tracking)
- Standardized reporting ⚠️ (needs multi-metric support)

---

## Next Steps (Implementation Order)

### Phase 1A: Metric System (Week 1)
1. Create metric interface + registry
2. Migrate existing metrics (accuracy, recall, mrr)
3. Add latency tracking
4. Add cost tracking

### Phase 1B: Model Tracking (Week 1)
1. Extend EvalResult to track all models
2. Update runner to capture model info
3. Update ResultsStore schema
4. Add model override CLI options

### Phase 2: New Metrics (Week 2)
1. Add NDCG metric
2. Add BLEU/F1 metrics
3. Add semantic similarity metric
4. Add domain-specific metrics (legal, code)

### Phase 3: Leaderboard (Week 3-4)
1. Multi-metric display
2. Model comparison view
3. Provider comparison view
4. Export functionality

**This gives us the foundation for 10+ benchmarks with flexible metrics.**

---

## Sources

- [Mem0 Evaluation Framework](https://github.com/mem0ai/mem0/tree/main/evaluation)
- [Maintaining MTEB: Towards Long Term Usability and Reproducibility](https://arxiv.org/html/2506.21182v1)
- [MTEB: Massive Text Embedding Benchmark](https://huggingface.co/blog/mteb)
- [MTEB Leaderboard](https://huggingface.co/spaces/mteb/leaderboard)
- [MSC-Bench: Multi-Server Tool Orchestration](https://arxiv.org/abs/2510.19423)
- [Azure AI Foundry Evaluation Tools](https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/new-evaluation-tools-for-multimodal-apps-benchmarking-cicd-integration-and-more/4301972)
