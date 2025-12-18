# Implementation Status: Benchmark & Provider Customization

## Executive Summary

**TLDR:**
- ✅ **Benchmark Customization**: FULLY IMPLEMENTED and working
- ❌ **Provider Customization**: NOT IMPLEMENTED - needs to be built

---

## Part 1: Benchmark Customization (✅ WORKING)

### What the Guide Describes
> Benchmarks declare their schema via YAML config. Generic loader reads the schema and extracts data automatically. Works for ANY benchmark type.

### Current Status: ✅ FULLY IMPLEMENTED

#### Evidence from Codebase:

**1. Generic Loader Exists**
- File: `benchmarks/loaders/loader.ts` (lines 98-400)
- Features:
  - ✅ Reads `schema.itemId`, `schema.question`, `schema.answer` from YAML
  - ✅ Uses JSONPath for field extraction (`getField()` function)
  - ✅ Handles multiple context types: `array`, `object`, `string`
  - ✅ No switch statements on benchmark types
  - ✅ Truly generic - works for ANY benchmark structure

**2. All Benchmark Configs Use Schema Format**

`rag-template.yaml`:
```yaml
schema:
  itemId: "id"
  question: "question"
  answer: "expected_answer"
  context:
    field: "documents"
    type: array
    itemSchema:
      content: "$.content"  # ✅ JSONPath extractor
```

`locomo.yaml`:
```yaml
schema:
  itemId: "sample_id"
  questions:
    field: "qa"
    questionField: "question"
    answerField: "answer"
  context:
    field: "conversation"
    type: object
    itemSchema:
      speaker: "$.speaker"  # ✅ JSONPath extractor
```

`longmemeval.yaml`:
```yaml
schema:
  itemId: "question_id"
  question: "question"
  answer: "answer"
  context:
    field: "haystack_sessions"
    type: array
    dateField: "haystack_dates"
    itemSchema:
      content: "$.content"  # ✅ JSONPath extractor
```

**3. Data Flow Works End-to-End**

```typescript
// From loader.ts - ACTUALLY IMPLEMENTED
export function mapToBenchmarkItems(
  rawItems: any[],
  config: BenchmarkConfig
): BenchmarkItem[] {
  const schema = config.schema;  // ← Reads from YAML

  // Generic routing - no benchmark-specific logic
  if (schema.questions) {
    return mapNestedQuestions(rawItems, config);  // LoCoMo
  } else {
    return rawItems.map(raw => mapSingleItem(raw, config));  // RAG/LongMemEval
  }
}

// Generic extraction - works for all benchmarks
function extractContexts(item: any, schema: SchemaConfig): Context[] {
  // Handles array/object/string types
  // Uses JSONPath extractors from schema
  // NO benchmark-specific switch statements
}
```

### What Works Today

**Scenario 1: Adding RAG-template benchmark**
```bash
# Step 1: Write YAML config
cat > benchmarks/configs/my-benchmark.yaml
# Step 2: Add data.json file
# Step 3: Done! Generic loader handles it automatically
```

**Scenario 2: Adding conversation benchmark like LoCoMo**
```bash
# Same process - just different schema structure
# Generic loader adapts automatically
```

**Result:** ✅ "Adding a new benchmark is straightforward" (problem_statement.md) **IS ACHIEVED**

---

## Part 2: Provider Customization (❌ NOT IMPLEMENTED)

### What the Guide Describes
> Providers can customize data before storage via optional `prepareData()` hook. This allows versioning, metadata injection, content transformation - all without writing switch statements per benchmark.

### Current Status: ❌ NOT IMPLEMENTED

#### What's Missing:

**1. No `prepareData()` Hook**
- Searched: `providers/base/types.ts`, `providers/base/local-provider.ts`, `providers/base/http-provider.ts`
- Result: ❌ No `prepareData()` method exists in any provider interface or base class

**2. No `DataPreparationContext` Interface**
- Searched: All provider files
- Result: ❌ No such interface exists

**3. No Preprocessing Configuration Support**
- Searched: `providers/configs/*.yaml`
- Result: ❌ No `preprocessing` or `benchmarkOverrides` sections in any config
- HttpProvider doesn't read or apply any YAML preprocessing

**4. Direct Data Flow (No Customization Point)**

```typescript
// From runner.ts - CURRENT IMPLEMENTATION
const contexts = prepareBenchmarkContexts(items, benchmarkConfig);

for (const context of contexts) {
  // ❌ Data flows directly to provider with NO transformation hook
  await provider.addContext(context, runTag);
}
```

Should be (from guide):
```typescript
// PROPOSED IMPLEMENTATION
for (const context of contexts) {
  // ✅ Call prepareData if provider supports it
  let preparedData = context;
  if (provider.prepareData) {
    const result = await provider.prepareData(context, {
      benchmarkConfig,
      runTag,
      itemId: context.id
    });
    preparedData = result.data;
  }

  await provider.addContext(preparedData, runTag);
}
```

