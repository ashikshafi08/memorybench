# Context Bench Leaderboard: Data Model & Storage Architecture Design

**Date:** 2025-12-18
**Status:** Design Proposal
**Version:** 1.0

---

## Executive Summary

This document proposes a comprehensive data model and storage architecture for the Context Bench leaderboard, designed to support:

1. Overall rankings across all benchmarks
2. Per-benchmark breakdowns with category drill-downs
3. Multiple metric views (accuracy, latency, cost, combined scores)
4. Historical tracking of provider improvements
5. Individual trace drill-downs for debugging

The design maintains **backward compatibility** with the current schema while adding new tables for provider metadata, historical tracking, and leaderboard-optimized aggregations.

---

## Current State Analysis

### Current Database Schema

The existing `results.db` uses SQLite with the following structure:

#### Table: `runs`
```sql
CREATE TABLE runs (
    id TEXT PRIMARY KEY,                -- e.g., "run-20251218-121722-qrgu"
    started_at TEXT NOT NULL,
    completed_at TEXT,
    benchmarks TEXT NOT NULL,           -- JSON array: ["locomo"]
    providers TEXT NOT NULL,            -- JSON array: ["supermemory"]
    config TEXT                         -- JSON: RunSummary object
);
```

#### Table: `results`
```sql
CREATE TABLE results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    benchmark TEXT NOT NULL,
    provider TEXT NOT NULL,
    item_id TEXT NOT NULL,
    question TEXT NOT NULL,
    expected TEXT NOT NULL,
    actual TEXT NOT NULL,
    score REAL NOT NULL,                -- 0.0 to 1.0
    correct INTEGER NOT NULL,           -- 0 or 1
    retrieved_context TEXT,             -- JSON array of SearchResult
    metadata TEXT,                      -- JSON with telemetry and categories
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE INDEX idx_results_run ON results(run_id);
CREATE INDEX idx_results_benchmark ON results(benchmark);
CREATE INDEX idx_results_provider ON results(provider);
CREATE UNIQUE INDEX idx_results_unique ON results(run_id, benchmark, provider, item_id);
```

### Current Metadata Structure

The `metadata` JSON field in results contains:

```json
{
  "difficulty": "easy",
  "questionType": "multi-hop",        // Optional
  "category": "2",                    // Optional (benchmark-specific)
  "telemetry": {
    "searchLatencyMs": 187.29,
    "totalLatencyMs": 2617.30,
    "answerLatencyMs": 2429.91,
    "judgeLatencyMs": 150.23,         // When using llm-judge
    "answerInputTokens": 1234,        // Optional
    "answerOutputTokens": 56,         // Optional
    "judgeInputTokens": 890,          // Optional
    "judgeOutputTokens": 12,          // Optional
    "estimatedCostUsd": 0.0012        // Optional
  }
}
```

### Current Limitations

1. **No Provider Registry**: Provider metadata (type, version, configuration) is not stored
2. **No Historical Tracking**: No schema for tracking provider improvements over time
3. **Expensive Aggregations**: Leaderboard views require complex N+1 queries
4. **No Pre-computed Scores**: Combined scores must be calculated on-the-fly
5. **Limited Indexing**: Missing indexes for category/type breakdowns
6. **No Cost Tracking**: Cost data captured but not aggregated
7. **No Provider Versioning**: Can't track which version of a provider was tested

---

## Available Metrics

The system supports the following built-in metrics (via MetricCalculator pattern):

### Memory Metrics (Core)
- `accuracy` - Overall correctness rate
- `accuracy_by_question_type` - Breakdown by question type
- `accuracy_by_category` - Breakdown by benchmark category
- `f1` - F1 score for answer quality
- `bleu_1` - BLEU-1 score for answer similarity
- `rouge_l` - ROUGE-L score for answer similarity
- `success_at_5` - Success rate with top 5 retrieved contexts
- `success_at_10` - Success rate with top 10 retrieved contexts
- `recall_at_5` - Recall at 5 retrieved contexts
- `recall_at_10` - Recall at 10 retrieved contexts

### Retrieval Metrics
- `mrr` - Mean Reciprocal Rank
- `precision_at_5` - Precision at 5
- `precision_at_10` - Precision at 10
- `avg_retrieval_score` - Average retrieval confidence score

