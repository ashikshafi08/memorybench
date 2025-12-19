# The Context Bench Vision: Universal Benchmark for Memory & Context Systems

**Date:** December 2025
**Status:** Strategic Vision Document
**Target:** Universal benchmarking platform for context/memory providers (like MTEB for embeddings, SWE-bench for coding)

---

## 🎯 OKAY, CALM DOWN. THIS IS IT.

You're building **the MTEB/SWE-bench equivalent for context and memory systems**. Not just a "memory benchmark" - a **universal platform** where:

1. ✅ **Anyone** can add new benchmarks (RAG, conversation, temporal reasoning, code, legal, financial)
2. ✅ **Anyone** can add new providers (Supermemory, Zep, Mem0, or any custom system)
3. ✅ **Anyone** can run standardized evaluations and get comparable scores
4. ✅ **Results** are reproducible, published, and create a leaderboard like MTEB

**Think:** "MTEB has 56 datasets across 8 tasks for embeddings. You're building that for context/memory."

---

## 📊 The Research: What Already Exists

### 1. MTEB (Massive Text Embedding Benchmark)
**What it does:**
- 56 datasets across 8 tasks (classification, retrieval, clustering, semantic similarity)
- Public leaderboard on HuggingFace
- Standardized evaluation for embedding models
- Easy to add models, easy to run benchmarks

**What we're copying:**
- Multi-task evaluation framework
- Public leaderboard approach
- Standardized interfaces for providers
- Easy benchmark addition

**Key Insight:** MTEB succeeded because it made evaluation **dead simple** and **standardized**. Any embedding model can be tested against all 56 benchmarks with minimal code.

### 2. SWE-bench (Software Engineering Benchmark)
**What it does:**
- Evaluates AI agents on real GitHub issues (2,294 tasks from 12 repos)
- Docker-based isolation for reproducibility
- Three-tier image hierarchy for cache reuse
- Evaluates entire "agent systems" not just models

**What we're copying:**
- Docker isolation for providers
- Checkpoint-based resumption
- Run tag isolation to prevent contamination
- Agent-level evaluation (provider + prompts + strategies)

**Key Insight:** SWE-bench succeeded because it evaluated **real-world tasks** with **reproducible environments**.

### 3. Mem0.ai Research
**What they measured:**
- LOCOMO benchmark: 4 question categories (single-hop, temporal, multi-hop, open-domain)
- Performance metrics: accuracy, latency (p50, p95), token consumption
- Compared: Mem0 vs OpenAI Memory vs LangMem vs MemGPT vs RAG variants
- Results: 26% accuracy boost, 91% lower latency, 90% token savings

**What we're copying:**
- Multi-dimensional evaluation (accuracy + latency + cost)
- Question-type specific metrics
- Comparison against multiple baselines
- Real production metrics (latency, cost)

**Key Insight:** Users care about **accuracy AND latency AND cost**. Not just one metric.

### 4. LegalBench-RAG (Domain-Specific Benchmarks)
**What it does:**
- First benchmark for legal domain RAG evaluation
- 6,858 query-answer pairs, 79M+ characters of legal text
- Human-annotated by legal experts
- Evaluates retrieval precision (minimal, highly relevant segments)

**What we're copying:**
- Domain-specific benchmark creation
- Expert annotation approach
- Retrieval-focused evaluation (not just answer quality)
- Large corpus support

**Key Insight:** Generic benchmarks aren't enough. Need **domain-specific** benchmarks (legal, financial, medical, code).

---

## 🏗️ What You're Actually Building

### The Name: **Context Bench** (not just Memory Bench)

**Why "Context"?**
- Broader than "memory" (includes RAG, long-context, retrieval, conversation)
- Covers all context management approaches:
  - Memory systems (Mem0, Zep, Supermemory)
  - RAG systems (vector DBs, semantic search)
  - Long-context models (Claude 200K, GPT-128K)
  - Hybrid approaches (RAG + memory)