**5. No Versioning or Metadata Tracking**
- Providers cannot inject version metadata
- No preprocessing logs
- No way to track transformations applied

### What Doesn't Work Today

**Scenario 1: Supermemory wants to add userId metadata**
```yaml
# providers/configs/supermemory.yaml
preprocessing:  # ❌ NOT IMPLEMENTED
  metadata:
    userId: "benchmark-user"
```
**Result:** Config is ignored. HttpProvider doesn't read or apply it.

**Scenario 2: OpenRouterRAG wants to apply semantic chunking**
```typescript
// providers/adapters/openrouter-rag.ts
async prepareData(data, context) {  // ❌ Method doesn't exist in Provider interface
  return {
    data: {
      ...data,
      content: this.semanticChunk(data.content)  // Can't customize!
    }
  };
}
```
**Result:** Can't override method that doesn't exist in interface.

**Scenario 3: Provider wants to track schema version**
```typescript
// ❌ No mechanism to inject versioning metadata
metadata: {
  provider: {
    version: { schemaVersion: "2.0.0" }  // Nowhere to add this
  }
}
```
**Result:** No versioning support exists.

---

## Part 3: What Exists vs What Guide Describes

| Component | Guide Description | Actually Implemented | Status |
|-----------|------------------|---------------------|--------|
| **Benchmark YAML Schema** | Generic JSONPath extractors | ✅ Fully working | ✅ DONE |
| **Generic Loader** | Reads any benchmark schema | ✅ Fully working | ✅ DONE |
| **Benchmark Configs** | YAML with schema section | ✅ All 3 benchmarks have it | ✅ DONE |
| **Provider Base Classes** | LocalProvider, HttpProvider | ✅ Both exist | ✅ DONE |
| **HTTP Provider** | JSONPath request/response | ✅ Working | ✅ DONE |
| **Provider YAML Configs** | endpoints/auth/connection | ✅ supermemory.yaml has it | ✅ DONE |
| **prepareData() Hook** | Optional provider method | ❌ Doesn't exist | ❌ TODO |
| **DataPreparationContext** | Context passed to prepareData | ❌ No such interface | ❌ TODO |
| **PreparedDataResult** | Return type with log | ❌ No such interface | ❌ TODO |
| **Preprocessing YAML** | transformations/metadata | ❌ Not in configs | ❌ TODO |
| **BenchmarkOverrides** | Per-benchmark customization | ❌ Not supported | ❌ TODO |
| **Versioning Support** | Schema version tracking | ❌ No mechanism | ❌ TODO |
| **Runner Integration** | Calls prepareData before addContext | ❌ Goes directly to addContext | ❌ TODO |

---

## Part 4: OpenBench Comparison

### OpenBench Approach (Different Philosophy)

**Benchmarks:**
- Python functions with `@task` decorator
- Code-based, not YAML-based
- Extensible via entry points

```python
@task
def mbpp(subset: str = "full") -> Task:
    return Task(
        dataset=get_dataset(subset),
        solver=generate(),
        scorer=verify(),
    )
```

**Data Transformation:**
- Done in dataset loaders
- Template-based prompt formatting
- `record_to_sample()` converter functions

```python
def record_to_sample(record: dict) -> Sample:
    return Sample(
        input=format_prompt(record),
        target=record["answer"],
        metadata={"category": record["category"]}
    )
```

**Customization:**
- Via function parameters (subset, temperature, etc.)
- Metadata on samples for grouped metrics
- Scorer functions for custom evaluation

### Key Differences: OpenBench vs Memorybench

| Aspect | OpenBench | Memorybench (Current) | Memorybench (Guide) |
|--------|-----------|----------------------|---------------------|
| **Benchmark Definition** | Python code | YAML config | YAML config |
| **Data Loading** | Python functions | Generic YAML loader | Generic YAML loader |
| **Customization** | Function parameters | Not supported | prepareData hook |
| **Versioning** | Grader model versions only | None | Schema versions |
| **Extensibility** | Entry points | Factory pattern | Factory + prepareData |

**What to Adopt from OpenBench:**
- ✅ Metadata-driven aggregation (already in memorybench via schema)
- ✅ Parametrized variants (can be done via benchmark YAML config)
- ❌ Python-based benchmarks (memorybench is YAML-first by design)

**What Memorybench Does Better:**
- ✅ No code needed for benchmarks (YAML only)
- ✅ Generic loader works for all types
- ✅ Simpler for non-programmers