### Performance Metrics
- `avg_search_latency_ms` - Average search time
- `avg_total_latency_ms` - Average end-to-end time
- `p95_latency_ms` - 95th percentile latency

### Future Metrics (Proposed)
- `avg_cost_usd` - Average cost per query
- `total_cost_usd` - Total run cost
- `cost_per_correct_answer` - Cost efficiency metric

---

## Proposed Schema Design

### Design Principles

1. **Backward Compatibility**: Existing `runs` and `results` tables remain unchanged
2. **Normalization**: Provider metadata normalized into dedicated tables
3. **Performance**: Pre-computed aggregations for fast leaderboard queries
4. **Flexibility**: Support for custom metrics and provider versioning
5. **Auditability**: Full trace from leaderboard → run → individual results

### New Tables

#### 1. Provider Registry Table

```sql
CREATE TABLE providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,              -- e.g., "supermemory"
    display_name TEXT NOT NULL,             -- e.g., "SuperMemory"
    type TEXT NOT NULL,                     -- "hosted", "local", "docker"
    category TEXT,                          -- "commercial", "open-source", "research"
    version TEXT,                           -- "1.2.3" or "latest"
    config_hash TEXT,                       -- SHA256 of provider config
    description TEXT,
    tags TEXT,                              -- JSON array: ["vector-db", "postgres"]
    capabilities TEXT,                      -- JSON: {"supportsChunks": true, ...}
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_providers_name ON providers(name);
CREATE INDEX idx_providers_type ON providers(type);
CREATE INDEX idx_providers_category ON providers(category);
```

**Notes:**
- `config_hash`: Enables tracking configuration changes over time
- `category`: For grouping in leaderboard (commercial vs open-source)
- `capabilities`: Stored as JSON for flexibility

#### 2. Benchmark Registry Table

```sql
CREATE TABLE benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,              -- e.g., "locomo"
    display_name TEXT NOT NULL,             -- e.g., "LoCoMo"
    version TEXT NOT NULL,                  -- "1.0"
    description TEXT,
    paper_url TEXT,
    source_url TEXT,
    tags TEXT,                              -- JSON array
    categories TEXT,                        -- JSON: {"1": "Multi-hop", "2": "Temporal", ...}
    default_metrics TEXT,                   -- JSON array: ["accuracy", "f1", "recall_at_5"]
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_benchmarks_name ON benchmarks(name);
```

**Notes:**
- `categories`: Benchmark-specific category mappings
- `default_metrics`: Which metrics to display for this benchmark

#### 3. Run Metadata Table (Extension)

```sql
CREATE TABLE run_metadata (
    run_id TEXT PRIMARY KEY,
    environment TEXT,                       -- JSON: {"node": "20.x", "bun": "1.x", ...}
    config_snapshot TEXT,                   -- Full run configuration
    notes TEXT,                             -- Optional user notes
    tags TEXT,                              -- JSON array for filtering
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES runs(id)
);
```

#### 4. Aggregated Metrics Table (Leaderboard-Ready)

This table pre-computes all metrics for fast leaderboard queries:

```sql
CREATE TABLE aggregated_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    benchmark TEXT NOT NULL,
    provider TEXT NOT NULL,

    -- Core metrics
    total_items INTEGER NOT NULL,
    completed_items INTEGER NOT NULL,
    failed_items INTEGER NOT NULL,

    -- Accuracy metrics (pre-computed)
    accuracy REAL,
    f1_score REAL,
    bleu_1 REAL,
    rouge_l REAL,

    -- Retrieval metrics
    recall_at_5 REAL,
    recall_at_10 REAL,
    success_at_5 REAL,
    success_at_10 REAL,
    mrr REAL,
    avg_retrieval_score REAL,

    -- Performance metrics
    avg_search_latency_ms REAL,
    avg_total_latency_ms REAL,
    p95_latency_ms REAL,

    -- Cost metrics
    avg_cost_usd REAL,
    total_cost_usd REAL,

    -- Combined score (weighted formula)
    combined_score REAL,

    -- Breakdown data (stored as JSON)
    metrics_by_category TEXT,              -- JSON: {"1": {...}, "2": {...}}
    metrics_by_question_type TEXT,         -- JSON: {"single-hop": {...}, ...}

    -- Metadata
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (run_id) REFERENCES runs(id),

    -- Ensure one aggregation per run/benchmark/provider
    UNIQUE(run_id, benchmark, provider)
);

CREATE INDEX idx_agg_metrics_run ON aggregated_metrics(run_id);
CREATE INDEX idx_agg_metrics_benchmark ON aggregated_metrics(benchmark);
CREATE INDEX idx_agg_metrics_provider ON aggregated_metrics(provider);
CREATE INDEX idx_agg_metrics_combined_score ON aggregated_metrics(combined_score DESC);
CREATE INDEX idx_agg_metrics_benchmark_combined ON aggregated_metrics(benchmark, combined_score DESC);
```

