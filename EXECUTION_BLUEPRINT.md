# CONTEXT BENCH: Execution Blueprint v2
## Zero-Drift Edition - Verified Against Actual Codebase

**Last verified:** 2025-12-17
**Codebase version:** Based on actual code analysis

---

## DOCUMENT STRUCTURE

This blueprint clearly separates:
- **CURRENT STATE** - What actually exists in the codebase (verified)
- **TARGET STATE** - What we want to build (aspirational)

---

## HOW ALL DOCUMENTS FIT TOGETHER

```
VISION_2025.md ──────────────→ WHAT we're building (MTEB for context)
       │
       ▼
ARCHITECTURE.md ─────────────→ HOW it's designed (B×P×E)
       │
       ▼
PROVIDER_CUSTOMIZATION_GUIDE.md → HOW providers customize (prepareData)
       │
       ▼
METRICS_AND_ORCHESTRATION.md ─→ HOW metrics work (Registry pattern)
       │
       ▼
IMPLEMENTATION_STATUS.md ────→ WHAT's done vs not done
       │
       ▼
IMPLEMENTATION_ROADMAP.md ───→ WHEN to build each phase
       │
       ▼
MASTER_PLAN.md ──────────────→ 4-week execution details
       │
       ▼
THIS BLUEPRINT ──────────────→ VERIFIED contracts + migration path
```

---

## PART 1: CURRENT STATE (What Actually Exists)

### 1.1 CLI Interface (Actual)

**Entry point:** `cli/index.ts` (586 lines)

**Invocation:**
```bash
# Primary method
memorybench <command> [options]

# Alternative
bun run cli/index.ts <command> [options]
```

**Commands:**

| Command | Syntax | Description |
|---------|--------|-------------|
| `help` | `memorybench help` | Show help text |
| `list` | `memorybench list [--providers] [--benchmarks] [--tags <tag>]` | List providers/benchmarks |
| `describe` | `memorybench describe <name>` | Show details about provider/benchmark |
| `eval` | `memorybench eval --benchmarks <name> --providers <name> [options]` | Run evaluation |
| `results` | `memorybench results <runId> [--breakdown] [--compare <provider>]` | View results |
| `export` | `memorybench export <runId> [--format json|csv] [--output <path>]` | Export results |

**eval command options (ACTUAL):**
```bash
memorybench eval \
  --benchmarks <name> \          # REQUIRED - can repeat for multiple
  --providers <name> \           # REQUIRED - can repeat for multiple
  --limit <number> \             # Optional - max items
  --start <number> \             # Optional - start index
  --end <number> \               # Optional - end index
  --concurrency <number> \       # Optional - parallel execution (default: 10)
  --question-type <string> \     # Optional - filter by type
  --run-id <string> \            # Optional - custom run ID
  --output <path>                # Optional - output directory (default: ./results)
```

**Working examples:**
```bash
# Simple evaluation
memorybench eval --benchmarks rag-template --providers aqrag

# Multiple benchmarks/providers
memorybench eval --benchmarks longmemeval --benchmarks rag-template \
                  --providers supermemory --providers aqrag

# With limit
memorybench eval --benchmarks rag-template --providers aqrag --limit 10

# View results with breakdown
memorybench results run-20251216-123456-abc1 --breakdown
```

**NOT supported (contrary to old blueprint):**
- `--metrics` flag does NOT exist
- Positional arguments for benchmarks/providers (must use flags)

---

### 1.2 YAML Schema (Actual)

**Location:** `core/config.ts` (BenchmarkConfigSchema)

**Key fields:**
- **Uses `data:`** NOT `dataSource:`
- **Uses plain paths for top-level fields** NOT JSONPath
- **Uses JSONPath only for nested extraction** (itemSchema, HTTP mapping)

**Actual schema structure:**
```yaml
# benchmarks/configs/[name].yaml
name: string                    # REQUIRED
displayName: string             # REQUIRED
description: string             # Optional
version: string                 # Optional
source: string                  # Optional
paper: string                   # Optional
tags: string[]                  # Optional

data:                           # NOT 'dataSource:'
  type: local | huggingface | url
  path: "./path/to/data.json"   # or dataset name or URL
  format: json | jsonl

schema:
  itemId: "id"                  # PLAIN PATH - not "$.id"
  question: "question"          # PLAIN PATH
  answer: "expected_answer"     # PLAIN PATH

  # Nested fields use dot notation
  metadata:
    difficulty: "metadata.difficulty"   # DOT NOTATION
    category: "metadata.category"       # DOT NOTATION

  # Context with array items uses JSONPath in itemSchema
  context:
    field: "documents"
    type: array
    itemSchema:
      content: "$.content"      # JSONPath HERE (for nested extraction)
      id: "$.id"                # JSONPath HERE
```

