# Engineering Task Breakdown
## Atomic Tasks with Dependencies and Acceptance Criteria

---

## How to Use This Document

Each task follows this format:
```
[PHASE-ID] Task Name
├── Problem: What needs to be solved
├── Files: What to create/modify
├── Steps: Exact implementation steps
├── Acceptance: How to verify it's done
├── Depends: What must be done first
└── Complexity: S/M/L (hours estimate)
```

**Dependency notation:**
- `NONE` = Can start immediately
- `[P1-3]` = Depends on task P1-3 completing first

---

## PHASE 0: Critical Bug Fixes (BLOCKING)

These must be done first - they affect data integrity.

---

### [P0-1] Fix ContextualRetrieval runTag Isolation

**Problem:** `ContextualRetrievalAdapter.searchQuery()` ignores `runTag` parameter, causing data contamination between benchmark runs.

**Files:**
- `providers/adapters/contextual-retrieval.ts`

**Steps:**
1. Read current implementation of `searchQuery()` method
2. Find where `_runTag` is declared (underscore = intentionally unused)
3. Modify `retrieve()` call to pass `runTag` for filtering
4. If underlying `retrieve()` doesn't support runTag:
   - Option A: Add runTag support to retrieve function
   - Option B: Filter results after retrieval by checking metadata

**Code change:**
```typescript
// BEFORE (broken)
async searchQuery(
  query: string,
  _runTag: string,  // IGNORED!
  options?: SearchOptions
): Promise<SearchResult[]> {
  const results = await retrieve(query);  // No runTag
  // ...
}

// AFTER (fixed)
async searchQuery(
  query: string,
  runTag: string,  // NOW USED
  options?: SearchOptions
): Promise<SearchResult[]> {
  const results = await retrieve(query, runTag);  // Pass runTag
  // ...
}
```

**Acceptance:**
- [ ] `runTag` parameter is used in search query
- [ ] Running same query with different runTags returns different results
- [ ] Test: Run benchmark twice with different runTags, verify no cross-contamination

**Depends:** NONE
**Complexity:** S (2-3 hours)

---

### [P0-2] Fix ContextualRetrieval clear() Silent Failure

**Problem:** `clear()` method just logs a warning and doesn't actually clear data.

**Files:**
- `providers/adapters/contextual-retrieval.ts`
- Possibly underlying storage module

**Steps:**
1. Read current `clear()` implementation
2. Identify the underlying storage mechanism (SQLite? Vector DB?)
3. Implement actual deletion by runTag
4. If deletion not possible, throw error instead of silent warning

**Code change:**
```typescript
// BEFORE (silent failure)
async clear(_runTag: string): Promise<void> {
  console.warn(`ContextualRetrieval provider does not support clearing...`);
}

// AFTER (actual implementation or explicit error)
async clear(runTag: string): Promise<void> {
  // Option A: Implement actual clear
  await this.storage.deleteByRunTag(runTag);

  // Option B: If not possible, throw (not silent)
  throw new Error(`ContextualRetrieval does not support clear(). Data for ${runTag} persists.`);
}
```

**Acceptance:**
- [ ] `clear()` either deletes data or throws explicit error
- [ ] No silent failures
- [ ] Test: Add data, call clear, verify data is gone (or error thrown)

**Depends:** NONE
**Complexity:** S (2-3 hours)

---

### [P0-3] Implement LLM Judge (Remove Placeholder)

**Problem:** LLM judge in `runner.ts` returns hardcoded heuristic instead of actual LLM evaluation.

**Files:**
- `core/runner.ts` (lines ~458-469)
- `core/evaluation/llm-judge.ts` (if exists)

**Steps:**
1. Find placeholder code in `runner.ts` evaluate() method
2. Check if `llm-judge.ts` module exists and is complete
3. If module exists: integrate it into runner
4. If module incomplete: implement LLM judge call

**Current placeholder (to replace):**
```typescript
case "llm-judge":
  // Placeholder - will be implemented in evaluation-llm-judge todo
  return {
    answer: "placeholder",
    score: searchResults.length > 0 ? 0.5 : 0,
    correct: searchResults.length > 0
  };
```

**Target implementation:**
```typescript
case "llm-judge":
  const judge = new LLMJudge(benchmarkConfig.evaluation);
  const evaluation = await judge.evaluate({
    question: item.question,
    expected: item.answer,
    actual: generatedAnswer,
    context: searchResults
  });
  return {
    answer: generatedAnswer,
    score: evaluation.score,
    correct: evaluation.score >= threshold
  };
```