**Notes:**
- Pre-computes all common metrics to avoid expensive runtime calculations
- `combined_score`: See scoring formula below
- Breakdown data stored as JSON for flexibility

#### 5. Leaderboard Snapshots Table

For historical tracking:

```sql
CREATE TABLE leaderboard_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,            -- e.g., "2025-12-18"
    benchmark TEXT,                         -- NULL for overall leaderboard
    provider TEXT NOT NULL,

    -- Rankings
    rank INTEGER NOT NULL,
    combined_score REAL NOT NULL,
    accuracy REAL,
    avg_latency_ms REAL,
    avg_cost_usd REAL,

    -- Reference to source run
    source_run_id TEXT NOT NULL,
    source_agg_id INTEGER,

    -- Metadata
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (source_run_id) REFERENCES runs(id),
    FOREIGN KEY (source_agg_id) REFERENCES aggregated_metrics(id)
);

CREATE INDEX idx_snapshots_date ON leaderboard_snapshots(snapshot_date);
CREATE INDEX idx_snapshots_benchmark ON leaderboard_snapshots(benchmark);
CREATE INDEX idx_snapshots_provider ON leaderboard_snapshots(provider);
CREATE INDEX idx_snapshots_date_benchmark ON leaderboard_snapshots(snapshot_date, benchmark);
```

**Notes:**
- Enables time-series tracking of provider performance
- Snapshots can be taken weekly/monthly
- NULL `benchmark` = overall leaderboard snapshot

---

## Combined Score Formula

The leaderboard uses a **weighted combined score** that balances accuracy, performance, and cost:

### Formula v1.0 (Baseline)

```
combined_score = (
    w_accuracy * accuracy +
    w_latency * latency_score +
    w_cost * cost_score
) * 100

where:
    w_accuracy = 0.60  (60% weight on correctness)
    w_latency  = 0.25  (25% weight on speed)
    w_cost     = 0.15  (15% weight on cost-effectiveness)

    latency_score = 1 - min(avg_total_latency_ms / 10000, 1.0)
                    (normalized: 0ms = 1.0, 10s+ = 0.0)

    cost_score = 1 - min(avg_cost_usd / 0.10, 1.0)
                 (normalized: $0 = 1.0, $0.10+ = 0.0)
```

### Alternative Formulas (Configurable)

The system should support multiple scoring schemes:

#### Accuracy-Only Mode
```
combined_score = accuracy * 100
```

#### Cost-Optimized Mode
```
combined_score = (
    w_accuracy * accuracy +
    w_cost * (1 / (1 + avg_cost_usd * 100))
) * 100

where:
    w_accuracy = 0.70
    w_cost = 0.30
```

#### Performance-Optimized Mode
```
combined_score = (
    w_accuracy * accuracy +
    w_latency * (1 / (1 + avg_total_latency_ms / 1000))
) * 100

where:
    w_accuracy = 0.70
    w_latency = 0.30
```

### Configuration

Store scoring formula in `run_metadata`:

```json
{
  "scoring_formula": {
    "version": "v1.0",
    "weights": {
      "accuracy": 0.60,
      "latency": 0.25,
      "cost": 0.15
    },
    "normalization": {
      "max_latency_ms": 10000,
      "max_cost_usd": 0.10
    }
  }
}
```

---

## Query Patterns

### 1. Overall Leaderboard