**Field path rules:**
| Location | Syntax | Example |
|----------|--------|---------|
| Top-level schema fields | Plain path | `itemId: "id"` |
| Nested object access | Dot notation | `difficulty: "metadata.difficulty"` |
| Context itemSchema | JSONPath | `content: "$.content"` |
| HTTP body/response mapping | JSONPath | `body: { userId: "$.userId" }` |

**Working example (from rag-template.yaml):**
```yaml
name: rag-template
displayName: RAG Template Benchmark
description: A template benchmark for testing RAG providers

data:
  type: local
  path: "./benchmarks/RAG-template-benchmark/data.json"
  format: json

schema:
  itemId: "id"                      # PLAIN - not "$.id"
  question: "question"              # PLAIN
  answer: "expected_answer"         # PLAIN
  context:
    field: "documents"
    type: array
    itemSchema:
      content: "$.content"          # JSONPath for nested
```

---

### 1.3 Metrics System (Actual)

**Location:** `core/metrics.ts` (single file, 291 lines)

**NOT a folder structure** - it's one file.

**Pattern:** Switch statement (NOT registry pattern)

**Actual function signature:**
```typescript
export function calculateAllMetrics(
  results: EvalResult[],
  metricsToCalculate: string[] = ["accuracy"]
): MetricsReport
```

**Available metrics (hardcoded):**
1. `accuracy` - % correct
2. `accuracy_by_question_type` - breakdown by questionType
3. `accuracy_by_category` - breakdown by category
4. `recall_at_5` - Recall@5
5. `recall_at_10` - Recall@10
6. `precision_at_5` - Precision@5
7. `precision_at_10` - Precision@10
8. `mrr` - Mean Reciprocal Rank
9. `avg_retrieval_score` - Average retrieval score

**NOT available (contrary to old blueprint):**
- BLEU score
- Cosine similarity
- F1 score
- Custom metric registration

**Actual interfaces:**
```typescript
export interface MetricResult {
  name: string;
  value: number;
  details?: Record<string, unknown>;
}

export interface MetricsReport {
  accuracy: number;
  metrics: MetricResult[];
  byQuestionType?: Record<string, number>;
  byCategory?: Record<string, number>;
}
```

---

### 1.4 Provider Interface (Actual)

**Location:** `providers/base/types.ts`

**Provider interface:**
```typescript
export interface Provider {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  addContext(data: PreparedData, runTag: string): Promise<void>;

  // NOTE: Has optional third parameter!
  searchQuery(
    query: string,
    runTag: string,
    options?: SearchOptions       // <-- THIS EXISTS
  ): Promise<SearchResult[]>;

  clear(runTag: string): Promise<void>;

  initialize?(): Promise<void>;
  cleanup?(): Promise<void>;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
  includeChunks?: boolean;
}
```

**SearchResult interface:**
```typescript
export interface SearchResult {
  id: string;
  content: string;
  score: number;
  chunks?: Array<{ content: string; score: number }>;
  metadata?: Record<string, unknown>;
}
```

---

### 1.5 EvalResult Interface (Actual)

**Location:** `core/config.ts`

```typescript
export interface EvalResult {
  runId: string;
  benchmark: string;
  provider: string;
  itemId: string;
  question: string;
  expected: string;
  actual: string;
  score: number;
  correct: boolean;
  retrievedContext: SearchResult[];
  metadata: Record<string, unknown>;  // Generic metadata
}
```

**Metadata fields actually populated (from runner.ts):**
```typescript
metadata: {
  questionType?: string;     // From benchmark item
  category?: string;         // From benchmark item
  // + any custom fields from item.metadata
}
```

**NOT in EvalResult (contrary to old blueprint):**
- `embeddingModel` - Does not exist
- `answeringModel` - Does not exist
- `judgeModel` - Does not exist
- `searchLatency` - Does not exist
- `answerLatency` - Does not exist
- `totalTokens` - Does not exist
- `estimatedCost` - Does not exist

---

### 1.6 Current Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| YAML Benchmark Schema | WORKING | Uses `data:`, plain paths |
| Generic Loader | WORKING | JSONPath + dot notation |
| 3 Benchmarks | WORKING | LoCoMo, LongMemEval, RAG-template |
| 5 Providers | WORKING | Supermemory, Mem0, AQRAG, OpenRouter-RAG, Contextual-Retrieval |
| Provider Interface | WORKING | Has SearchOptions param |
| CLI | WORKING | Flag-based, no --metrics |
| LLM Judge | PLACEHOLDER | Returns hardcoded heuristic in runner.ts |
| Checkpoint/Resume | WORKING | Via --run-id |
| Results Storage | WORKING | SQLite |