**Acceptance:**
- [ ] LLM judge makes actual API call to judge model
- [ ] Score is based on LLM response, not hardcoded
- [ ] Judge model is configurable via benchmark config

**Depends:** NONE
**Complexity:** M (4-6 hours)

---

## PHASE 1: Metric Registry Foundation

Transform hardcoded metrics into extensible registry pattern.

---

### [P1-1] Create Metric Interfaces

**Problem:** Need type definitions before implementing registry.

**Files:**
- CREATE: `core/metrics/types.ts`

**Steps:**
1. Create `core/metrics/` folder
2. Create `types.ts` with interfaces

**Code to write:**
```typescript
// core/metrics/types.ts
import type { EvalResult } from "../config.ts";

export type MetricCategory = "quality" | "retrieval" | "performance" | "cost";

export interface MetricConfig {
  k?: number;           // For @k metrics (recall@5, etc)
  threshold?: number;   // For threshold-based metrics
  [key: string]: unknown;
}

export interface MetricResult {
  name: string;
  value: number;
  category: MetricCategory;
  details?: {
    total?: number;
    correct?: number;
    breakdown?: Record<string, number>;
    stats?: {
      mean?: number;
      p50?: number;
      p95?: number;
      p99?: number;
      min?: number;
      max?: number;
    };
  };
}

export interface MetricCalculator {
  readonly name: string;
  readonly category: MetricCategory;
  readonly description: string;

  calculate(results: EvalResult[], config?: MetricConfig): MetricResult;
}
```

**Acceptance:**
- [ ] File exists at `core/metrics/types.ts`
- [ ] TypeScript compiles without errors
- [ ] Interfaces match existing `MetricResult` shape (backward compat)

**Depends:** NONE
**Complexity:** S (1-2 hours)

---

### [P1-2] Create Metric Registry Class

**Problem:** Need central registry to manage metrics.

**Files:**
- CREATE: `core/metrics/registry.ts`

**Steps:**
1. Create registry class with register/get/calculate methods
2. Add validation for duplicate names
3. Add method to list all registered metrics

**Code to write:**
```typescript
// core/metrics/registry.ts
import type { MetricCalculator, MetricResult, MetricConfig } from "./types.ts";
import type { EvalResult } from "../config.ts";

export class MetricRegistry {
  private metrics = new Map<string, MetricCalculator>();

  register(metric: MetricCalculator): void {
    if (this.metrics.has(metric.name)) {
      throw new Error(`Metric "${metric.name}" already registered`);
    }
    this.metrics.set(metric.name, metric);
  }

  get(name: string): MetricCalculator | undefined {
    return this.metrics.get(name);
  }

  has(name: string): boolean {
    return this.metrics.has(name);
  }

  list(): string[] {
    return Array.from(this.metrics.keys());
  }

  listByCategory(category: string): string[] {
    return Array.from(this.metrics.values())
      .filter(m => m.category === category)
      .map(m => m.name);
  }

  calculate(name: string, results: EvalResult[], config?: MetricConfig): MetricResult {
    const calculator = this.metrics.get(name);
    if (!calculator) {
      throw new Error(`Unknown metric: "${name}". Available: ${this.list().join(", ")}`);
    }
    return calculator.calculate(results, config);
  }

  calculateAll(names: string[], results: EvalResult[]): MetricResult[] {
    return names.map(name => this.calculate(name, results));
  }
}

// Singleton instance
export const metricRegistry = new MetricRegistry();
```

**Acceptance:**
- [ ] Can register metrics
- [ ] Throws on duplicate registration
- [ ] Can calculate single metric
- [ ] Can calculate multiple metrics
- [ ] list() returns all registered names

**Depends:** [P1-1]
**Complexity:** S (2-3 hours)

---

### [P1-3] Wrap Existing Accuracy Metric

**Problem:** Need to convert existing `calculateAccuracy()` to MetricCalculator.

**Files:**
- CREATE: `core/metrics/builtin/accuracy.ts`
- READ: `core/metrics.ts` (for existing logic)

**Steps:**
1. Read existing `calculateAccuracy()` function
2. Create AccuracyMetric class implementing MetricCalculator
3. Preserve exact same calculation logic

**Code to write:**
```typescript
// core/metrics/builtin/accuracy.ts
import type { MetricCalculator, MetricResult, MetricConfig } from "../types.ts";
import type { EvalResult } from "../../config.ts";

export class AccuracyMetric implements MetricCalculator {
  readonly name = "accuracy";
  readonly category = "quality" as const;
  readonly description = "Percentage of correct answers";

  calculate(results: EvalResult[], _config?: MetricConfig): MetricResult {
    if (results.length === 0) {
      return {
        name: this.name,
        value: 0,
        category: this.category,
        details: { total: 0, correct: 0 }
      };
    }

    const correct = results.filter(r => r.correct).length;
    const total = results.length;

    return {
      name: this.name,
      value: correct / total,
      category: this.category,
      details: { total, correct }
    };
  }
}
```