```sql
-- Get overall leaderboard (latest run per provider)
WITH latest_runs AS (
    SELECT
        provider,
        MAX(created_at) as latest_run_time
    FROM aggregated_metrics
    GROUP BY provider
)
SELECT
    am.provider,
    p.display_name,
    p.type,
    p.category,
    am.combined_score,
    am.accuracy,
    am.avg_total_latency_ms,
    am.avg_cost_usd,
    am.run_id,
    r.started_at
FROM aggregated_metrics am
INNER JOIN latest_runs lr
    ON am.provider = lr.provider
    AND am.created_at = lr.latest_run_time
INNER JOIN providers p ON am.provider = p.name
INNER JOIN runs r ON am.run_id = r.id
ORDER BY am.combined_score DESC;
```

### 2. Per-Benchmark Leaderboard

```sql
-- Get leaderboard for specific benchmark
SELECT
    am.provider,
    p.display_name,
    am.combined_score,
    am.accuracy,
    am.recall_at_5,
    am.avg_total_latency_ms,
    am.avg_cost_usd,
    am.metrics_by_category,  -- For drill-down
    am.run_id
FROM aggregated_metrics am
INNER JOIN providers p ON am.provider = p.name
WHERE am.benchmark = ?
  AND am.run_id IN (
      -- Get latest run per provider for this benchmark
      SELECT run_id
      FROM aggregated_metrics
      WHERE benchmark = ?
      GROUP BY provider
      HAVING MAX(created_at)
  )
ORDER BY am.combined_score DESC;
```

### 3. Category Breakdown Drill-Down

```sql
-- Get per-category metrics for a specific run/benchmark/provider
SELECT
    am.provider,
    am.metrics_by_category
FROM aggregated_metrics am
WHERE am.run_id = ?
  AND am.benchmark = ?
  AND am.provider = ?;

-- Client-side: Parse JSON to display category breakdown
-- Example metrics_by_category:
{
  "1": {  // Multi-hop
    "total": 50,
    "correct": 38,
    "accuracy": 0.76,
    "avg_latency_ms": 2100.5
  },
  "2": {  // Temporal Reasoning
    "total": 30,
    "correct": 22,
    "accuracy": 0.73,
    "avg_latency_ms": 2300.1
  }
}
```

### 4. Individual Result Drill-Down

```sql
-- Get all individual results for a specific run/benchmark/provider
SELECT
    r.item_id,
    r.question,
    r.expected,
    r.actual,
    r.score,
    r.correct,
    r.retrieved_context,
    r.metadata,
    r.created_at
FROM results r
WHERE r.run_id = ?
  AND r.benchmark = ?
  AND r.provider = ?
ORDER BY r.item_id;
```

### 5. Historical Tracking

```sql
-- Track provider improvement over time
SELECT
    ls.snapshot_date,
    ls.benchmark,
    ls.rank,
    ls.combined_score,
    ls.accuracy,
    ls.avg_latency_ms
FROM leaderboard_snapshots ls
WHERE ls.provider = ?
  AND ls.benchmark = ?  -- or NULL for overall
ORDER BY ls.snapshot_date ASC;
```

### 6. Provider Comparison

```sql
-- Compare multiple providers side-by-side
SELECT
    am.provider,
    am.benchmark,
    am.accuracy,
    am.recall_at_5,
    am.avg_total_latency_ms,
    am.avg_cost_usd,
    am.combined_score
FROM aggregated_metrics am
WHERE am.benchmark = ?
  AND am.provider IN (?, ?, ?)
  AND am.run_id IN (
      SELECT MAX(run_id)
      FROM aggregated_metrics
      WHERE benchmark = ?
      GROUP BY provider
  )
ORDER BY am.combined_score DESC;
```

---

## Migration Strategy

### Phase 1: Add New Tables (Non-Breaking)

1. Create new tables (`providers`, `benchmarks`, `run_metadata`, `aggregated_metrics`, `leaderboard_snapshots`)
2. Add additional indexes to `results` table for better category/type queries:

```sql
CREATE INDEX idx_results_metadata_category
ON results(json_extract(metadata, '$.category'));

CREATE INDEX idx_results_metadata_question_type
ON results(json_extract(metadata, '$.questionType'));

CREATE INDEX idx_results_benchmark_provider
ON results(benchmark, provider);
```