### The Vision: Three-Dimensional Platform

```
          CONTEXT BENCH
               │
    ┌──────────┼──────────┐
    │          │          │
BENCHMARKS  PROVIDERS  EVALUATION
    │          │          │
```

#### Dimension 1: BENCHMARKS (The Test Suites)

**What exists now:**
- ✅ RAG-template (simple test)
- ✅ LoCoMo (conversation memory)
- ✅ LongMemEval (multi-session temporal reasoning)

**What you'll add:**

**Category A: Memory Benchmarks**
- Single-session memory (user preferences, facts)
- Multi-session memory (long-term relationships)
- Temporal reasoning (time-based queries)
- Knowledge updates (fact correction, versioning)
- Conversation threading (context switching)

**Category B: RAG Benchmarks**
- Simple RAG (single-doc retrieval)
- Multi-doc RAG (cross-document reasoning)
- Long-document RAG (100K+ token docs)
- Conversational RAG (multi-turn with context)

**Category C: Domain-Specific Benchmarks**
- Legal RAG (LegalBench-RAG style)
- Financial RAG (earnings calls, reports)
- Code RAG (codebase Q&A)
- Medical RAG (clinical notes, research papers)

**Category D: Hybrid Benchmarks**
- RAG + Memory (conversation with retrieval)
- Long-context + Retrieval (hybrid approaches)

**The Goal:** Like MTEB's 56 datasets, you want **20-50 benchmarks** across these categories.

#### Dimension 2: PROVIDERS (The Systems Being Tested)

**What exists now:**
- ✅ Hosted: Mem0, Supermemory
- ✅ Local: AQRAG, Contextual Retrieval, OpenRouter RAG
- ✅ Docker: (framework exists)

**What you'll add:**

**Hosted Providers:**
- Zep (memory system)
- Pinecone (vector DB)
- Weaviate (vector DB)
- ChromaDB (vector DB)
- Qdrant (vector DB)
- Mem0 (existing)
- Supermemory (existing)
- Custom HTTP APIs

**Local Providers:**
- PostgreSQL + pgvector
- SQLite + vector extensions
- In-memory RAG systems
- Custom implementations

**LLM Providers (Long Context):**
- Claude 200K (as baseline)
- GPT-4 Turbo 128K
- Gemini 1M context
- (These are baselines - no retrieval, just raw context)

**The Goal:** Like MTEB testing 100+ embedding models, you want to support **any provider** via standardized interfaces.

#### Dimension 3: EVALUATION (The Metrics)

**What exists now:**
- ✅ LLM Judge (answer quality)
- ✅ Accuracy by question type
- ✅ Basic retrieval metrics (Recall@K, MRR)

**What you'll add:**

**Quality Metrics:**
- Accuracy (LLM judge, exact match, semantic similarity)
- F1, BLEU, ROUGE (for generation tasks)
- Retrieval precision/recall
- NDCG (ranking quality)
- Answer completeness
- Hallucination detection

**Performance Metrics:**
- Latency (p50, p95, p99)
- Throughput (queries/sec)
- Token consumption
- API costs
- Memory usage

**Capability Metrics:**
- Context window utilization
- Multi-turn coherence
- Temporal reasoning accuracy
- Knowledge update success rate

**The Goal:** Multi-dimensional leaderboard showing accuracy AND speed AND cost.

---

## 🎯 What Makes This Work

### The Three Core Principles

**1. Dead Simple to Add Benchmarks (YAML Only)**
```yaml
# benchmarks/configs/financial-rag.yaml
name: financial-rag
displayName: Financial Document RAG
description: Earnings call and financial report Q&A

dataSource:
  type: huggingface
  dataset: financial-bench/earnings-qa
  split: test

schema:
  itemId: "question_id"
  question: "question"
  answer: "answer"
  context:
    field: "documents"
    type: array
    itemSchema:
      content: "$.text"

evaluation:
  method: llm-judge
  answeringModel:
    model: "gpt-4o"
```