**Acceptance:**
- [ ] AccuracyMetric produces same values as old `calculateAccuracy()`
- [ ] Test: Compare results between old and new on same data

**Depends:** [P1-1], [P1-2]
**Complexity:** S (1-2 hours)

---

### [P1-4] Wrap Existing Retrieval Metrics

**Problem:** Convert recall, precision, MRR metrics to MetricCalculator.

**Files:**
- CREATE: `core/metrics/builtin/retrieval.ts`
- READ: `core/metrics.ts` (for existing logic)

**Steps:**
1. Read existing retrieval functions
2. Create classes for each: RecallAtK, PrecisionAtK, MRR, NDCG

**Code to write:**
```typescript
// core/metrics/builtin/retrieval.ts
import type { MetricCalculator, MetricResult, MetricConfig } from "../types.ts";
import type { EvalResult } from "../../config.ts";

export class RecallAtKMetric implements MetricCalculator {
  readonly name: string;
  readonly category = "retrieval" as const;
  readonly description: string;
  private k: number;

  constructor(k: number = 5) {
    this.k = k;
    this.name = `recall_at_${k}`;
    this.description = `Recall@${k} - fraction of relevant items in top ${k}`;
  }

  calculate(results: EvalResult[], config?: MetricConfig): MetricResult {
    const k = config?.k ?? this.k;

    let totalRecall = 0;
    let validResults = 0;

    for (const result of results) {
      const topK = result.retrievedContext.slice(0, k);
      const expectedLower = result.expected.toLowerCase();

      const found = topK.some(ctx =>
        ctx.content.toLowerCase().includes(expectedLower)
      );

      if (found) totalRecall++;
      validResults++;
    }

    return {
      name: this.name,
      value: validResults > 0 ? totalRecall / validResults : 0,
      category: this.category,
      details: { k, found: totalRecall, total: validResults }
    };
  }
}

export class MRRMetric implements MetricCalculator {
  readonly name = "mrr";
  readonly category = "retrieval" as const;
  readonly description = "Mean Reciprocal Rank";

  calculate(results: EvalResult[], _config?: MetricConfig): MetricResult {
    let totalRR = 0;
    let validResults = 0;

    for (const result of results) {
      const expectedLower = result.expected.toLowerCase();

      for (let i = 0; i < result.retrievedContext.length; i++) {
        if (result.retrievedContext[i].content.toLowerCase().includes(expectedLower)) {
          totalRR += 1 / (i + 1);
          break;
        }
      }
      validResults++;
    }

    return {
      name: this.name,
      value: validResults > 0 ? totalRR / validResults : 0,
      category: this.category,
      details: { total: validResults }
    };
  }
}

// Export factory for common K values
export const recall5 = new RecallAtKMetric(5);
export const recall10 = new RecallAtKMetric(10);
export const mrr = new MRRMetric();
```

**Acceptance:**
- [ ] RecallAtK produces same values as old `calculateRecallAtK()`
- [ ] MRR produces same values as old `calculateMRR()`
- [ ] K is configurable

**Depends:** [P1-1], [P1-2]
**Complexity:** M (3-4 hours)

---

### [P1-5] Create Default Registry with All Built-in Metrics

**Problem:** Need to register all built-in metrics on startup.

**Files:**
- CREATE: `core/metrics/index.ts`
- MODIFY: `core/index.ts` (update exports)

**Steps:**
1. Create index file that registers all built-ins
2. Export registry and types
3. Update core/index.ts to export new module

**Code to write:**
```typescript
// core/metrics/index.ts
export * from "./types.ts";
export { MetricRegistry, metricRegistry } from "./registry.ts";

// Built-in metrics
import { AccuracyMetric } from "./builtin/accuracy.ts";
import { RecallAtKMetric, MRRMetric, recall5, recall10, mrr } from "./builtin/retrieval.ts";

// Register built-ins
import { metricRegistry } from "./registry.ts";

metricRegistry.register(new AccuracyMetric());
metricRegistry.register(recall5);
metricRegistry.register(recall10);
metricRegistry.register(mrr);

// Re-export for convenience
export { AccuracyMetric, RecallAtKMetric, MRRMetric };
```