### Phase 2: Backfill Existing Data

```typescript
// Pseudo-code for backfill script
async function backfillAggregatedMetrics(db: Database) {
  // Get all runs
  const runs = db.query("SELECT DISTINCT run_id FROM results").all();

  for (const { run_id } of runs) {
    const combinations = db.query(`
      SELECT DISTINCT benchmark, provider
      FROM results
      WHERE run_id = ?
    `).all(run_id);

    for (const { benchmark, provider } of combinations) {
      // Get all results for this combination
      const results = getRunResults(run_id, benchmark, provider);

      // Compute metrics using MetricRegistry
      const registry = getDefaultRegistry();
      const metrics = registry.computeAll([
        'accuracy', 'f1', 'recall_at_5', 'recall_at_10',
        'avg_search_latency_ms', 'avg_total_latency_ms'
      ], results);

      // Compute combined score
      const combinedScore = computeCombinedScore(metrics, results);

      // Compute category/type breakdowns
      const metricsByCategory = computeMetricsByCategory(results);
      const metricsByQuestionType = computeMetricsByQuestionType(results);

      // Insert into aggregated_metrics
      db.run(`
        INSERT INTO aggregated_metrics (
          run_id, benchmark, provider,
          total_items, completed_items, failed_items,
          accuracy, f1_score, recall_at_5, recall_at_10,
          avg_search_latency_ms, avg_total_latency_ms,
          combined_score,
          metrics_by_category, metrics_by_question_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        run_id, benchmark, provider,
        results.length,
        results.filter(r => r.score >= 0).length,
        results.filter(r => r.score < 0).length,
        metrics.find(m => m.name === 'accuracy')?.value,
        metrics.find(m => m.name === 'f1')?.value,
        metrics.find(m => m.name === 'recall_at_5')?.value,
        metrics.find(m => m.name === 'recall_at_10')?.value,
        metrics.find(m => m.name === 'avg_search_latency_ms')?.value,
        metrics.find(m => m.name === 'avg_total_latency_ms')?.value,
        combinedScore,
        JSON.stringify(metricsByCategory),
        JSON.stringify(metricsByQuestionType)
      ]);
    }
  }
}
```

### Phase 3: Update ResultsStore Class

Add new methods to `/Users/ash/devhouse/mem-track /memorybench/core/results.ts`:

```typescript
// New methods to add:

/**
 * Save aggregated metrics for a run/benchmark/provider.
 */
saveAggregatedMetrics(
  runId: string,
  benchmark: string,
  provider: string,
  metrics: AggregatedMetricsInput
): void;

/**
 * Get leaderboard for all benchmarks.
 */
getOverallLeaderboard(options?: {
  limit?: number;
  providerType?: string;
  providerCategory?: string;
}): LeaderboardEntry[];

/**
 * Get leaderboard for specific benchmark.
 */
getBenchmarkLeaderboard(
  benchmark: string,
  options?: { limit?: number }
): LeaderboardEntry[];

/**
 * Get category breakdown for a run/benchmark/provider.
 */
getCategoryBreakdown(
  runId: string,
  benchmark: string,
  provider: string
): CategoryBreakdown;

/**
 * Get historical data for provider.
 */
getProviderHistory(
  provider: string,
  benchmark?: string
): HistoricalDataPoint[];

/**
 * Create a leaderboard snapshot.
 */
createLeaderboardSnapshot(
  date: string,
  benchmark?: string
): void;
```

### Phase 4: Update BenchmarkRunner

Modify `/Users/ash/devhouse/mem-track /memorybench/core/runner.ts` to save aggregated metrics automatically:

```typescript
// In BenchmarkRunner.runSingle(), after computing metrics:

// Save to aggregated_metrics table
const aggregatedMetrics = {
  runId,
  benchmark: benchmarkName,
  provider: providerName,
  totalItems: items.length,
  completedItems: evalResults.length,
  failedItems: items.length - evalResults.length,
  // ... all computed metrics
  combinedScore: this.computeCombinedScore(computedMetrics, evalResults),
  metricsByCategory: this.computeMetricsByCategory(evalResults),
  metricsByQuestionType: this.computeMetricsByQuestionType(evalResults),
};