**Critical bugs found:**
- `ContextualRetrievalAdapter` ignores `runTag` - no isolation between runs
- `ContextualRetrievalAdapter.clear()` is silent failure - doesn't actually clear

---

## PART 2: TARGET STATE (What We Want To Build)

### 2.1 CLI Extensions (Aspirational)

**New flag to add:**
```bash
memorybench eval \
  --benchmarks <name> \
  --providers <name> \
  --metrics <name>              # NEW - metric selection
```

**Implementation path:**
1. Add `--metrics` parsing in `cli/index.ts`
2. Pass to runner via `RunOptions`
3. Use in `calculateAllMetrics()` call

---

### 2.2 Metric Registry Pattern (Aspirational)

**Target architecture:**

Instead of switch statement, we want:
```typescript
// core/metrics/interface.ts (NEW FILE)
export interface MetricCalculator {
  readonly name: string;
  readonly category: "quality" | "retrieval" | "performance" | "cost";
  calculate(results: EvalResult[], config?: MetricConfig): MetricResult;
}

// core/metrics/registry.ts (NEW FILE)
export class MetricRegistry {
  private metrics = new Map<string, MetricCalculator>();

  register(metric: MetricCalculator) {
    this.metrics.set(metric.name, metric);
  }

  calculate(name: string, results: EvalResult[]): MetricResult {
    const calc = this.metrics.get(name);
    if (!calc) throw new Error(`Unknown metric: ${name}`);
    return calc.calculate(results);
  }
}
```

**Migration path:**
1. Create `core/metrics/` folder
2. Move `core/metrics.ts` to `core/metrics/legacy.ts`
3. Create new `interface.ts` and `registry.ts`
4. Wrap existing functions as MetricCalculator implementations
5. Update `core/index.ts` exports
6. Gradually migrate callers

---

### 2.3 Model Tracking (Aspirational)

**Extended EvalResult:**
```typescript
export interface EvalResult {
  // ... existing fields ...

  // NEW: Model tracking (add to metadata for now)
  metadata: {
    questionType?: string;
    category?: string;

    // NEW fields to add:
    embeddingModel?: string;     // Provider's embedding model
    answeringModel?: string;     // Model that generated answer
    judgeModel?: string;         // Model that evaluated
    searchLatencyMs?: number;    // ms for search
    answerLatencyMs?: number;    // ms for answer generation
    totalTokens?: number;        // input + output
    estimatedCostUsd?: number;   // $ estimate
  };
}
```

**Implementation path:**
1. Add timing in `runner.ts` around search/answer calls
2. Extract model names from provider/evaluation configs
3. Store in metadata (not top-level EvalResult)
4. Update results display to show new fields

---

### 2.4 prepareData Hook (Aspirational)

**Extended Provider interface:**
```typescript
export interface Provider {
  // ... existing methods ...

  // NEW: Optional customization hook
  prepareData?(
    data: PreparedData,
    context: DataPreparationContext
  ): Promise<PreparedDataResult>;
}

export interface DataPreparationContext {
  benchmarkConfig: BenchmarkConfig;
  runTag: string;
  itemId: string;
}

export interface PreparedDataResult {
  data: PreparedData;
  log?: PreprocessingLog[];
}
```

**Implementation path:**
1. Add interface to `providers/base/types.ts`
2. Add optional call in runner before `addContext()`
3. Implement in specific providers that need customization

---

### 2.5 Zep Provider (Aspirational)

**Verified Zep SDK API (from @getzep/zep-js):**

```typescript
import { ZepClient } from "@getzep/zep-js";

// Initialize
const client = new ZepClient({
  apiKey: process.env.ZEP_API_KEY
});

// Create session
await client.memory.addSession({
  sessionId: "session-123",
  userId: "user-123"
});

// Add memory
await client.memory.add("session-123", {
  messages: [{
    role: "user",
    content: "message content"
  }]
});

// Search memory
const results = await client.memory.searchMemory(
  "session-123",
  { text: "search query" },
  5  // limit
);

// Note: No direct delete by session ID in current API
```

**Zep adapter implementation:**
```typescript
// providers/adapters/zep.ts
import { ZepClient } from "@getzep/zep-js";
import { LocalProvider } from "../base/local-provider.ts";

export class ZepAdapter extends LocalProvider {
  private client!: ZepClient;

  protected async doInitialize(): Promise<void> {
    this.client = new ZepClient({
      apiKey: process.env.ZEP_API_KEY
    });
  }

  async addContext(data: PreparedData, runTag: string): Promise<void> {
    // Create session if doesn't exist
    try {
      await this.client.memory.addSession({
        sessionId: runTag,
        userId: `benchmark-${runTag}`
      });
    } catch (e) {
      // Session may already exist
    }

    await this.client.memory.add(runTag, {
      messages: [{
        role: "user",
        content: data.content
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

    return results.map(r => ({
      id: r.uuid || "",
      content: r.message?.content || "",
      score: r.score || 0,
      metadata: {}
    }));
  }

  async clear(runTag: string): Promise<void> {
    // Zep doesn't have direct session delete in JS SDK
    // May need to use API directly or skip
    console.warn(`Zep clear not fully implemented for ${runTag}`);
  }
}
```