**Acceptance:**
- [ ] `import { metricRegistry } from "core/metrics"` works
- [ ] `metricRegistry.list()` returns all built-in metric names
- [ ] Old imports from `core/metrics.ts` still work

**Depends:** [P1-3], [P1-4]
**Complexity:** S (1-2 hours)

---

### [P1-6] Add Backward Compatibility Layer

**Problem:** Old code calls `calculateAllMetrics()` directly - must keep working.

**Files:**
- MODIFY: `core/metrics.ts` (legacy file)

**Steps:**
1. Keep old file working
2. Internally delegate to new registry where possible
3. Add deprecation warnings

**Code to modify:**
```typescript
// core/metrics.ts (legacy - keep for backward compat)
import { metricRegistry } from "./metrics/index.ts";

/**
 * @deprecated Use metricRegistry.calculateAll() instead
 */
export function calculateAllMetrics(
  results: EvalResult[],
  metricsToCalculate: string[] = ["accuracy"]
): MetricsReport {
  console.warn("calculateAllMetrics is deprecated. Use metricRegistry.calculateAll()");

  // Delegate to new system where possible
  const newMetrics = metricsToCalculate
    .filter(name => metricRegistry.has(name))
    .map(name => metricRegistry.calculate(name, results));

  // Fall back to old switch for metrics not yet migrated
  // ... keep existing switch logic for unmigrated metrics

  return {
    accuracy: results.filter(r => r.correct).length / results.length,
    metrics: newMetrics,
    byQuestionType: calculateAccuracyByQuestionType(results),
    byCategory: calculateAccuracyByCategory(results)
  };
}
```

**Acceptance:**
- [ ] `calculateAllMetrics()` still works identically
- [ ] Deprecation warning appears in console
- [ ] All existing tests pass

**Depends:** [P1-5]
**Complexity:** M (3-4 hours)

---

## PHASE 2: Performance Tracking

Add latency and cost metrics to evaluation results.

---

### [P2-1] Add Timing Instrumentation to Runner

**Problem:** Need to measure search and answer generation latency.

**Files:**
- MODIFY: `core/runner.ts`

**Steps:**
1. Find search call in runner
2. Wrap with timing
3. Find answer generation call
4. Wrap with timing
5. Store in result metadata

**Code to add:**
```typescript
// In runner.ts evaluation loop

// Time search
const searchStart = performance.now();
const searchResults = await provider.searchQuery(
  item.question,
  runTag,
  { limit: 10 }
);
const searchLatencyMs = performance.now() - searchStart;

// Time answer generation
const answerStart = performance.now();
const { answer, usage } = await this.generateAnswer(item, searchResults);
const answerLatencyMs = performance.now() - answerStart;

// Store in result
const evalResult: EvalResult = {
  // ... existing fields
  metadata: {
    ...item.metadata,
    questionType: item.questionType,
    category: item.category,
    // NEW: Performance data
    searchLatencyMs,
    answerLatencyMs,
    totalLatencyMs: searchLatencyMs + answerLatencyMs,
  }
};
```

**Acceptance:**
- [ ] Every EvalResult has `searchLatencyMs` in metadata
- [ ] Every EvalResult has `answerLatencyMs` in metadata
- [ ] Values are realistic (not 0, not negative)

**Depends:** NONE
**Complexity:** S (2-3 hours)

---

### [P2-2] Create Latency Metric Calculator

**Problem:** Need metric that computes p50/p95/p99 from latency data.

**Files:**
- CREATE: `core/metrics/builtin/performance.ts`

**Steps:**
1. Create LatencyMetric class
2. Compute percentiles from metadata.searchLatencyMs

**Code to write:**
```typescript
// core/metrics/builtin/performance.ts
import type { MetricCalculator, MetricResult, MetricConfig } from "../types.ts";
import type { EvalResult } from "../../config.ts";

export class LatencyMetric implements MetricCalculator {
  readonly name: string;
  readonly category = "performance" as const;
  readonly description: string;
  private field: "searchLatencyMs" | "answerLatencyMs" | "totalLatencyMs";

  constructor(field: "searchLatencyMs" | "answerLatencyMs" | "totalLatencyMs" = "searchLatencyMs") {
    this.field = field;
    this.name = `latency_${field.replace("Ms", "").replace("Latency", "")}`;
    this.description = `Latency statistics for ${field}`;
  }

  calculate(results: EvalResult[], _config?: MetricConfig): MetricResult {
    const latencies = results
      .map(r => r.metadata[this.field] as number)
      .filter(v => typeof v === "number" && !isNaN(v))
      .sort((a, b) => a - b);

    if (latencies.length === 0) {
      return {
        name: this.name,
        value: 0,
        category: this.category,
        details: { stats: {} }
      };
    }

    const sum = latencies.reduce((a, b) => a + b, 0);
    const mean = sum / latencies.length;
    const p50 = this.percentile(latencies, 50);
    const p95 = this.percentile(latencies, 95);
    const p99 = this.percentile(latencies, 99);

    return {
      name: this.name,
      value: mean,  // Primary value is mean
      category: this.category,
      details: {
        total: latencies.length,
        stats: {
          mean,
          p50,
          p95,
          p99,
          min: latencies[0],
          max: latencies[latencies.length - 1]
        }
      }
    };
  }

  private percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }
}

export const searchLatency = new LatencyMetric("searchLatencyMs");
export const answerLatency = new LatencyMetric("answerLatencyMs");
export const totalLatency = new LatencyMetric("totalLatencyMs");
```