resultsStore.saveAggregatedMetrics(
  runId,
  benchmarkName,
  providerName,
  aggregatedMetrics
);
```

---

## Cost Tracking Implementation

To enable cost metrics, we need to:

### 1. Add Cost Calculation Utility

Create `/Users/ash/devhouse/mem-track /memorybench/core/cost-calculator.ts`:

```typescript
/**
 * Cost calculator for different model providers.
 */

interface ModelPricing {
  inputTokensPerMillion: number;  // USD per 1M input tokens
  outputTokensPerMillion: number; // USD per 1M output tokens
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-opus-4.5': {
    inputTokensPerMillion: 15.00,
    outputTokensPerMillion: 75.00,
  },
  'claude-sonnet-3.5': {
    inputTokensPerMillion: 3.00,
    outputTokensPerMillion: 15.00,
  },

  // OpenAI
  'gpt-4-turbo': {
    inputTokensPerMillion: 10.00,
    outputTokensPerMillion: 30.00,
  },
  'gpt-3.5-turbo': {
    inputTokensPerMillion: 0.50,
    outputTokensPerMillion: 1.50,
  },

  // Add more models as needed
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    console.warn(`No pricing data for model: ${model}`);
    return 0;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputTokensPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputTokensPerMillion;

  return inputCost + outputCost;
}

export function calculateTotalCost(telemetry: ItemTelemetry, model: string): number {
  const answerCost = calculateCost(
    model,
    telemetry.answerInputTokens ?? 0,
    telemetry.answerOutputTokens ?? 0
  );

  const judgeCost = calculateCost(
    model, // or separate judge model
    telemetry.judgeInputTokens ?? 0,
    telemetry.judgeOutputTokens ?? 0
  );

  return answerCost + judgeCost;
}
```

### 2. Update Telemetry Collection

In `/Users/ash/devhouse/mem-track /memorybench/core/runner.ts`, add cost calculation:

```typescript
// After evaluation, calculate cost
const estimatedCostUsd = calculateTotalCost(telemetry, benchmarkConfig.evaluation?.model ?? 'claude-sonnet-3.5');

telemetry.estimatedCostUsd = estimatedCostUsd;
```

### 3. Add Cost Metric Calculator

Create `/Users/ash/devhouse/mem-track /memorybench/core/metrics/builtin/cost.ts`:

```typescript
export class AvgCostMetric implements MetricCalculator {
  readonly name = "avg_cost_usd";
  readonly description = "Average cost per query in USD";

  compute(results: EvalResult[]): MetricResult {
    const costs: number[] = [];

    for (const result of results) {
      const telemetry = extractTelemetry(result.metadata);
      if (telemetry?.estimatedCostUsd !== undefined) {
        costs.push(telemetry.estimatedCostUsd);
      }
    }

    if (costs.length === 0) {
      return { name: this.name, value: 0, details: { measured: 0 } };
    }

    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    const total = costs.reduce((a, b) => a + b, 0);

    return {
      name: this.name,
      value: avg,
      details: {
        measured: costs.length,
        total: results.length,
        totalCostUsd: total,
        min: Math.min(...costs),
        max: Math.max(...costs),
      },
    };
  }
}
```

---

## Leaderboard UI Data Flow

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    Leaderboard UI                           │
│  - Overall Rankings                                         │
│  - Per-Benchmark Tables                                     │
│  - Historical Charts                                        │
└─────────────┬───────────────────────────────────────────────┘
              │
              │ 1. Fetch leaderboard data
              ▼
┌─────────────────────────────────────────────────────────────┐
│              Leaderboard API / Query Layer                  │
│  - getOverallLeaderboard()                                  │
│  - getBenchmarkLeaderboard(benchmark)                       │
│  - getCategoryBreakdown(runId, benchmark, provider)         │
│  - getProviderHistory(provider, benchmark?)                 │
└─────────────┬───────────────────────────────────────────────┘
              │
              │ 2. Query aggregated_metrics
              ▼
┌─────────────────────────────────────────────────────────────┐
│              aggregated_metrics Table                       │
│  - Pre-computed combined_score                              │
│  - Pre-computed accuracy, latency, cost                     │
│  - Category/type breakdowns (JSON)                          │
└─────────────┬───────────────────────────────────────────────┘
              │
              │ 3. User clicks "View Details"
              ▼
┌─────────────────────────────────────────────────────────────┐
│              Category Breakdown View                        │
│  - Parse metrics_by_category JSON                           │
│  - Display per-category accuracy, latency                   │
└─────────────┬───────────────────────────────────────────────┘
              │
              │ 4. User clicks "View Individual Results"
              ▼
┌─────────────────────────────────────────────────────────────┐
│              results Table (Individual Traces)              │
│  - Filter by run_id, benchmark, provider                    │
│  - Display question, expected, actual, score                │
│  - Show retrieved_context for debugging                     │
└─────────────────────────────────────────────────────────────┘
```