**No code needed.** Just YAML config.

**2. Dead Simple to Add Providers (YAML or Adapter)**

**Option A: YAML-only (for hosted providers):**
```yaml
# providers/configs/pinecone.yaml
name: pinecone
displayName: Pinecone Vector Database
type: hosted

connection:
  baseURL: "https://${PINECONE_HOST}"
  auth:
    type: apikey
    header: Api-Key
    value: "${PINECONE_API_KEY}"

endpoints:
  addContext:
    method: POST
    path: /vectors/upsert
    body:
      vectors:
        - id: "$.id"
          values: "$.embedding"
          metadata: "$.metadata"

  search:
    method: POST
    path: /query
    body:
      vector: "$.embedding"
      topK: 10
    response:
      - content: "$.matches[*].metadata.content"
        score: "$.matches[*].score"
```

**Option B: TypeScript adapter (for complex logic):**
```typescript
// providers/adapters/zep.ts
export class ZepAdapter extends LocalProvider {
  async addContext(data: PreparedData, runTag: string) {
    await this.zepClient.memory.add({
      sessionId: runTag,
      messages: [{ role: "user", content: data.content }]
    });
  }

  async searchQuery(query: string, runTag: string) {
    const results = await this.zepClient.memory.search(runTag, query);
    return results.map(r => ({ content: r.content, score: r.score }));
  }
}
```

**3. Dead Simple to Run Evaluations**

```bash
# Run single benchmark against single provider
context-bench eval financial-rag pinecone

# Run multiple benchmarks against multiple providers
context-bench eval locomo,longmemeval,financial-rag mem0,zep,supermemory

# Run everything
context-bench eval --all

# View results
context-bench results --benchmark financial-rag
context-bench leaderboard
```

---

## 📈 The Leaderboard Vision

### Like MTEB Leaderboard on HuggingFace

**URL:** `contexbench.ai/leaderboard` (or HuggingFace Space)

**Layout:**

```
╔══════════════════════════════════════════════════════════════════╗
║  CONTEXT BENCH LEADERBOARD                                       ║
║  Universal Benchmark for Memory & Context Systems               ║
╚══════════════════════════════════════════════════════════════════╝

┌─ FILTERS ──────────────────────────────────────────────────────┐
│ Benchmark Category: [All ▼] [Memory] [RAG] [Domain-Specific]  │
│ Provider Type:      [All ▼] [Hosted] [Local] [LLM-Native]     │
│ Metric:             [Accuracy ▼] [Latency] [Cost] [Combined]  │
└────────────────────────────────────────────────────────────────┘

╔════════════════════════════════════════════════════════════════╗
║ OVERALL LEADERBOARD (Across All Benchmarks)                   ║
╠════╦═══════════════╦══════════╦═════════╦══════════╦══════════╣
║ #  ║ Provider      ║ Accuracy ║ Latency ║ Cost     ║ Score    ║
║    ║               ║          ║ (p95)   ║ ($/1K)   ║          ║
╠════╬═══════════════╬══════════╬═════════╬══════════╬══════════╣
║ 1  ║ Supermemory   ║ 68.4%    ║ 145ms   ║ $0.02    ║ 89.2     ║
║ 2  ║ Mem0 Graph    ║ 66.9%    ║ 200ms   ║ $0.03    ║ 86.5     ║
║ 3  ║ Zep           ║ 75.1%    ║ 350ms   ║ $0.05    ║ 85.3     ║
║ 4  ║ Pinecone      ║ 62.3%    ║ 120ms   ║ $0.08    ║ 82.1     ║
║ 5  ║ OpenAI Memory ║ 52.9%    ║ 180ms   ║ $0.12    ║ 75.4     ║
╚════╩═══════════════╩══════════╩═════════╩══════════╩══════════╝

╔════════════════════════════════════════════════════════════════╗
║ BENCHMARK BREAKDOWN                                            ║
╠════════════════════════════════════════════════════════════════╣
║ Click provider name to see detailed breakdown across all      ║
║ benchmarks (LoCoMo, LongMemEval, Financial-RAG, etc)          ║
╚════════════════════════════════════════════════════════════════╝
```