**Acceptance:**
- [ ] Computes correct p50/p95/p99
- [ ] Handles empty results gracefully
- [ ] Handles missing metadata gracefully

**Depends:** [P1-1], [P2-1]
**Complexity:** S (2-3 hours)

---

### [P2-3] Add Token/Cost Tracking

**Problem:** Need to track token usage for cost estimation.

**Files:**
- MODIFY: `core/runner.ts`
- CREATE: `core/utils/cost.ts`

**Steps:**
1. Capture token usage from LLM responses
2. Create cost estimation utility
3. Store in metadata

**Code to write:**
```typescript
// core/utils/cost.ts
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Cost per 1M tokens (approximate, update as needed)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.50, output: 10.00 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-3.5-turbo": { input: 0.50, output: 1.50 },
  "claude-3-sonnet": { input: 3.00, output: 15.00 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
};

export function estimateCost(usage: TokenUsage, model: string): number {
  const costs = MODEL_COSTS[model] || { input: 1.0, output: 3.0 }; // default
  const inputCost = (usage.promptTokens / 1_000_000) * costs.input;
  const outputCost = (usage.completionTokens / 1_000_000) * costs.output;
  return inputCost + outputCost;
}
```

**Acceptance:**
- [ ] Token counts captured from LLM calls
- [ ] Cost estimation works for known models
- [ ] Falls back gracefully for unknown models

**Depends:** [P2-1]
**Complexity:** M (3-4 hours)

---

### [P2-4] Update Results Display for Performance Data

**Problem:** CLI results command doesn't show latency/cost.

**Files:**
- MODIFY: `cli/index.ts` (results command)

**Steps:**
1. Find results display code
2. Add latency statistics section
3. Add cost summary if available

**Code to add:**
```typescript
// In results display
console.log("\n--- Performance Metrics ---");
console.log(`Search Latency (p50): ${latencyP50}ms`);
console.log(`Search Latency (p95): ${latencyP95}ms`);
console.log(`Answer Latency (mean): ${answerMean}ms`);
if (totalCost > 0) {
  console.log(`Estimated Cost: $${totalCost.toFixed(4)}`);
}
```

**Acceptance:**
- [ ] `memorybench results <runId>` shows latency stats
- [ ] Shows cost if data available
- [ ] Graceful handling when data missing

**Depends:** [P2-1], [P2-2], [P2-3]
**Complexity:** S (2-3 hours)

---

## PHASE 3: Provider Flexibility

Add prepareData hook for provider customization.

---

### [P3-1] Define prepareData Interface

**Problem:** Need type definitions for data preparation hook.

**Files:**
- MODIFY: `providers/base/types.ts`

**Steps:**
1. Add new interfaces for data preparation
2. Extend Provider interface with optional hook

**Code to add:**
```typescript
// In providers/base/types.ts

export interface DataPreparationContext {
  benchmarkConfig: BenchmarkConfig;
  runTag: string;
  itemId: string;
  itemIndex: number;
  totalItems: number;
}

export interface PreprocessingLog {
  step: string;
  input: string;
  output: string;
  durationMs: number;
}

export interface PreparedDataResult {
  data: PreparedData;
  logs?: PreprocessingLog[];
}

export interface Provider {
  // ... existing methods ...

  /**
   * Optional hook to transform data before addContext.
   * Use for chunking, enrichment, or provider-specific formatting.
   */
  prepareData?(
    data: PreparedData,
    context: DataPreparationContext
  ): Promise<PreparedDataResult>;
}
```

**Acceptance:**
- [ ] TypeScript compiles
- [ ] Existing providers still work (hook is optional)

**Depends:** NONE
**Complexity:** S (1-2 hours)