### Example Leaderboard API Response

```json
{
  "overall": [
    {
      "rank": 1,
      "provider": "supermemory",
      "displayName": "SuperMemory",
      "type": "hosted",
      "category": "commercial",
      "combinedScore": 85.4,
      "metrics": {
        "accuracy": 0.89,
        "avgLatencyMs": 1234.5,
        "avgCostUsd": 0.0012
      },
      "runId": "run-20251218-121722-qrgu",
      "runDate": "2025-12-18T12:17:22.164Z"
    },
    {
      "rank": 2,
      "provider": "aqrag",
      "displayName": "AQRAG",
      "type": "local",
      "category": "open-source",
      "combinedScore": 82.1,
      "metrics": {
        "accuracy": 0.85,
        "avgLatencyMs": 2100.3,
        "avgCostUsd": 0.0008
      },
      "runId": "run-20251218-040852-gg4j",
      "runDate": "2025-12-18T04:08:52.000Z"
    }
  ],
  "perBenchmark": {
    "locomo": [
      {
        "rank": 1,
        "provider": "supermemory",
        "combinedScore": 87.2,
        "metrics": {
          "accuracy": 0.91,
          "recallAt5": 0.88,
          "avgLatencyMs": 1150.2
        },
        "categoryBreakdown": {
          "1": { "name": "Multi-hop", "accuracy": 0.76, "total": 50 },
          "2": { "name": "Temporal Reasoning", "accuracy": 0.73, "total": 30 }
        }
      }
    ]
  }
}
```

---

## Performance Optimization

### 1. Database Indexes

```sql
-- Core leaderboard queries
CREATE INDEX idx_agg_combined_score_desc
ON aggregated_metrics(combined_score DESC);

CREATE INDEX idx_agg_benchmark_score
ON aggregated_metrics(benchmark, combined_score DESC);

CREATE INDEX idx_agg_provider_benchmark
ON aggregated_metrics(provider, benchmark);

-- Historical queries
CREATE INDEX idx_snapshots_provider_date
ON leaderboard_snapshots(provider, snapshot_date);

-- Category drill-downs (JSON extraction)
CREATE INDEX idx_results_metadata
ON results(json_extract(metadata, '$.category'), json_extract(metadata, '$.questionType'));
```

### 2. Materialized Views (Future)

For very large datasets, consider materialized views:

```sql
-- Latest run per provider (refreshed hourly)
CREATE VIEW latest_provider_runs AS
SELECT
  provider,
  MAX(created_at) as latest_run_time
FROM aggregated_metrics
GROUP BY provider;
```

### 3. Caching Strategy

```typescript
// In-memory cache for leaderboard queries
const leaderboardCache = new Map<string, { data: any; timestamp: number }>();

function getCachedLeaderboard(key: string, ttlMs: number = 300000): any | null {
  const cached = leaderboardCache.get(key);
  if (cached && Date.now() - cached.timestamp < ttlMs) {
    return cached.data;
  }
  return null;
}

function setCachedLeaderboard(key: string, data: any): void {
  leaderboardCache.set(key, { data, timestamp: Date.now() });
}
```

---

## Future Enhancements

### 1. Provider Versioning

Track provider configuration changes over time:

```sql
CREATE TABLE provider_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    version TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    config_snapshot TEXT,  -- Full YAML config
    changes TEXT,          -- JSON diff from previous version
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
);
```

### 2. Multi-Dimensional Rankings

Support different ranking views:

- **Accuracy-First**: Sort by accuracy only
- **Speed-First**: Sort by latency only
- **Cost-Optimized**: Sort by cost-per-correct-answer
- **Balanced**: Use combined score