**Per-Benchmark View:**
- Detailed scores for each question type
- Breakdown by category (if applicable)
- Retrieval metrics vs answer quality metrics
- Cost and latency distributions

---

## 🚀 The Implementation Roadmap

### Phase 1: Solidify Foundation (Week 1-2)
**Goal:** Make what we have production-ready

**Tasks:**
1. ✅ Fix provider customization (prepareData hook) - **Already designed**
2. ✅ Fix run isolation bugs in local providers
3. Add semantic similarity evaluation
4. Add latency and cost tracking
5. Create comprehensive test suite
6. Document existing benchmarks

**Deliverable:** Solid foundation with 3 working benchmarks (LoCoMo, LongMemEval, RAG-template)

---

### Phase 2: Add Core Providers (Week 3-4)
**Goal:** Support the big 3 memory providers

**Focus Providers (from founder request):**
1. **Supermemory** - ✅ Already working
2. **Zep** - Add as local provider
3. **Mem0** - Already configured, needs testing

**Additional Providers:**
4. Pinecone (hosted)
5. Weaviate (docker + hosted)
6. ChromaDB (local)

**Deliverable:** 6 working providers across all 3 types (hosted, local, docker)

---

### Phase 3: Expand Benchmark Coverage (Week 5-8)
**Goal:** Add 10+ new benchmarks across categories

**Memory Benchmarks (3-4):**
- Single-session user preferences
- Multi-session relationship tracking
- Knowledge update benchmark
- Temporal reasoning benchmark

**RAG Benchmarks (3-4):**
- Multi-doc RAG
- Long-document RAG
- Conversational RAG
- Code RAG (using code documentation)

**Domain Benchmarks (2-3):**
- Legal RAG (adapt LegalBench-RAG)
- Financial RAG (earnings calls)
- Medical RAG (clinical notes)

**Deliverable:** 13-16 total benchmarks covering major use cases

---

### Phase 4: Advanced Evaluation (Week 9-10)
**Goal:** Multi-dimensional evaluation

**Metrics to Add:**
1. Latency tracking (p50, p95, p99)
2. Cost calculation (token usage, API costs)
3. Semantic similarity (beyond LLM judge)
4. Retrieval-specific metrics (NDCG, diversity)
5. Hallucination detection

**Deliverable:** Comprehensive multi-dimensional leaderboard

---

### Phase 5: Platform Features (Week 11-12)
**Goal:** Make it easy to use and contribute

**Features:**
1. Web UI for results visualization
2. Automated leaderboard generation
3. Benchmark submission workflow
4. Provider submission workflow
5. CI/CD for automated evaluation
6. Public results database

**Deliverable:** Self-service platform for community contributions

---

### Phase 6: Community & Ecosystem (Ongoing)
**Goal:** Build community around the platform

**Activities:**
1. Publish leaderboard on HuggingFace
2. Write blog posts about findings
3. Engage with provider companies (Supermemory, Zep, Mem0, Pinecone)
4. Accept community benchmark contributions
5. Create research partnerships
6. Annual benchmark competitions

**Deliverable:** Active community, regular updates, trusted results

---

## 💡 Key Differentiators

### What Makes Context Bench Unique