---

### [P3-2] Integrate prepareData into Runner

**Problem:** Runner needs to call prepareData before addContext.

**Files:**
- MODIFY: `core/runner.ts`

**Steps:**
1. Find where `addContext` is called
2. Add prepareData call before it
3. Pass context information
4. Log preprocessing steps

**Code to add:**
```typescript
// In runner.ts, before addContext loop

for (let i = 0; i < contexts.length; i++) {
  let preparedData = contexts[i];
  let prepLogs: PreprocessingLog[] = [];

  // Call prepareData if provider implements it
  if (provider.prepareData) {
    const result = await provider.prepareData(preparedData, {
      benchmarkConfig,
      runTag,
      itemId: preparedData.id,
      itemIndex: i,
      totalItems: contexts.length
    });
    preparedData = result.data;
    prepLogs = result.logs || [];

    // Log if verbose
    if (verbose && prepLogs.length > 0) {
      console.log(`  Preprocessing: ${prepLogs.length} steps`);
    }
  }

  await provider.addContext(preparedData, runTag);
}
```

**Acceptance:**
- [ ] Providers without prepareData still work
- [ ] Providers with prepareData get it called
- [ ] Context object contains all required fields

**Depends:** [P3-1]
**Complexity:** S (2-3 hours)

---

### [P3-3] Create Example prepareData Implementation

**Problem:** Need reference implementation for providers to follow.

**Files:**
- CREATE: `providers/examples/chunking-provider.ts`

**Steps:**
1. Create example provider that chunks long content
2. Document the pattern

**Code to write:**
```typescript
// providers/examples/chunking-provider.ts
import { LocalProvider } from "../base/local-provider.ts";
import type {
  PreparedData,
  DataPreparationContext,
  PreparedDataResult
} from "../base/types.ts";

/**
 * Example provider that chunks content before storage.
 * Use as reference for implementing prepareData hook.
 */
export class ChunkingProvider extends LocalProvider {
  private chunkSize = 500;
  private chunkOverlap = 50;

  async prepareData(
    data: PreparedData,
    context: DataPreparationContext
  ): Promise<PreparedDataResult> {
    const startTime = performance.now();

    // Skip if content is small enough
    if (data.content.length <= this.chunkSize) {
      return { data, logs: [] };
    }

    // Chunk the content
    const chunks = this.chunkContent(data.content);

    return {
      data: {
        ...data,
        content: chunks[0], // Primary chunk
        metadata: {
          ...data.metadata,
          totalChunks: chunks.length,
          chunkIndex: 0,
          originalLength: data.content.length
        }
      },
      logs: [{
        step: "chunking",
        input: `${data.content.length} chars`,
        output: `${chunks.length} chunks of ~${this.chunkSize} chars`,
        durationMs: performance.now() - startTime
      }]
    };
  }

  private chunkContent(content: string): string[] {
    const chunks: string[] = [];
    let start = 0;

    while (start < content.length) {
      const end = Math.min(start + this.chunkSize, content.length);
      chunks.push(content.slice(start, end));
      start = end - this.chunkOverlap;
    }

    return chunks;
  }
}
```

**Acceptance:**
- [ ] Example compiles and runs
- [ ] Demonstrates chunking pattern
- [ ] Logs show preprocessing steps

**Depends:** [P3-1], [P3-2]
**Complexity:** S (2-3 hours)

---

## PHASE 4: Zep Provider

Implement Zep as new provider.

---

### [P4-1] Create Zep YAML Config

**Problem:** Need YAML configuration for Zep provider.

**Files:**
- CREATE: `providers/configs/zep.yaml`

**Code to write:**
```yaml
# providers/configs/zep.yaml
name: zep
displayName: Zep Memory
description: Long-term memory service with temporal knowledge graphs
version: "1.0.0"
type: local

adapter: "./adapters/zep.ts"

capabilities:
  supportsChunks: true
  supportsBatch: true
  supportsMetadata: true
  supportsRerank: false
  maxContextLength: 100000

requiredEnv:
  - ZEP_API_KEY

documentation: https://docs.getzep.com
```

**Acceptance:**
- [ ] YAML is valid
- [ ] `memorybench list --providers` shows zep
- [ ] `memorybench describe zep` works

**Depends:** NONE
**Complexity:** S (1 hour)

---

### [P4-2] Install Zep SDK

**Problem:** Need @getzep/zep-js package.

**Steps:**
```bash
bun add @getzep/zep-js
```

**Acceptance:**
- [ ] Package in package.json
- [ ] Import works: `import { ZepClient } from "@getzep/zep-js"`