### 3. Benchmark Subsets

Allow leaderboards for benchmark subsets:

```sql
-- Add to benchmarks table
ALTER TABLE benchmarks ADD COLUMN subsets TEXT;  -- JSON

-- Example:
{
  "easy": { "filter": { "difficulty": "easy" } },
  "hard": { "filter": { "difficulty": "hard" } },
  "multi-hop-only": { "filter": { "category": "1" } }
}
```

### 4. Provider Tags & Filtering

Enable filtering by provider characteristics:

```typescript
interface LeaderboardFilters {
  providerType?: 'hosted' | 'local' | 'docker';
  providerCategory?: 'commercial' | 'open-source' | 'research';
  minAccuracy?: number;
  maxLatency?: number;
  maxCost?: number;
}
```

---

## Implementation Checklist

### Phase 1: Schema (Week 1)
- [ ] Create migration script with new tables
- [ ] Add indexes to existing `results` table
- [ ] Write backfill script for existing data
- [ ] Test migration on production database copy

### Phase 2: Core Logic (Week 2)
- [ ] Implement `computeCombinedScore()` function
- [ ] Add cost calculator utility
- [ ] Create cost metric calculators
- [ ] Update `BenchmarkRunner` to save aggregated metrics

### Phase 3: Query API (Week 3)
- [ ] Extend `ResultsStore` with leaderboard methods
- [ ] Implement `getOverallLeaderboard()`
- [ ] Implement `getBenchmarkLeaderboard()`
- [ ] Implement `getCategoryBreakdown()`
- [ ] Implement `getProviderHistory()`

### Phase 4: Snapshots (Week 4)
- [ ] Implement snapshot creation logic
- [ ] Create scheduled job for weekly snapshots
- [ ] Build historical chart data API

### Phase 5: UI Integration (Week 5-6)
- [ ] Build leaderboard UI components
- [ ] Implement drill-down views
- [ ] Add historical charts
- [ ] Performance testing & optimization

---

## Appendix: Sample Queries

### A. Get Top 10 Providers (Overall)

```sql
WITH latest AS (
  SELECT provider, MAX(created_at) as max_time
  FROM aggregated_metrics
  GROUP BY provider
)
SELECT
  am.provider,
  p.display_name,
  am.combined_score,
  am.accuracy,
  am.avg_total_latency_ms,
  am.avg_cost_usd
FROM aggregated_metrics am
JOIN latest l ON am.provider = l.provider AND am.created_at = l.max_time
JOIN providers p ON am.provider = p.name
ORDER BY am.combined_score DESC
LIMIT 10;
```

### B. Compare Providers on LoCoMo

```sql
SELECT
  am.provider,
  am.accuracy,
  am.recall_at_5,
  am.avg_total_latency_ms,
  JSON_EXTRACT(am.metrics_by_category, '$.1.accuracy') as multi_hop_accuracy,
  JSON_EXTRACT(am.metrics_by_category, '$.2.accuracy') as temporal_accuracy
FROM aggregated_metrics am
WHERE am.benchmark = 'locomo'
  AND am.run_id IN (
    SELECT run_id FROM aggregated_metrics
    WHERE benchmark = 'locomo'
    GROUP BY provider
    HAVING MAX(created_at)
  )
ORDER BY am.combined_score DESC;
```

### C. Provider Performance Over Time

```sql
SELECT
  ls.snapshot_date,
  ls.combined_score,
  ls.accuracy,
  ls.rank
FROM leaderboard_snapshots ls
WHERE ls.provider = 'supermemory'
  AND ls.benchmark = 'locomo'
ORDER BY ls.snapshot_date ASC;
```

---

## Summary

This design provides:

1. **Backward compatibility** with existing schema
2. **Fast leaderboard queries** via pre-computed aggregations
3. **Flexible scoring** with configurable formulas
4. **Full traceability** from leaderboard → run → individual results
5. **Historical tracking** via snapshots
6. **Cost tracking** infrastructure ready for future implementation
7. **Extensible** for new metrics and provider types

The migration can be done incrementally without disrupting existing functionality, and the new tables enable powerful analytics while maintaining the existing results storage.