---

## PART 3: MIGRATION PLAN

### Week 1: Foundation (No Breaking Changes)

**Day 1-2: Metric Registry (additive)**
```
1. Create core/metrics/ folder
2. Create interface.ts with MetricCalculator interface
3. Create registry.ts with MetricRegistry class
4. Create builtin/ folder with accuracy.ts, retrieval.ts
5. Keep core/metrics.ts working (backward compat)
6. Export both old and new from core/index.ts
```

**Day 3-4: Model/Latency Tracking (additive)**
```
1. Add timing around search/answer in runner.ts
2. Store in metadata (not new EvalResult fields)
3. Update results display to show if present
```

**Day 5: Testing**
```
1. Run all 3 benchmarks with both metric systems
2. Verify backward compatibility
3. Document any issues
```

### Week 2: Provider Flexibility

**Day 1-2: prepareData Hook**
```
1. Add interface to types.ts
2. Add optional call in runner.ts
3. No providers use it yet (backward compat)
```

**Day 3-4: Zep Provider**
```
1. Create providers/configs/zep.yaml
2. Create providers/adapters/zep.ts
3. Test with all 3 benchmarks
```

**Day 5: Fix Critical Bugs**
```
1. Fix ContextualRetrievalAdapter runTag handling
2. Fix ContextualRetrievalAdapter.clear()
3. Test isolation between runs
```

### Week 3-4: Expansion

**New Benchmarks:**
- Use correct YAML schema (data:, plain paths)
- Test each with 3+ providers
- Verify no data contamination

---

## PART 4: VALIDATION CHECKLIST

### Before Claiming "Done" on Week 1

- [ ] `memorybench eval --benchmarks rag-template --providers aqrag` still works
- [ ] Old metrics code still works (backward compat)
- [ ] New MetricRegistry can calculate accuracy
- [ ] Metadata contains latency when measured
- [ ] All 3 benchmarks pass
- [ ] No new TypeScript errors

### Before Claiming "Done" on Week 2

- [ ] Zep provider works with rag-template benchmark
- [ ] prepareData hook exists but doesn't break existing providers
- [ ] GETTING_STARTED.md uses correct CLI syntax
- [ ] ContextualRetrieval bugs fixed

### Before Claiming "Done" on MVP

- [ ] 10+ benchmarks working
- [ ] 8+ providers working
- [ ] All YAML configs use correct schema (data:, plain paths)
- [ ] No --metrics flag issues (it won't exist yet)
- [ ] Results show accurate timing data

---

## PART 5: QUICK REFERENCE

### Correct CLI Usage

```bash
# Evaluate
memorybench eval --benchmarks <name> --providers <name> [--limit N]

# List all
memorybench list

# List with filter
memorybench list --benchmarks --tags temporal

# Describe
memorybench describe longmemeval

# Results
memorybench results <runId> --breakdown
```

### Correct YAML Schema

```yaml
name: my-benchmark
displayName: My Benchmark

data:                           # NOT dataSource
  type: local
  path: "./data.json"

schema:
  itemId: "id"                  # PLAIN PATH - not $.id
  question: "question"          # PLAIN PATH
  answer: "answer"              # PLAIN PATH

  context:
    field: "documents"
    type: array
    itemSchema:
      content: "$.content"      # JSONPath for nested
```

### Correct Provider Implementation

```typescript
async searchQuery(
  query: string,
  runTag: string,
  options?: SearchOptions        // Include this parameter!
): Promise<SearchResult[]> {
  const limit = options?.limit ?? 10;
  // ... implementation
}
```

---

## SUMMARY

**This blueprint is verified against the actual codebase.**

Key corrections from previous version:
1. CLI uses `--benchmarks`/`--providers` flags (not positional args)
2. No `--metrics` flag exists (yet)
3. YAML uses `data:` not `dataSource:`
4. Schema uses plain paths, not JSONPath for top-level
5. `searchQuery()` HAS an options parameter
6. EvalResult doesn't have model/latency fields (use metadata)
7. Zep API is `client.memory.addSession()` / `client.memory.add(sessionId, {...})`

**Start with Part 3: Migration Plan, Week 1, Day 1.**