**Depends:** NONE
**Complexity:** S (30 min)

---

### [P4-3] Implement Zep Adapter

**Problem:** Need TypeScript adapter for Zep.

**Files:**
- CREATE: `providers/adapters/zep.ts`

**Code to write:**
```typescript
// providers/adapters/zep.ts
import { ZepClient } from "@getzep/zep-js";
import { LocalProvider } from "../base/local-provider.ts";
import type {
  PreparedData,
  SearchResult,
  SearchOptions
} from "../base/types.ts";

export class ZepAdapter extends LocalProvider {
  private client!: ZepClient;
  private sessionCache = new Set<string>();

  protected async doInitialize(): Promise<void> {
    const apiKey = process.env.ZEP_API_KEY;
    if (!apiKey) {
      throw new Error("ZEP_API_KEY environment variable required");
    }

    this.client = new ZepClient({ apiKey });
  }

  async addContext(data: PreparedData, runTag: string): Promise<void> {
    // Create session if not exists
    if (!this.sessionCache.has(runTag)) {
      try {
        await this.client.memory.addSession({
          sessionId: runTag,
          userId: `memorybench-${runTag}`
        });
        this.sessionCache.add(runTag);
      } catch (e: any) {
        // Session may already exist
        if (!e.message?.includes("already exists")) {
          throw e;
        }
        this.sessionCache.add(runTag);
      }
    }

    // Add memory
    await this.client.memory.add(runTag, {
      messages: [{
        role: "user",
        content: data.content,
        metadata: data.metadata
      }]
    });
  }

  async searchQuery(
    query: string,
    runTag: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const limit = options?.limit ?? 10;

    const results = await this.client.memory.searchMemory(
      runTag,
      { text: query },
      limit
    );

    return results.map((r: any) => ({
      id: r.uuid || r.id || "",
      content: r.message?.content || r.content || "",
      score: r.score ?? r.dist ?? 0,
      metadata: r.metadata || {}
    }));
  }

  async clear(runTag: string): Promise<void> {
    // Zep JS SDK may not have direct session delete
    // Try API call or log warning
    try {
      // If deleteSession exists
      // await this.client.memory.deleteSession(runTag);
      this.sessionCache.delete(runTag);
    } catch (e) {
      console.warn(`Zep clear for ${runTag}: Session deletion not fully supported in SDK`);
    }
  }

  protected async doCleanup(): Promise<void> {
    this.sessionCache.clear();
  }
}

export default ZepAdapter;
```

**Acceptance:**
- [ ] Adapter compiles without errors
- [ ] Can initialize with valid API key
- [ ] addContext creates session and adds memory
- [ ] searchQuery returns results
- [ ] clear handles gracefully

**Depends:** [P4-1], [P4-2]
**Complexity:** M (4-6 hours)

---

### [P4-4] Test Zep with All Benchmarks

**Problem:** Must verify Zep works with existing benchmarks.

**Steps:**
1. Run with rag-template
2. Run with longmemeval
3. Run with locomo
4. Check results for correctness

**Commands:**
```bash
# Set API key
export ZEP_API_KEY=your_key

# Test each benchmark
memorybench eval --benchmarks rag-template --providers zep --limit 5
memorybench eval --benchmarks longmemeval --providers zep --limit 5
memorybench eval --benchmarks locomo --providers zep --limit 5

# Check results
memorybench results <runId> --breakdown
```

**Acceptance:**
- [ ] All 3 benchmarks complete without error
- [ ] Results show reasonable accuracy
- [ ] No data contamination between runs

**Depends:** [P4-3]
**Complexity:** M (3-4 hours)

---

## PHASE 5: CLI Enhancements

Add --metrics flag and improve UX.

---

### [P5-1] Add --metrics Flag to CLI

**Problem:** Users can't select which metrics to calculate.

**Files:**
- MODIFY: `cli/index.ts`

**Steps:**
1. Add --metrics to argument parser
2. Pass to RunOptions
3. Use in calculateAllMetrics call

**Code to modify:**
```typescript
// In cli/index.ts, eval command section

// Parse --metrics flag
const metricsArg = options.metrics;
const metrics = Array.isArray(metricsArg)
  ? metricsArg
  : metricsArg
    ? [metricsArg]
    : ["accuracy"]; // default

// Add to runner options
const result = await runner.run({
  benchmarks,
  providers,
  metrics,  // NEW
  // ... other options
});
```

**Acceptance:**
- [ ] `--metrics accuracy` works
- [ ] `--metrics accuracy --metrics mrr` works
- [ ] Default is accuracy if not specified
- [ ] Unknown metric shows helpful error