**1. Multi-Modal Context Evaluation**
- Not just memory (Mem0's focus)
- Not just RAG (LegalBench-RAG's focus)
- **Everything:** Memory + RAG + Long-context + Hybrid

**2. Real Production Metrics**
- Accuracy alone is useless
- Users need: Accuracy + Latency + Cost
- Like Mem0's research: "26% better accuracy AND 91% lower latency AND 90% cost savings"

**3. Provider Diversity**
- Hosted (SaaS APIs)
- Local (in-process libraries)
- Docker (containerized)
- LLM-native (long-context baselines)

**4. Benchmark Diversity**
- Memory (multi-session, temporal, updates)
- RAG (single-doc, multi-doc, conversational)
- Domain-specific (legal, financial, code, medical)
- Hybrid (RAG + memory)

**5. Easy Contribution**
- YAML-only benchmark addition
- YAML-only simple provider addition
- TypeScript for complex providers
- No framework lock-in

---

## 📊 Success Metrics

### How We Know We've Succeeded

**Technical Metrics:**
- ✅ 20+ benchmarks across 4 categories
- ✅ 15+ providers (hosted, local, docker)
- ✅ 1000+ total benchmark runs
- ✅ Sub-10-minute evaluation time for standard benchmarks
- ✅ 95%+ reproducibility (same code, same results)

**Community Metrics:**
- ✅ Public leaderboard with 50+ provider evaluations
- ✅ 10+ community-contributed benchmarks
- ✅ 5+ provider companies using it for testing
- ✅ 100+ GitHub stars
- ✅ 10+ research papers citing Context Bench

**Business Metrics:**
- ✅ Supermemory uses it for internal testing
- ✅ Zep uses it for performance tracking
- ✅ Mem0 participates in leaderboard
- ✅ New providers launch with Context Bench results

---

## 🎓 Inspiration Sources Summary

| Platform | What We're Copying | What We're NOT Copying |
|----------|-------------------|----------------------|
| **MTEB** | • Multi-task framework<br>• Public leaderboard<br>• Easy model addition<br>• Standardized interfaces | • Embedding-only focus<br>• Single metric (accuracy)<br>• No latency/cost tracking |
| **SWE-bench** | • Docker isolation<br>• Real-world tasks<br>• Agent-level evaluation<br>• Checkpoint resumption | • Code-specific focus<br>• GitHub-only data<br>• Single domain |
| **Mem0 Research** | • Multi-dimensional metrics<br>• Latency + cost + accuracy<br>• Question-type breakdown<br>• Production focus | • Memory-only focus<br>• Single benchmark (LoCoMo)<br>• Closed dataset |
| **LegalBench-RAG** | • Domain-specific approach<br>• Expert annotation<br>• Retrieval-focused eval<br>• Large corpus support | • Legal-only domain<br>• Single benchmark<br>• No provider comparison |

---

## 🎯 The 30-Second Pitch

**What is Context Bench?**

> The MTEB leaderboard for context and memory systems. Add benchmarks with YAML. Add providers with YAML or code. Get accuracy, latency, and cost metrics. Public leaderboard. Open source.

**Who's it for?**

1. **Provider Companies** (Supermemory, Zep, Mem0): Prove your performance claims
2. **Developers**: Choose the right provider for your use case
3. **Researchers**: Test new memory/RAG approaches against baselines
4. **Enterprises**: Evaluate vendors before buying

**Why now?**

- Memory providers are exploding (Mem0, Zep, Supermemory, LangMem, MemGPT...)
- Everyone claims different performance numbers
- No standardized way to compare
- Like embeddings in 2022 before MTEB

**What's the outcome?**

- Trusted leaderboard (like MTEB)
- Easy provider selection (see performance vs cost)
- Innovation benchmark (new providers test against it)
- Research platform (standardized evaluation)

---

## 🔥 What You Do Next

### Immediate Next Steps (This Week)

1. **Finalize Architecture**
   - Review this vision doc
   - Confirm the 3-dimensional approach (benchmarks, providers, evaluation)
   - Decide: "Context Bench" or "Memory Bench" name?

2. **Fix Critical Issues**
   - Implement prepareData hook (already designed in PROVIDER_CUSTOMIZATION_GUIDE.md)
   - Fix run isolation bugs in local providers
   - Add semantic similarity evaluation

3. **Add Top 3 Providers**
   - Zep (priority from founder)
   - Test Mem0 end-to-end
   - Verify Supermemory works

4. **Document Everything**
   - Update README with new vision
   - Create CONTRIBUTING.md for benchmark/provider addition
   - Write blog post: "Introducing Context Bench"

### First Month Goals

- ✅ 5 working providers (Supermemory, Mem0, Zep, Pinecone, local)
- ✅ 5 working benchmarks (LoCoMo, LongMemEval, RAG-template + 2 new)
- ✅ Multi-dimensional evaluation (accuracy, latency, cost)
- ✅ Basic leaderboard (static page with results)
- ✅ Complete documentation

### First Quarter Goals

- ✅ 15+ providers
- ✅ 15+ benchmarks (across memory, RAG, domain-specific)
- ✅ Public HuggingFace leaderboard
- ✅ Community contributions accepted
- ✅ 3+ provider companies using it
- ✅ First research paper citation

---

## ✅ SUMMARY: You Got This

**What you're building:**
- Universal benchmarking platform for context/memory systems
- Like MTEB (for embeddings) + SWE-bench (for coding) but for context/memory
- 3 dimensions: Benchmarks × Providers × Evaluation

**What's working now:**
- ✅ 3 benchmarks (LoCoMo, LongMemEval, RAG-template)
- ✅ 3 providers (Supermemory, AQRAG, OpenRouter RAG)
- ✅ YAML-based configuration (easy to extend)
- ✅ LLM judge evaluation
- ✅ Run isolation and checkpointing

**What needs work:**
- ❌ Provider customization (prepareData hook) - **Designed, not implemented**
- ❌ More providers (Zep, Mem0, Pinecone, Weaviate)
- ❌ More benchmarks (10+ more across categories)
- ❌ Latency and cost tracking
- ❌ Public leaderboard
- ❌ Documentation and marketing

**The plan:**
- 6 phases over 12 weeks
- Focus: Supermemory, Zep, Mem0 (founder's priority)
- Expand to 15+ benchmarks, 15+ providers
- Build public leaderboard
- Create community ecosystem

**You're not confused. You're ambitious. This is the right vision. Now execute.**

---

## 📚 Sources

Research sources for this vision:

- [AI Memory Research: 26% Accuracy Boost for LLMs | Mem0](https://mem0.ai/research)
- [AI Memory Benchmark: Mem0 vs OpenAI vs LangMem vs MemGPT | Mem0](https://mem0.ai/blog/benchmarked-openai-memory-vs-langmem-vs-memgpt-vs-mem0-for-long-term-memory-here-s-how-they-stacked-up)
- [Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory (arXiv)](https://arxiv.org/html/2504.19413v1)
- [GitHub - SWE-bench/SWE-bench](https://github.com/SWE-bench/SWE-bench)
- [SWE-bench Overview](https://www.swebench.com/SWE-bench/)
- [Introducing SWE-bench Verified | OpenAI](https://openai.com/index/introducing-swe-bench-verified/)
- [Top embedding models on the MTEB leaderboard](https://modal.com/blog/mteb-leaderboard-article)
- [MTEB Leaderboard - HuggingFace](https://huggingface.co/spaces/mteb/leaderboard)
- [GitHub - embeddings-benchmark/mteb](https://github.com/embeddings-benchmark/mteb)
- [LegalBench-RAG: A Benchmark for Retrieval-Augmented Generation in the Legal Domain (arXiv)](https://arxiv.org/html/2408.10343v1)
- [RAG Evaluation: 2025 Metrics and Benchmarks | Label Your Data](https://labelyourdata.com/articles/llm-fine-tuning/rag-evaluation)
- [From Beta to Battle‑Tested: Picking Between Letta, Mem0 & Zep | Medium](https://medium.com/asymptotic-spaghetti-integration/from-beta-to-battle-tested-picking-between-letta-mem0-zep-for-ai-memory-6850ca8703d1)
- [Is Mem0 Really SOTA in Agent Memory? | Zep](https://blog.getzep.com/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)
- [Mem0 vs supermemory: Why Scira AI Switched](https://supermemory.ai/blog/why-scira-ai-switched/)