**What Memorybench Needs from This Comparison:**
- Add versioning support (via prepareData)
- Add transformation hooks (via prepareData)
- Keep YAML-first approach (don't switch to Python)

---

## Part 5: Implementation Plan Summary

### Phase 1: Core Infrastructure (Week 1)
**Goal:** Add prepareData hook to provider system

**Files to Create:**
- `providers/base/preprocessing.ts` - New types for prepareData system

**Files to Modify:**
- `providers/base/types.ts` - Add prepareData to Provider interface
- `providers/base/http-provider.ts` - Default prepareData implementation
- `providers/base/local-provider.ts` - Default prepareData implementation
- `core/runner.ts` - Call prepareData before addContext

**Result:** Providers can override prepareData, runner calls it

---

### Phase 2: YAML Preprocessing (Week 2)
**Goal:** HttpProvider reads preprocessing from YAML

**Files to Modify:**
- `core/config.ts` - Add preprocessing schemas
- `providers/base/http-provider.ts` - Read and apply YAML preprocessing

**Result:** Simple providers use YAML-only customization

---

### Phase 3: Migrate Adapters (Week 3)
**Goal:** Update existing providers to use prepareData

**Files to Modify:**
- `providers/adapters/aqrag.ts` - Add semantic chunking via prepareData
- `providers/adapters/openrouter-rag.ts` - Create as full example

**Result:** Advanced providers demonstrate customization

---

### Phase 4: Documentation (Week 4)
**Goal:** Complete user-facing documentation

**Files to Create:**
- `docs/adding-benchmarks.md`
- `docs/adding-simple-providers.md`
- `docs/adding-advanced-providers.md`

**Result:** Users can add benchmarks and providers easily

---

## Part 6: Answer to Your Question

> "Is benchmark customization wired in the PROVIDER_CUSTOMIZATION_GUIDE.md? Or that's a different problem we need to work on?"

### Answer:

**Benchmark Customization: ✅ YES, FULLY WIRED AND WORKING**
- Generic loader works perfectly
- YAML schema extraction is production-ready
- All 3 benchmarks use it successfully
- No code changes needed to add new benchmarks
- Aligns with problem_statement.md requirement: "adding a benchmark is straightforward"

**Provider Customization: ❌ NO, NOT WIRED - NEEDS IMPLEMENTATION**
- prepareData hook doesn't exist
- No transformation pipeline
- No versioning support
- No YAML preprocessing config
- Providers can't customize data before storage

### What This Means:

The guide describes **TWO separate systems**:

1. **Benchmark System** (Part 1 of guide) - ✅ DONE
   - "Benchmark declares schema in YAML"
   - "Generic loader reads it automatically"
   - "Works for any benchmark type"
   - **Status: This exists and works!**

2. **Provider System** (Part 2-3 of guide) - ❌ TODO
   - "Provider customizes via prepareData hook"
   - "YAML preprocessing config for simple providers"
   - "TypeScript override for advanced providers"
   - **Status: This needs to be built!**

### Recommendation:

**Implement Phase 1-2 from the plan** to add provider customization:
1. Add prepareData hook (5-10 hours)
2. YAML preprocessing config (5-10 hours)
3. Update 1-2 providers as examples (5 hours)

Total: ~15-25 hours of work to complete the system described in the guide.

---

## Part 7: Critical Files for Implementation

Based on the plan, these files need work:

### Files to CREATE:
1. `/memorybench/providers/base/preprocessing.ts`
   - Core types: DataPreparationContext, PreparedDataResult, PreprocessingLog
   - TransformationEngine helper class

### Files to MODIFY:
1. `/memorybench/providers/base/types.ts`
   - Add prepareData() to Provider interface

2. `/memorybench/providers/base/http-provider.ts`
   - Implement default prepareData() with YAML preprocessing

3. `/memorybench/core/runner.ts`
   - Call prepareData() before addContext()

4. `/memorybench/core/config.ts`
   - Add preprocessing/benchmarkOverrides schemas

5. `/memorybench/providers/adapters/aqrag.ts`
   - Example advanced prepareData implementation

---

## Appendix: Quick Reference

### What Works Today ✅
- Add benchmark via YAML only (no code)
- Generic loader handles any schema
- JSONPath extractors work
- Multiple context types supported
- HttpProvider with API mapping

### What Doesn't Work ❌
- Provider customization (prepareData)
- YAML preprocessing config
- Versioning metadata
- Transformation tracking
- Benchmark-specific overrides

### What Needs Building 🔧
- prepareData hook system
- YAML preprocessing support
- Runner integration
- Example implementations
- Documentation

### Time Estimate ⏱️
- Phase 1 (Core): 10 hours
- Phase 2 (YAML): 10 hours
- Phase 3 (Examples): 5 hours
- Phase 4 (Docs): 5 hours
- **Total: 30 hours** (1 week full-time, 2 weeks part-time)