**Depends:** [P1-5]
**Complexity:** S (2-3 hours)

---

### [P5-2] Add metrics List Command

**Problem:** Users don't know what metrics are available.

**Files:**
- MODIFY: `cli/index.ts`

**Steps:**
1. Add `list --metrics` option
2. Show available metrics with descriptions

**Code to add:**
```typescript
// In list command
if (options.metrics) {
  console.log("\n📊 Available Metrics:\n");

  for (const name of metricRegistry.list()) {
    const metric = metricRegistry.get(name)!;
    console.log(`  ${name.padEnd(20)} [${metric.category}] ${metric.description}`);
  }
}
```

**Acceptance:**
- [ ] `memorybench list --metrics` shows all available metrics
- [ ] Each metric shows category and description

**Depends:** [P1-5], [P5-1]
**Complexity:** S (1-2 hours)

---

## PHASE 6: Benchmark Expansion

Add new benchmarks using correct YAML schema.

---

### [P6-1] Create Multi-Document RAG Benchmark

**Files:**
- CREATE: `benchmarks/configs/multi-doc-rag.yaml`
- CREATE: `benchmarks/multi-doc-rag/data.json`

**YAML template:**
```yaml
name: multi-doc-rag
displayName: Multi-Document RAG
description: Questions requiring synthesis across multiple documents
tags:
  - rag
  - multi-hop

data:
  type: local
  path: "./benchmarks/multi-doc-rag/data.json"
  format: json

schema:
  itemId: "id"
  question: "question"
  answer: "answer"
  context:
    field: "documents"
    type: array
    itemSchema:
      content: "$.content"
      title: "$.title"
  metadata:
    difficulty: "metadata.difficulty"
    hopCount: "metadata.hop_count"

evaluation:
  method: llm-judge
```

**Acceptance:**
- [ ] YAML validates
- [ ] `memorybench describe multi-doc-rag` works
- [ ] Can run evaluation with at least 1 provider

**Depends:** NONE
**Complexity:** M (4-6 hours per benchmark)

---

### [P6-2] Create Temporal Reasoning Benchmark

Similar structure to P6-1, for time-based memory queries.

---

### [P6-3] Create Knowledge Update Benchmark

Similar structure, for testing how providers handle contradictory/updated information.

---

## Summary: Task Dependency Graph

```
PHASE 0 (Blockers) - Can start immediately
├── P0-1: Fix runTag isolation
├── P0-2: Fix clear() silent failure
└── P0-3: Implement LLM Judge

PHASE 1 (Metrics) - Sequential
├── P1-1: Create interfaces
├── P1-2: Create registry (needs P1-1)
├── P1-3: Wrap accuracy (needs P1-2)
├── P1-4: Wrap retrieval (needs P1-2)
├── P1-5: Create index (needs P1-3, P1-4)
└── P1-6: Backward compat (needs P1-5)

PHASE 2 (Performance) - Can run parallel with P1
├── P2-1: Add timing (independent)
├── P2-2: Latency metric (needs P1-1, P2-1)
├── P2-3: Cost tracking (needs P2-1)
└── P2-4: Results display (needs P2-1, P2-2, P2-3)

PHASE 3 (Provider Flex) - After P0
├── P3-1: Define interface (independent)
├── P3-2: Integrate runner (needs P3-1)
└── P3-3: Example provider (needs P3-2)

PHASE 4 (Zep) - After P3
├── P4-1: YAML config (independent)
├── P4-2: Install SDK (independent)
├── P4-3: Implement adapter (needs P4-1, P4-2)
└── P4-4: Test all benchmarks (needs P4-3)

PHASE 5 (CLI) - After P1
├── P5-1: Add --metrics flag (needs P1-5)
└── P5-2: List metrics command (needs P5-1)

PHASE 6 (Benchmarks) - Independent
├── P6-1: Multi-doc RAG
├── P6-2: Temporal
└── P6-3: Knowledge update
```

---

## Recommended Execution Order

**Week 1:**
- Day 1: P0-1, P0-2, P1-1
- Day 2: P0-3, P1-2, P1-3
- Day 3: P1-4, P1-5
- Day 4: P1-6, P2-1
- Day 5: P2-2, P2-3

**Week 2:**
- Day 1: P2-4, P3-1
- Day 2: P3-2, P3-3
- Day 3: P4-1, P4-2, P4-3
- Day 4: P4-4, P5-1
- Day 5: P5-2, Buffer

**Week 3-4:**
- P6-x benchmarks (parallel work)
- Testing and refinement
