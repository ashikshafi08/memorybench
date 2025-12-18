# CONTEXT BENCH: Master Implementation Plan
**The MTEB for Memory & Context Systems**

Date: December 17, 2025
Status: Executive Plan
Timeline: 4 weeks to MVP, 12 weeks to full platform

---

## 🎯 EXECUTIVE SUMMARY: HOW EVERYTHING COMES TOGETHER

After analyzing all strategic documents and the current codebase, here's the complete picture:

### The Vision (From VISION_2025.md)
Build **Context Bench** - the universal benchmarking platform for memory/RAG/context systems. Like MTEB (for embeddings) + SWE-bench (for coding), but for context providers.

### Current Reality (From Codebase Analysis)
- **70% complete foundation** - solid architecture, 3 benchmarks, 5 providers
- **30% critical gaps** - metrics system hardcoded, no prepareData hook, missing key providers

### The Gap (From IMPLEMENTATION_STATUS.md)
- ✅ **Benchmark customization**: FULLY WORKING (YAML schemas work perfectly)
- ❌ **Provider customization**: NOT IMPLEMENTED (prepareData hook missing)
- ❌ **Advanced metrics**: NOT IMPLEMENTED (only accuracy tracked)
- ❌ **Model tracking**: NOT IMPLEMENTED (can't compare fairly)

### The Path Forward (This Plan)
**4-week sprint to MVP** → **8-week expansion** → **Ongoing ecosystem building**

---

## 📊 THE THREE-DIMENSIONAL PLATFORM

All documents agree on this core architecture:

```
┌──────────────────────────────────────────────────────────┐
│                    CONTEXT BENCH                         │
│     Universal Benchmark for Memory & Context Systems    │
└──────────────────────────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
    BENCHMARKS       PROVIDERS       EVALUATION
         │                │                │
    ┌────────┐      ┌────────┐      ┌────────┐
    │ Memory │      │ Hosted │      │Quality │
    │   RAG  │      │ Local  │      │Latency │
    │ Domain │      │ Docker │      │  Cost  │
    └────────┘      └────────┘      └────────┘
```

### Dimension 1: BENCHMARKS (Test Suites)

**Current (3):**
- ✅ LoCoMo (conversation memory)
- ✅ LongMemEval (temporal reasoning)
- ✅ RAG-template (generic test)

**Target MVP (5-8):**
- Add: Multi-doc RAG, Code RAG, Financial RAG
- Add: Single-session preferences, Conversational RAG

**Target Full (15-20):**
- Memory: Single-session, Multi-session, Temporal, Knowledge updates
- RAG: Simple, Multi-doc, Long-doc, Conversational, Code
- Domain: Legal, Financial, Medical

### Dimension 2: PROVIDERS (Systems Being Tested)

**Current (5):**
- ✅ Supermemory (hosted)
- ✅ Mem0 (hosted)
- ✅ AQRAG (local)
- ✅ Contextual Retrieval (local)
- ✅ OpenRouter RAG (local)

**Target MVP (8-10):**
- Add: **Zep** (founder priority #1)
- Add: Pinecone, ChromaDB, Weaviate

**Target Full (15+):**
- All major memory providers (Supermemory, Zep, Mem0, LangMem)
- All major vector DBs (Pinecone, Weaviate, ChromaDB, Qdrant)
- Custom implementations

### Dimension 3: EVALUATION (Metrics)

**Current (Limited):**
- ✅ Accuracy (basic)
- ✅ Recall@K, MRR (retrieval)

**Target MVP (5-8 metrics):**
- Add: **Latency** (p50, p95, p99) - CRITICAL
- Add: **Cost** (tokens, $ per query) - CRITICAL
- Add: **NDCG** (retrieval quality)
- Add: Semantic similarity

**Target Full (15-20 metrics):**
- Quality: Accuracy, F1, BLEU, NDCG, Hallucination rate
- Performance: Latency, Throughput
- Cost: Token usage, API costs
- Domain-specific: Legal citation accuracy, Code correctness

---

## 🚨 CRITICAL DEPENDENCIES: WHAT MUST BE BUILT FIRST

From the dependency analysis, this is the **ONLY correct order**:

### Layer 0: BLOCKERS (Week 1 - MUST FIX FIRST)

These 3 issues block EVERYTHING:

#### 1. prepareData Hook (CRITICAL - 10-15 hours)
**Why blocking:** Without this, providers can't customize data ingestion
**Who needs it:** Supermemory (versioning), Zep (temporal graphs), all advanced providers
**What breaks:** Can't add sophisticated providers, limited to simple YAML configs

**Files affected:**
- `/memorybench/providers/base/preprocessing.ts` - CREATE
- `/memorybench/providers/base/types.ts` - MODIFY (add prepareData interface)
- `/memorybench/providers/base/http-provider.ts` - MODIFY (default impl)
- `/memorybench/core/runner.ts` - MODIFY (call prepareData before addContext)

**Status:** Designed in PROVIDER_CUSTOMIZATION_GUIDE.md but NOT implemented

#### 2. Model Tracking (CRITICAL - 5-8 hours)
**Why blocking:** Can't compare providers fairly without knowing which models they used
**What's missing:** Results don't track embeddingModel, answeringModel, judgeModel
**Impact:** "Zep + gpt-4o" vs "Zep + Claude" appear identical in results

**Files affected:**
- `/memorybench/core/config.ts` - MODIFY (extend EvalResult interface)
- `/memorybench/core/runner.ts` - MODIFY (capture all models)
- `/memorybench/core/results.ts` - MODIFY (store model info)

**Example confusion:**
```typescript
// Current: Can't tell which models were used
{ provider: "zep", score: 0.75 }

// Should be:
{
  provider: "zep",
  embeddingModel: "(zep builtin)",
  answeringModel: "gpt-4o",
  judgeModel: "gpt-4o",
  score: 0.75
}
```

#### 3. Metric Registry (FOUNDATION - 8-12 hours)
**Why blocking:** Current metrics are hardcoded, can't add new ones
**What it enables:** NDCG, latency, cost, domain-specific metrics
**Without it:** Stuck with accuracy only, can't differentiate Context Bench

**Files affected:**
- `/memorybench/core/metrics/interface.ts` - CREATE
- `/memorybench/core/metrics/registry.ts` - CREATE
- `/memorybench/core/metrics/builtin/` - CREATE (accuracy, ndcg, latency, cost)
- `/memorybench/core/runner.ts` - MODIFY (use registry instead of hardcoded)

**Pattern from MTEB:**
```typescript
// Registry pattern - no switch statements
const registry = new MetricRegistry();
registry.register(new AccuracyMetric());
registry.register(new LatencyMetric());
registry.register(new NDCGMetric());

// YAML selects which to run
metrics: ["accuracy", "latency", "ndcg"]
```

**Week 1 Total:** 23-35 hours
**Critical:** These MUST be done before adding new providers or benchmarks

### Layer 1: FOUNDATION (Week 2 - Enables Scale)

#### 4. Latency & Cost Tracking (8-12 hours)
**Depends on:** Metric Registry (Week 1)
**Enables:** Multi-dimensional leaderboard (accuracy vs latency vs cost)

**Why critical:** Mem0's research: "26% better accuracy AND 91% lower latency AND 90% cost savings"
Users need ALL THREE metrics, not just accuracy.

**Implementation:**
```typescript
// Track timing at each phase
const searchStart = Date.now();
const results = await provider.searchQuery(query, runTag);
const searchLatency = Date.now() - searchStart;

// Store in metadata
metadata: {
  searchLatency,
  answerLatency,
  totalTokens,
  estimatedCost
}
```

#### 5. Add Zep Provider (8-12 hours)
**Depends on:** prepareData hook (Week 1)
**Priority:** CRITICAL - Founder's #1 request

**Why first:** Demonstrates platform value, validates prepareData hook design

**Files:**
- `/memorybench/providers/configs/zep.yaml` - CREATE
- `/memorybench/providers/adapters/zep.ts` - CREATE

**Week 2 Total:** 16-24 hours (plus testing/docs)

### Layer 2: EXPANSION (Weeks 3-4 - Scale Out)

#### 6. New Benchmarks (12-16 hours each)
**Depends on:** Metric Registry (to support custom metrics)

**Priority order (Week 3):**
1. Multi-doc RAG (10h) - High value, clear use case
2. Code RAG (12h) - Developer appeal, differentiation
3. Financial RAG (10h) - Domain showcase
4. Single-session prefs (6h) - Easy synthetic benchmark

**Priority order (Week 4):**
5. Conversational RAG (8h)
6. Long-document RAG (10h)
7. Temporal reasoning (8h)
8. Knowledge updates (6h)

#### 7. New Providers (6-10 hours each)
**Depends on:** prepareData hook

**Priority order:**
1. Zep (Week 2) - Founder priority
2. Pinecone (Week 3, 6h) - Popular, YAML-only
3. ChromaDB (Week 3, 6h) - Local, developer favorite
4. Weaviate (Week 4, 8h) - Hosted + Docker

**Weeks 3-4 Total:** 80-100 hours

---

## 📅 THE 4-WEEK SPRINT TO MVP

### WEEK 1: Foundation (Critical Path)
**Goal:** Fix blockers, enable scale

**Monday-Tuesday: Metric System**
- [ ] Create metric interface & registry (10h)
- [ ] Migrate existing metrics (accuracy, recall, MRR) (2h)
- [ ] Test all 3 benchmarks with new system (2h)

**Wednesday: Model Tracking**
- [ ] Extend EvalResult interface (2h)
- [ ] Update runner to capture models (2h)
- [ ] Update database schema (2h)

**Thursday-Friday: Performance Metrics**
- [ ] Implement LatencyMetric class (4h)
- [ ] Implement CostMetric class (4h)
- [ ] Add instrumentation to runner (4h)
- [ ] Semantic similarity evaluator (6h)

**Deliverables:**
- ✅ Metric registry with 5 metrics (accuracy, recall, NDCG, latency, cost)
- ✅ All results track 3 models (embedding, answering, judge)
- ✅ Latency/cost visible in results
- ✅ Semantic similarity evaluation working

**Time:** 38 hours (1 week with buffer)

---

### WEEK 2: Provider Flexibility
**Goal:** Add Zep, enable customization

**Monday-Tuesday: prepareData Hook**
- [ ] Create preprocessing types (4h)
- [ ] Add prepareData to Provider interface (2h)
- [ ] Implement default in HttpProvider (3h)
- [ ] Update runner integration (3h)

**Wednesday-Thursday: Zep Provider**
- [ ] Research Zep SDK/API (2h)
- [ ] Create zep.yaml config (2h)
- [ ] Implement ZepAdapter (4h)
- [ ] Test with all 3 benchmarks (2h)

**Friday: Additional Providers**
- [ ] Add Pinecone (YAML-only) (4h)
- [ ] Test Mem0 end-to-end (2h)
- [ ] Fix any issues found (2h)

**Parallel: Documentation**
- [ ] GETTING_STARTED.md (3h)
- [ ] ADDING_PROVIDERS.md (3h)
- [ ] Update README (2h)

**Deliverables:**
- ✅ prepareData hook functional
- ✅ Zep provider working (priority #1)
- ✅ 8 total providers (Zep, Pinecone, Mem0 verified + 5 existing)
- ✅ Complete user documentation

**Time:** 38 hours

---

### WEEK 3: Benchmark Expansion (Part 1)
**Goal:** Show platform breadth

**Monday: Multi-Doc RAG**
- [ ] Create multi-doc-rag.yaml (2h)
- [ ] Adapt MS MARCO or Wikipedia dataset (4h)
- [ ] Test with 3 providers (2h)
- [ ] Validate results (2h)

**Tuesday: Code RAG**
- [ ] Create code-rag.yaml (2h)
- [ ] Source GitHub repo Q&A pairs (4h)
- [ ] Test with 3 providers (2h)
- [ ] Validate results (2h)

**Wednesday: Financial RAG**
- [ ] Create financial-rag.yaml (2h)
- [ ] Adapt FinQA or SEC filings (4h)
- [ ] Test with 3 providers (2h)
- [ ] Validate results (2h)

**Thursday: Single-Session Preferences**
- [ ] Create single-session-prefs.yaml (1h)
- [ ] Generate 100 synthetic examples (3h)
- [ ] Test with 3 providers (2h)

**Friday: ChromaDB Provider**
- [ ] Create chromadb.yaml (2h)
- [ ] Implement ChromaDB adapter (4h)

**Deliverables:**
- ✅ 4 new benchmarks (multi-doc, code, financial, single-session)
- ✅ 9 total providers (+ ChromaDB)
- ✅ 7 total benchmarks

**Time:** 46 hours

---

### WEEK 4: Benchmark Expansion (Part 2) & Testing
**Goal:** Reach 13+ benchmarks, full testing

**Monday-Tuesday: More Benchmarks**
- [ ] Conversational RAG (8h)
- [ ] Long-document RAG (10h)

**Wednesday: Final Benchmarks**
- [ ] Temporal reasoning (8h)
- [ ] Knowledge updates (6h)

**Thursday: Weaviate Provider**
- [ ] Weaviate hosted + docker (8h)

**Friday: Comprehensive Testing**
- [ ] Test all 10 providers × 5 core benchmarks (6h)
- [ ] Fix issues discovered (4h)
- [ ] Performance validation (2h)

**Deliverables:**
- ✅ 13-14 total benchmarks
- ✅ 10 working providers
- ✅ 500+ evaluation records in database
- ✅ Ready for leaderboard (Phase 5)

**Time:** 52 hours

---

## 🎯 MVP SUCCESS CRITERIA

After 4 weeks, we have:

### Functional Requirements
- [ ] 13+ benchmarks across 3 categories (memory, RAG, domain)
- [ ] 10+ providers across 3 types (hosted, local, docker)
- [ ] 130+ provider×benchmark combinations tested
- [ ] 500+ individual evaluation results

### Technical Requirements
- [ ] 5+ metrics tracked (accuracy, latency, cost, NDCG, recall)
- [ ] All results show which models were used
- [ ] Provider customization via prepareData hook
- [ ] Reproducible results (run tag isolation working)

### Documentation Requirements
- [ ] GETTING_STARTED.md complete
- [ ] ADDING_PROVIDERS.md complete
- [ ] ADDING_BENCHMARKS.md complete
- [ ] README updated with vision

### Quality Requirements
- [ ] All benchmarks tested with 3+ providers
- [ ] Results validated against published baselines (where available)
- [ ] No data contamination between runs
- [ ] Performance acceptable (<10min for full benchmark run)

---

## 🔄 HOW THE PIECES FIT TOGETHER

### Data Flow: From Benchmark to Leaderboard

```
1. BENCHMARK CONFIG (YAML)
   ├─ Schema defines data extraction
   ├─ Metrics define evaluation
   └─ Question types define breakdowns

2. DATA LOADER
   ├─ Loads from local/HuggingFace/URL
   ├─ Extracts via JSONPath
   └─ Creates BenchmarkItem[]

3. RUNNER ORCHESTRATION
   ├─ Phase 1: Ingest
   │   ├─ Call provider.prepareData() (if exists)
   │   └─ Call provider.addContext()
   ├─ Phase 2: Search (track latency)
   │   └─ Call provider.searchQuery()
   ├─ Phase 3: Evaluate
   │   ├─ Generate answer (track latency, tokens)
   │   └─ Judge answer

4. METRIC CALCULATION
   ├─ Registry.calculateAll(results, metrics)
   ├─ Accuracy by overall/type/category
   ├─ Latency p50/p95/p99
   ├─ Cost per query
   └─ NDCG, Recall, MRR

5. RESULTS STORAGE
   ├─ Per-result: provider, models, score, latency, cost
   ├─ Aggregated: metrics by benchmark/provider/type
   └─ Breakdown: by question type, category

6. LEADERBOARD
   ├─ Overall: Across all benchmarks
   ├─ Per-benchmark: Detailed breakdown
   ├─ Multi-dimensional: Accuracy vs Latency vs Cost
   └─ Pareto frontier: Best tradeoffs
```

### Integration Points

**Point 1: Provider Interface**
```typescript
// All providers implement this
interface Provider {
  // Week 2 addition
  prepareData?(data: PreparedData, context: DataPreparationContext):
    Promise<PreparedDataResult>;

  // Existing
  addContext(data: PreparedData, runTag: string): Promise<void>;
  searchQuery(query: string, runTag: string): Promise<SearchResult[]>;
  clear(runTag: string): Promise<void>;
}
```

**Point 2: Metric Interface**
```typescript
// All metrics implement this (Week 1)
interface MetricCalculator {
  name: string;
  calculate(results: EvalResult[], config?: MetricConfig): MetricResult;
}

// Registry orchestrates (Week 1)
const metrics = registry.calculateAll(results, benchmarkConfig.metrics);
```

**Point 3: Result Schema**
```typescript
// Extended in Week 1
interface EvalResult {
  // Existing
  provider: string;
  score: number;

  // NEW in Week 1
  embeddingModel?: string;
  answeringModel: string;
  judgeModel: string;

  metadata: {
    searchLatency: number;      // NEW
    answerLatency: number;      // NEW
    totalTokens: number;        // NEW
    estimatedCost: number;      // NEW
    questionType?: string;
    category?: string;
  };
}
```

---

## 📊 PHASED ROADMAP BEYOND MVP

### Phase 1: MVP (Weeks 1-4) - THIS PLAN
**Deliverable:** Working Context Bench with 13 benchmarks, 10 providers

### Phase 2: Polish & Launch (Weeks 5-6)
**Focus:** Leaderboard, documentation, marketing

**Tasks:**
- Static leaderboard HTML generation (12h)
- Results visualization charts (10h)
- Blog post: "Introducing Context Bench" (6h)
- HuggingFace Space setup (8h)
- Provider company outreach (ongoing)

**Deliverable:** Public leaderboard, initial launch

### Phase 3: Expansion (Weeks 7-12)
**Focus:** More benchmarks, advanced metrics, community

**Tasks:**
- Add 10+ more benchmarks (Legal, Medical, etc)
- Advanced metrics (BLEU, F1, Hallucination)
- Submission workflows
- CI/CD automation

**Deliverable:** 25+ benchmarks, 15+ providers, automated testing

### Phase 4: Ecosystem (Months 3-6)
**Focus:** Community growth, research partnerships

**Tasks:**
- Research collaborations
- Annual competition
- Conference presentations
- Monthly community calls

**Deliverable:** Active community, trusted results, industry adoption

---

## 🎯 CRITICAL SUCCESS FACTORS

### Week 1 is CRITICAL
If Week 1 doesn't complete:
- Can't add sophisticated providers (no prepareData)
- Can't show multi-dimensional metrics (accuracy only)
- Can't compare fairly (no model tracking)
- **Everything else blocks**

### Zep Provider is CRITICAL
- Founder's #1 priority
- Validates platform value
- Demonstrates prepareData hook
- **Must work by end of Week 2**

### Metric Diversity is CRITICAL
- Differentiates from existing benchmarks
- "Accuracy + Latency + Cost" is the value prop
- **Must track all 3 by end of Week 1**

### Documentation is CRITICAL
- Users can't adopt without docs
- Providers can't be added without guides
- **Must complete by end of Week 2**

---

## 🚨 RISKS & MITIGATION

### Risk 1: Week 1 Overruns
**Impact:** HIGH - Blocks everything
**Probability:** MEDIUM
**Mitigation:**
- Start with metric registry (most critical)
- Model tracking can slip to Week 2 if needed
- Semantic similarity is optional

### Risk 2: Zep Integration Issues
**Impact:** HIGH - Founder priority
**Probability:** LOW-MEDIUM
**Mitigation:**
- Research Zep API thoroughly first
- Budget 2 extra hours for unknowns
- Have fallback (Pinecone is simpler)

### Risk 3: Benchmark Quality
**Impact:** MEDIUM
**Probability:** MEDIUM
**Mitigation:**
- Start with easy benchmarks (multi-doc, single-session)
- Validate with 3+ providers
- Synthetic data easier than real-world

### Risk 4: Time Estimates Wrong
**Impact:** MEDIUM
**Probability:** HIGH (always)
**Mitigation:**
- Built in 20% buffer each week
- Can drop low-priority benchmarks (Legal, Temporal)
- Minimum 8 benchmarks still shows breadth

---

## 📝 WEEKLY REVIEW CHECKPOINTS

### End of Week 1 Review:
**Questions:**
- Does metric registry work for all 3 existing benchmarks?
- Can we see latency/cost for all results?
- Are all 3 models tracked in database?

**Decision:** Proceed to Week 2 only if YES to all

### End of Week 2 Review:
**Questions:**
- Does Zep provider work for all 3 benchmarks?
- Can providers use prepareData hook?
- Is documentation sufficient for new contributors?

**Decision:** Proceed to Week 3 only if YES to all

### End of Week 3 Review:
**Questions:**
- Do we have 7+ benchmarks working?
- Do we have 9+ providers working?
- Is data quality acceptable?

**Decision:** Week 4 can proceed with adjustments

### End of Week 4 Review:
**Questions:**
- 13+ benchmarks?
- 10+ providers?
- 500+ evaluation results?
- Ready for leaderboard?

**Decision:** Proceed to Phase 2 (leaderboard) or iterate

---

## 🎓 LESSONS FROM STRATEGIC DOCS

### From VISION_2025.md:
- "Dead simple to add benchmarks/providers" (YAML only)
- "Like MTEB for context systems"
- "Accuracy + Latency + Cost" (not just one metric)

### From METRICS_AND_ORCHESTRATION.md:
- Metric Registry pattern (no switch statements)
- Track ALL models (embedding, answering, judge)
- Provider vs model distinction matters

### From PROVIDER_CUSTOMIZATION_GUIDE.md:
- prepareData hook is the customization point
- YAML for simple, TypeScript for advanced
- No switch statements per benchmark

### From IMPLEMENTATION_STATUS.md:
- Benchmark system: ✅ DONE (YAML works)
- Provider customization: ❌ TODO (prepareData)
- This confirms Week 1 priorities

### From Refactoring Analysis:
- 47 issues, but only 8 CRITICAL
- Focus on Week 1 items only
- Can refactor incrementally

### From Problem Statement (Implied):
- Need to benchmark Supermemory, Zep, Mem0
- Need diverse benchmarks (memory, RAG, domain)
- Need public leaderboard
- Need easy extensibility

---

## 🎯 THE MASTER SCHEDULE

### Week 1: FOUNDATION (Dec 18-22)
**Hours:** 38
**Focus:** Metrics, model tracking, blockers
**Critical:** prepareData, metric registry, model tracking

### Week 2: PROVIDERS (Dec 25-29)
**Hours:** 38
**Focus:** Zep, provider flexibility, docs
**Critical:** Zep working, prepareData functional

### Week 3: BENCHMARKS (Jan 1-5)
**Hours:** 46
**Focus:** 4 new benchmarks, ChromaDB
**Critical:** Multi-doc, Code, Financial RAG working

### Week 4: SCALE (Jan 8-12)
**Hours:** 52
**Focus:** 4 more benchmarks, Weaviate, testing
**Critical:** 13+ benchmarks, 10+ providers tested

### TOTAL: 174 hours (4.3 weeks full-time)

---

## ✅ FINAL CHECKLIST

Before starting Week 1:
- [ ] Review this master plan
- [ ] Confirm Zep is priority #1
- [ ] Decide: "Context Bench" or "Memory Bench" name
- [ ] Set up project tracking board
- [ ] Commit to Week 1 completion before starting Week 2

After completing Week 4:
- [ ] 13+ benchmarks ✓
- [ ] 10+ providers ✓
- [ ] 5+ metrics ✓
- [ ] Documentation complete ✓
- [ ] Ready for leaderboard ✓

**This is your roadmap. Execute Week 1 first. Everything else depends on it.**
