# Superbench Developer Guide

**Complete guide to extending Superbench with custom benchmarks, datasets, providers, and metrics.**

This guide is for developers who want to:
- Add new code chunking strategies
- Create custom benchmarks
- Integrate new RAG systems or LLM providers
- Define custom evaluation metrics
- Understand the architecture and extension points

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Adding a New Chunker](#adding-a-new-chunker)
3. [Adding a New Metric](#adding-a-new-metric)
4. [Adding a New Benchmark](#adding-a-new-benchmark)
5. [Creating Benchmark Packs](#creating-benchmark-packs)
6. [Adding a New Dataset](#adding-a-new-dataset)
7. [Adding a New Provider (LLM/RAG)](#adding-a-new-provider-llmrag)
8. [Creating Custom Evaluators](#creating-custom-evaluators)
9. [Testing Your Extensions](#testing-your-extensions)
10. [Advanced Topics](#advanced-topics)
11. [API Reference](#api-reference)
12. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### Core Pipeline

```
┌─────────────┐
│  CLI Entry  │  superbench eval --benchmarks repoeval --providers my-chunker
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  BenchmarkRunner│  Loads config, orchestrates evaluation
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Data Loader    │  Loads benchmark items from datasets
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Provider       │  Chunks code + embeds + searches
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Evaluator      │  Determines correctness (pack-specific)
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Metrics        │  Computes aggregate metrics (recall, nDCG, etc.)
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Results Store  │  SQLite database with results
└─────────────────┘
```

### Key Components

| Component | Purpose | Extension Point |
|-----------|---------|-----------------|
| **ChunkerRegistry** | Manages chunking strategies | `registerChunker()` |
| **MetricRegistry** | Manages evaluation metrics | `register()` in `core/metrics/` |
| **LoaderRegistry** | Manages benchmark data loaders | `registerLoader()` |
| **PackRegistry** | Manages benchmark-specific evaluation logic | Create new `BenchmarkPack` |
| **ProviderRegistry** | Manages RAG/embedding providers | Implement `Provider` interface |
| **EvaluatorRegistry** | Manages custom evaluators | `registerEvaluator()` |

### Data Flow

1. **Initialization**: CLI parses config → Registry loads components
2. **Data Loading**: Loader fetches benchmark items → Prepares contexts
3. **Retrieval**: Provider chunks contexts → Embeds → Searches for query
4. **Evaluation**: Pack evaluates if retrieved chunks are relevant/correct
5. **Metrics**: Computes aggregate scores across all items
6. **Storage**: Writes results to SQLite for analysis

---

## Adding a New Chunker

### Quick Example (5 minutes)

Chunkers split source code into retrievable chunks. Here's how to add one:

**1. Register in `providers/adapters/chunker-registry.ts`:**

```typescript
registerChunker({
  name: "my-chunker",
  aliases: ["mc", "my-custom-chunker"], // Optional

  // Optional: Verify dependencies before running
  preflight: async () => {
    // Check if required packages are installed
    try {
      await import("my-chunker-package");
    } catch {
      throw new Error("Install my-chunker-package: npm install my-chunker-package");
    }
  },

  // Required: The chunking function
  chunkFn: async (content, filepath, config) => {
    const { size = 1500, overlap = 100 } = config;

    // Your chunking logic here
    const chunks = myChunkingAlgorithm(content, { size, overlap });

    // Return array of chunks with line info
    return chunks.map((chunk, i) => ({
      content: chunk.text,
      startLine: chunk.lineStart, // 1-indexed
      endLine: chunk.lineEnd,     // 1-indexed, inclusive
      id: `${filepath}:${i}`,
    }));
  },
});
```

**2. Register provider in `providers/factory.ts`:**

```typescript
// Auto-populated from ChunkerRegistry now, but verify it's included:
import { getChunkerNames } from "./adapters/chunker-registry.ts";

// This loop auto-registers all chunkers
for (const chunkerName of getChunkerNames()) {
  providerByNameRegistry.set(chunkerName, GenericChunkerProvider);
}
```

**3. Test it:**

```bash
superbench eval \
  --benchmarks repoeval \
  --providers my-chunker \
  --limit 5
```

### ChunkResult Interface

```typescript
interface ChunkResult {
  content: string;      // Chunk text
  startLine?: number;   // 1-indexed start line
  endLine?: number;     // 1-indexed end line (inclusive)
  id?: string;          // Optional custom ID
}
```

### Important Notes

- **Line numbers are 1-indexed** (like in editors)
- `endLine` is **inclusive**: `startLine=1, endLine=10` means lines 1-10
- **Preserve line information**: Required for relevance matching in most benchmarks
- **Handle empty files**: Return empty array for zero-length content
- **Fallback gracefully**: If parsing fails, use fixed chunking as fallback

### Real-World Example: AST-based Chunker

See `providers/adapters/chunker-registry.ts` lines 92-119 for the `code-chunk-ast` implementation.

---

## Adding a New Metric

### Quick Example (10 minutes)

Metrics compute aggregate scores from evaluation results.

**1. Create metric class in `core/metrics/builtin/`:**

```typescript
// core/metrics/builtin/my-metric.ts
import type { MetricCalculator, MetricResult } from "../interface.ts";
import type { EvalResult } from "../../config.ts";

export class MyMetric implements MetricCalculator {
  readonly name = "my_metric";
  readonly aliases = ["my-metric", "mm"] as const;

  compute(results: EvalResult[]): MetricResult {
    // Your metric logic here
    const correct = results.filter(r => r.correct).length;
    const total = results.length;
    const value = total > 0 ? correct / total : 0;

    return {
      name: this.name,
      value,
    };
  }
}
```

**2. Register in `core/metrics/builtin/index.ts`:**

```typescript
import { MyMetric } from "./my-metric.ts";

export function getBuiltinMetrics(): MetricCalculator[] {
  return [
    // ... existing metrics ...
    new MyMetric(),
  ];
}
```

**3. Test it:**

```bash
superbench eval \
  --benchmarks repoeval \
  --providers code-chunk-ast \
  --metrics my-metric,accuracy \
  --limit 10
```

### MetricCalculator Interface

```typescript
interface MetricCalculator {
  name: string;                          // Primary name (snake_case)
  aliases?: readonly string[];           // Alternative names
  compute(results: EvalResult[]): MetricResult;
}

interface EvalResult {
  id: string;
  query: string;
  correct: boolean;     // Did we retrieve relevant chunks?
  score: number;        // Relevance score (0-1)
  metadata?: Record<string, unknown>;
}

interface MetricResult {
  name: string;
  value: number;
}
```

### Built-in Metrics as Examples

- **Accuracy**: `core/metrics/builtin/accuracy.ts`
- **Recall@K**: `core/metrics/builtin/recall.ts`
- **Precision@K**: `core/metrics/builtin/precision.ts`
- **nDCG@K**: `core/metrics/builtin/ndcg.ts`
- **MRR**: `core/metrics/builtin/mrr.ts`

### Ranking Metrics

For metrics that care about **order** (nDCG, MRR), you need relevance labels:

```typescript
compute(results: EvalResult[]): MetricResult {
  let dcg = 0;

  for (const result of results) {
    // Access retrieved chunks from metadata
    const retrievedChunks = result.metadata?.retrievedChunks as any[];
    const relevantIds = result.metadata?.relevantIds as string[];

    // Compute DCG based on rank
    retrievedChunks.forEach((chunk, rank) => {
      const isRelevant = relevantIds.includes(chunk.id);
      const gain = isRelevant ? 1 : 0;
      dcg += gain / Math.log2(rank + 2);
    });
  }

  return { name: this.name, value: dcg / results.length };
}
```

---

## Adding a New Benchmark

### Quick Example (30 minutes)

Benchmarks define how to evaluate retrieval quality for a specific task.

**1. Create benchmark pack in `benchmarks/packs/`:**

```typescript
// benchmarks/packs/my-benchmark.ts
import type { BenchmarkPack, RunConfig } from "./interface.ts";
import type { BenchmarkItem, SearchResult } from "../../core/config.ts";

export const myBenchmarkPack: BenchmarkPack = {
  benchmarkName: "my-benchmark",
  packId: "v1@2025-01",

  // Define what the pack controls
  sealedSemantics: {
    relevance: true,   // Pack defines what's relevant
    evaluation: true,  // Pack defines correctness
  },

  // Build prompt for LLM evaluation (if using llm-judge)
  buildAnswerPrompt: (item: BenchmarkItem): string => {
    return `Answer the question based on the retrieved code:\n\nQuestion: ${item.query}`;
  },

  // Determine if retrieved chunks are relevant
  isRelevant: (
    item: BenchmarkItem,
    chunk: SearchResult,
    config: RunConfig
  ): boolean => {
    // Your relevance logic here
    const groundTruth = item.metadata?.groundTruthIds as string[];
    return groundTruth.includes(chunk.id);
  },

  // Evaluate correctness
  evaluate: async (
    item: BenchmarkItem,
    searchResults: SearchResult[]
  ): Promise<{ correct: boolean; score: number }> => {
    // Your evaluation logic
    const relevantRetrieved = searchResults.filter(result =>
      this.isRelevant(item, result, {})
    );

    const correct = relevantRetrieved.length > 0;
    const score = relevantRetrieved.length / searchResults.length;

    return { correct, score };
  },
};
```

**2. Register in `benchmarks/packs/index.ts`:**

```typescript
import { myBenchmarkPack } from "./my-benchmark.ts";

const BUILTIN_PACKS: readonly BenchmarkPack[] = [
  // ... existing packs ...
  myBenchmarkPack,
] as const;
```

**3. Create data loader in `benchmarks/loaders/builtin-loaders.ts`:**

```typescript
registerLoader({
  name: "my-benchmark",
  aliases: ["my-bench", "mb"],
  description: "My custom benchmark",

  // Load benchmark data
  loadFn: async (config, options) => {
    const data = await loadMyBenchmarkData(config.dataPath);

    return data.map(item => ({
      id: item.id,
      query: item.question,
      contexts: item.codeFiles.map(file => ({
        id: file.path,
        content: file.code,
        metadata: { filepath: file.path },
      })),
      metadata: {
        groundTruthIds: item.relevantFiles,
        ...item.extraMeta,
      },
    }));
  },
});
```

**4. Create YAML config in `benchmarks/configs/`:**

```yaml
# benchmarks/configs/my-benchmark.yaml
name: my-benchmark
description: "My custom code retrieval benchmark"
dataPath: "./benchmarks/data/my-benchmark"

evaluation:
  method: exact-match  # or llm-judge
  k: 5

metrics:
  - recall@5
  - precision@5
  - ndcg@10
```

**5. Test it:**

```bash
# Download/prepare data
superbench download --benchmark my-benchmark

# Run evaluation
superbench eval \
  --benchmarks my-benchmark \
  --providers code-chunk-ast \
  --limit 10
```

### BenchmarkPack Interface

```typescript
interface BenchmarkPack {
  benchmarkName: string;
  packId: string;  // Version identifier with @ (e.g., "v1@2025-01")

  sealedSemantics: {
    relevance?: boolean;   // Pack controls relevance matching
    evaluation?: boolean;  // Pack controls evaluation logic
  };

  buildAnswerPrompt: (item: BenchmarkItem) => string;

  isRelevant: (
    item: BenchmarkItem,
    chunk: SearchResult,
    config: RunConfig
  ) => boolean;

  evaluate: (
    item: BenchmarkItem,
    searchResults: SearchResult[]
  ) => Promise<{ correct: boolean; score: number }>;
}
```

### Relevance Matching Strategies

Different benchmarks use different strategies:

| Benchmark | Strategy | Implementation |
|-----------|----------|----------------|
| RepoEval | Line-range overlap | `lineRangeOverlaps()` in `benchmarks/packs/relevance.ts` |
| RepoBench-R | Jaccard ≥ 0.7 | `jaccardSimilarity()` |
| SWE-bench Lite | File matching | `fileMatches()` |
| CrossCodeEval | Dependency coverage | `crossFileCoverage()` |

See `benchmarks/packs/generic-code-retrieval-pack.ts` for real-world examples.

---

## Creating Benchmark Packs

### What Are Packs?

**Benchmark Packs** are versioned, paper-faithful implementations of benchmark evaluation logic. They encode the exact prompts, scoring methods, and relevance definitions from research papers, ensuring reproducibility and preventing evaluation drift.

**Key Benefits:**
- ✅ **Paper-faithful**: Exact prompts from research papers
- ✅ **Versioned**: Each pack has a unique ID (e.g., `longmemeval@paper-v1`)
- ✅ **Sealed semantics**: Cannot be overridden by YAML configs
- ✅ **Reproducible**: SHA-256 hashes detect prompt drift
- ✅ **Transparent**: All evaluation logic in code, not hidden in configs

### When to Create a Pack

**Create a pack when:**
- You want paper-faithful evaluation (matches original research)
- You need to prevent evaluation drift
- You have multiple question types with different evaluation logic
- You want versioned, reproducible results

**Skip a pack when:**
- Quick experiments or prototyping
- Simple benchmarks that don't need paper-faithful implementation
- You want maximum flexibility in YAML configs

### Quick Example (1-2 hours)

**1. Create pack file in `benchmarks/packs/`:**

```typescript
// benchmarks/packs/my-memory-pack.ts
import type { BenchmarkPack, PromptArtifact, PackEvaluationResult, RunConfig } from "./interface.ts";
import type { BenchmarkItem, SearchResult } from "../../core/config.ts";
import { createPromptArtifact } from "./utils.ts";
import { getModelProvider } from "../../core/llm/index.ts";
import { generateText } from "ai";

export const myMemoryPack: BenchmarkPack = {
  benchmarkName: "my-memory",
  packId: "my-memory@v1",
  
  sealedSemantics: {
    prompts: true,    // Pack owns answer + judge prompts
    scoring: true,    // Pack owns evaluation logic
    relevance: true,  // Pack owns relevance definitions
  },
  
  // Build answer prompt (paper-faithful)
  buildAnswerPrompt({ item, retrieved, run }): PromptArtifact {
    const context = retrieved.map(r => r.content).join("\n\n");
    const prompt = `Context:\n${context}\n\nQuestion: ${item.question}\nAnswer:`;
    return createPromptArtifact(prompt);
  },
  
  // Build judge prompt (optional, for LLM judge)
  buildJudgePrompt({ item, answer, run }): PromptArtifact | undefined {
    const prompt = `Question: ${item.question}\nExpected: ${item.answer}\nActual: ${answer}\n\nIs correct? Answer yes or no.`;
    return createPromptArtifact(prompt);
  },
  
  // Full evaluation pipeline
  async evaluate({ item, retrieved, run }): Promise<PackEvaluationResult> {
    // 1. Generate answer
    const answerPrompt = this.buildAnswerPrompt({ item, retrieved, run });
    const model = getModelProvider(run.answeringModel || "gpt-4");
    const { text: answer } = await generateText({ 
      model, 
      prompt: answerPrompt.text,
      temperature: 0,
    });
    
    // 2. Judge answer (if using LLM judge)
    const judgePrompt = this.buildJudgePrompt?.({ item, answer: answer.trim(), run });
    if (!judgePrompt) {
      // Direct scoring (no judge)
      return {
        answer: answer.trim(),
        score: 0.5, // Your scoring logic
        correct: false,
      };
    }
    
    const judgeModel = getModelProvider(run.judgeModel || "gpt-4");
    const { text: judgeResponse } = await generateText({ 
      model: judgeModel, 
      prompt: judgePrompt.text,
      temperature: 0,
    });
    
    const correct = judgeResponse.toLowerCase().trim().startsWith("yes");
    
    return {
      answer: answer.trim(),
      score: correct ? 1 : 0,
      correct,
      judgeResponse: judgeResponse.trim(),
    };
  },
  
  // Determine relevance for retrieval metrics
  isRelevant({ item, result }): boolean {
    // Check if result ID matches ground truth
    const groundTruthIds = item.metadata?.groundTruthIds as string[] | undefined;
    if (groundTruthIds) {
      return groundTruthIds.includes(result.id);
    }
    
    // Fallback: content-based matching
    if (item.answer && result.content) {
      const answerWords = item.answer.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const content = result.content.toLowerCase();
      return answerWords.some(word => content.includes(word));
    }
    
    return false;
  },
};
```

**2. Register in `benchmarks/packs/index.ts`:**

```typescript
import { myMemoryPack } from "./my-memory-pack.ts";

const BUILTIN_PACKS: readonly BenchmarkPack[] = [
  // ... existing packs ...
  myMemoryPack,  // Add here
] as const;
```

**3. Create YAML config (pack will be auto-detected):**

```yaml
# benchmarks/configs/my-memory.yaml
name: my-memory
displayName: "My Memory Benchmark"
description: "Custom memory evaluation"

data:
  type: local
  path: "./benchmarks/data/my-memory.json"
  format: json

# Pack will handle prompts, scoring, and relevance
# You can still configure:
evaluation:
  answeringModel:
    model: "openrouter/openai/gpt-5-nano"
    temperature: 0
  judge:
    model: "openrouter/openai/gpt-5-nano"
    temperature: 0

metrics:
  - accuracy
  - f1
  - recall_at_5
```

**4. Test it:**

```bash
superbench eval --benchmarks my-memory --providers mem0 --limit 5
```

### BenchmarkPack Interface

```typescript
interface BenchmarkPack {
  benchmarkName: string;           // Must match YAML config name
  packId: PackId;                  // Versioned ID: "benchmark@version"
  
  sealedSemantics: {
    prompts: boolean;               // Pack owns answer/judge prompts
    scoring: boolean;               // Pack owns evaluation logic
    relevance: boolean;             // Pack owns relevance definitions
  };
  
  // Build answer prompt (paper-faithful)
  buildAnswerPrompt(input: {
    item: BenchmarkItem;
    retrieved: SearchResult[];
    run: RunConfig;
  }): PromptArtifact;
  
  // Build judge prompt (optional, for LLM judge)
  buildJudgePrompt?(input: {
    item: BenchmarkItem;
    answer: string;
    run: RunConfig;
  }): PromptArtifact | undefined;
  
  // Full evaluation pipeline
  evaluate(input: {
    item: BenchmarkItem;
    retrieved: SearchResult[];
    run: RunConfig;
  }): Promise<PackEvaluationResult>;
  
  // Determine relevance for retrieval metrics
  isRelevant(input: {
    item: BenchmarkItem;
    result: SearchResult;
  }): boolean;
}
```

### Complexity Levels

**Simple (15-30 min)**: Code retrieval benchmarks using factory
```typescript
import { createCodeRetrievalPack } from "./generic-code-retrieval-pack.ts";
export const myPack = createCodeRetrievalPack("my-dataset");
```

**Medium (1-2 hours)**: Memory benchmarks with LLM judge
- Implement 4 methods: `buildAnswerPrompt`, `buildJudgePrompt`, `evaluate`, `isRelevant`
- ~50-100 lines of code

**Complex (2-4 hours)**: Paper-faithful with multiple question types
- Multiple question types with different prompts
- Exact paper formatting
- Complex relevance logic with fallbacks
- Example: `longmemeval.ts` (~316 lines)

### Key Concepts

**1. Sealed Semantics**
When a pack exists, certain YAML fields are sealed (cannot be overridden):
- ❌ `evaluation.answerPrompt` - Pack owns answer prompts
- ❌ `evaluation.judgePrompts` - Pack owns judge prompts
- ❌ `evaluation.method` - Pack owns scoring method
- ✅ `evaluation.answeringModel` - Still configurable
- ✅ `evaluation.judge.model` - Still configurable

**2. Prompt Artifacts**
Always use `createPromptArtifact()` to get SHA-256 hashes:
```typescript
const prompt = "Your prompt text...";
return createPromptArtifact(prompt);
// Returns: { text: "...", sha256: "a3f5b2c1..." }
```

**3. Versioning**
Packs use versioned IDs: `benchmark-name@version`
- `longmemeval@paper-v1` - Original paper implementation
- `longmemeval@paper-v2` - Updated version (if paper revised)

**4. Relevance Logic**
Packs define what counts as "relevant" for retrieval metrics:
- Uses dataset-native labels (corpus IDs, evidence IDs)
- Enables accurate recall@K, success@K calculations
- Can have fallback strategies for robustness

### Real-World Examples

**Simple**: Code retrieval (factory-based)
- See `generic-code-retrieval-pack.ts` - 4 benchmarks in ~100 lines

**Medium**: Memory benchmark
- See `locomo.ts` (~230 lines) - Category-based evaluation

**Complex**: Paper-faithful with multiple types
- See `longmemeval.ts` (~316 lines) - 6 question types, paper-faithful prompts

### Common Patterns

**Question-type-specific prompts:**
```typescript
buildJudgePrompt({ item, answer, run }): PromptArtifact | undefined {
  const questionType = item.metadata?.questionType as string;
  
  if (questionType === "temporal-reasoning") {
    // Allow off-by-one errors for dates
    return createPromptArtifact(`...`);
  } else if (questionType === "knowledge-update") {
    // Accept updated answers
    return createPromptArtifact(`...`);
  }
  
  // Default prompt
  return createPromptArtifact(`...`);
}
```

**Multiple fallback relevance strategies:**
```typescript
isRelevant({ item, result }): boolean {
  // Tier 1: Explicit IDs
  if (item.metadata?.groundTruthIds?.includes(result.id)) return true;
  
  // Tier 2: Content-based matching
  if (item.answer && result.content.includes(item.answer)) return true;
  
  // Tier 3: Keyword matching
  const keywords = extractKeywords(item.question);
  return keywords.some(k => result.content.includes(k));
}
```

### Testing Your Pack

```bash
# Quick test
superbench eval --benchmarks my-memory --providers mem0 --limit 2

# View results with breakdown
superbench results <run-id> --breakdown --metrics accuracy f1

# Check prompt hashes (for drift detection)
# Hashes are automatically computed and stored
```

### Troubleshooting

**"Sealed semantics violation"**
- Remove `evaluation.answerPrompt` or `evaluation.judgePrompts` from YAML
- The pack owns these fields

**"Pack not found"**
- Ensure pack is registered in `benchmarks/packs/index.ts`
- Check `benchmarkName` matches YAML config name

**"Judge prompt required"**
- Implement `buildJudgePrompt` or return `undefined` if not using LLM judge
- If using LLM judge, `buildJudgePrompt` must return a prompt

For more details, see `docs/PACKS_EXPLANATION.md` and `docs/CREATING_PACKS.md`.

---

## Adding a New Dataset

### Quick Example (20 minutes)

Datasets provide the actual benchmark data (questions, code, ground truth).

**1. Create dataset definition in `benchmarks/loaders/download/dataset-registry.ts`:**

```typescript
function createMyDataset(): DatasetDefinition {
  return {
    name: "my-dataset",

    files: [
      {
        url: "https://example.com/my-data.zip",
        extractTo: "benchmarks/data/my-dataset",
        checksum: "sha256:abc123...",
      },
    ],

    postProcess: async (extractPath) => {
      // Optional: Transform data after download
      const rawData = await Bun.file(`${extractPath}/raw.json`).json();
      const processed = transformData(rawData);
      await Bun.write(
        `${extractPath}/processed.json`,
        JSON.stringify(processed)
      );
    },
  };
}

// Register it
class DatasetRegistry extends BaseRegistry<DatasetDefinition> {
  constructor() {
    super({ name: "DatasetRegistry", throwOnConflict: true });
    // ... existing registrations ...
    this.register('my-dataset', createMyDataset());
  }
}
```

**2. Create loader in `benchmarks/loaders/`:**

```typescript
// benchmarks/loaders/my-dataset-loader.ts
export async function loadMyDatasetData(
  config: BenchmarkConfig,
  options?: LoaderOptions
): Promise<BenchmarkItem[]> {
  const dataPath = config.dataPath || "./benchmarks/data/my-dataset";
  const data = await Bun.file(`${dataPath}/processed.json`).json();

  return data.items.map(item => ({
    id: item.id,
    query: item.question,
    contexts: item.codeFiles.map(file => ({
      id: file.path,
      content: file.code,
      metadata: {
        filepath: file.path,
        language: file.language,
      },
    })),
    metadata: {
      groundTruthIds: item.relevantFiles,
      difficulty: item.difficulty,
    },
  }));
}
```

**3. Register loader:**

```typescript
// benchmarks/loaders/builtin-loaders.ts
registerLoader({
  name: "my-dataset",
  description: "My custom dataset",
  loadFn: loadMyDatasetData,
});
```

**4. Download and test:**

```bash
# Download
superbench download --dataset my-dataset

# Verify
ls benchmarks/data/my-dataset

# Test
superbench eval --benchmarks my-dataset --providers code-chunk-ast --limit 5
```

### Dataset Structure (Recommended)

```
benchmarks/data/my-dataset/
├── metadata.json          # Dataset info
├── train/
│   ├── item_001.json
│   ├── item_002.json
│   └── ...
├── test/
│   ├── item_100.json
│   └── ...
└── code/                  # Source code files
    ├── repo1/
    │   ├── file1.py
    │   └── file2.py
    └── repo2/
        └── main.py
```

### DatasetDefinition Interface

```typescript
interface DatasetDefinition {
  name: string;
  files: Array<{
    url: string;
    extractTo: string;
    checksum?: string;
  }>;
  postProcess?: (extractPath: string) => Promise<void>;
}
```

---

## Adding a New Provider (LLM/RAG)

### Quick Example (45 minutes)

Providers integrate RAG systems or LLM APIs for retrieval evaluation.

**1. Create provider class in `providers/`:**

```typescript
// providers/my-rag-provider.ts
import { LocalProvider } from "./base/local-provider.ts";
import type { ProviderConfig, PreparedData, SearchResult } from "../core/config.ts";

export class MyRAGProvider extends LocalProvider {
  private client: MyRAGClient | null = null;

  // Initialize your RAG system
  protected override async doInitialize(): Promise<void> {
    const apiKey = process.env.MY_RAG_API_KEY;
    if (!apiKey) {
      throw new Error("MY_RAG_API_KEY environment variable required");
    }

    this.client = new MyRAGClient({ apiKey });
  }

  // Add code context to the RAG system
  override async addContext(data: PreparedData, runTag: string): Promise<void> {
    this.ensureInitialized();

    await this.client!.addDocument({
      id: data.id,
      content: data.content,
      metadata: {
        filepath: data.metadata.filepath,
        runTag,
      },
    });
  }

  // Search for relevant code
  override async searchQuery(
    query: string,
    runTag: string,
    options?: { limit?: number }
  ): Promise<SearchResult[]> {
    this.ensureInitialized();

    const results = await this.client!.search(query, {
      limit: options?.limit ?? 10,
      filter: { runTag },
    });

    return results.map(result => ({
      id: result.id,
      content: result.content,
      score: result.score,
      metadata: result.metadata,
    }));
  }

  // Clean up after evaluation
  override async clear(runTag: string): Promise<void> {
    await this.client!.deleteByTag(runTag);
  }

  // Cleanup resources
  protected override async doCleanup(): Promise<void> {
    await this.client?.close();
  }
}
```

**2. Register in `providers/factory.ts`:**

```typescript
import { MyRAGProvider } from "./my-rag-provider.ts";

providerByNameRegistry.set("my-rag", MyRAGProvider);
```

**3. Create YAML config:**

```yaml
# config/providers/my-rag.yaml
name: my-rag
type: local

local:
  # Provider-specific config
  modelName: my-rag-v1
  temperature: 0.7
```

**4. Test it:**

```bash
export MY_RAG_API_KEY=sk-...

superbench eval \
  --benchmarks repoeval \
  --providers my-rag \
  --limit 5
```

### Provider Interface

```typescript
abstract class Provider {
  abstract initialize(): Promise<void>;
  abstract addContext(data: PreparedData, runTag: string): Promise<void>;
  abstract searchQuery(
    query: string,
    runTag: string,
    options?: SearchOptions
  ): Promise<SearchResult[]>;
  abstract clear(runTag: string): Promise<void>;
  abstract cleanup(): Promise<void>;
}

interface SearchOptions {
  limit?: number;
  threshold?: number;
}
```

### LLM Provider Example

For LLM-based providers (like GPT-4 with RAG):

```typescript
export class GPT4RAGProvider extends LocalProvider {
  private openai: OpenAI | null = null;
  private vectorStore: VectorStore | null = null;

  protected override async doInitialize(): Promise<void> {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.vectorStore = new InMemoryVectorStore();
  }

  override async addContext(data: PreparedData, runTag: string): Promise<void> {
    // Embed and store
    const embedding = await this.openai!.embeddings.create({
      input: data.content,
      model: "text-embedding-3-small",
    });

    await this.vectorStore!.add(runTag, [{
      id: data.id,
      content: data.content,
      embedding: embedding.data[0]!.embedding,
      metadata: data.metadata,
    }]);
  }

  override async searchQuery(
    query: string,
    runTag: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    // Embed query
    const queryEmbedding = await this.openai!.embeddings.create({
      input: query,
      model: "text-embedding-3-small",
    });

    // Search
    return await this.vectorStore!.search(
      runTag,
      queryEmbedding.data[0]!.embedding,
      options
    );
  }
}
```

---

## Creating Custom Evaluators

### Quick Example (15 minutes)

Evaluators determine if retrieved results answer the query correctly.

**1. Create evaluator in `benchmarks/evaluators/`:**

```typescript
// benchmarks/evaluators/my-evaluator.ts
import type { BenchmarkItem, SearchResult } from "../../core/config.ts";
import type { EvaluationResult } from "./llm-judge.ts";

export async function evaluateMyWay(
  item: BenchmarkItem,
  searchResults: SearchResult[]
): Promise<EvaluationResult> {
  // Your evaluation logic
  const groundTruth = item.metadata?.groundTruthAnswer as string;

  // Check if any retrieved chunk contains the answer
  const hasAnswer = searchResults.some(result =>
    result.content.includes(groundTruth)
  );

  return {
    correct: hasAnswer,
    score: hasAnswer ? 1.0 : 0.0,
  };
}
```

**2. Register in `benchmarks/evaluators/evaluator-registry.ts`:**

```typescript
import { evaluateMyWay } from "./my-evaluator.ts";

function registerBuiltinEvaluators(): void {
  // ... existing evaluators ...

  registerEvaluator({
    name: "my-evaluator",
    aliases: ["my-eval"],
    evaluateFn: evaluateMyWay,
  });
}
```

**3. Use in benchmark config:**

```yaml
# benchmarks/configs/my-benchmark.yaml
evaluation:
  method: custom
  customEvaluator: my-evaluator
  k: 5
```

### Built-in Evaluators

- **exact-match**: Direct comparison with ground truth
- **llm-judge**: Uses LLM to judge answer quality
- **locomo-qa**: Custom evaluator for Locomo benchmark

See `benchmarks/evaluators/llm-judge.ts` for the full implementation.

---

## Testing Your Extensions

### Unit Tests

**1. Create test file next to your code:**

```typescript
// providers/my-rag-provider.test.ts
import { describe, test, expect, beforeEach } from "bun:test";
import { MyRAGProvider } from "./my-rag-provider.ts";

describe("MyRAGProvider", () => {
  let provider: MyRAGProvider;

  beforeEach(async () => {
    provider = new MyRAGProvider({
      name: "my-rag-test",
      type: "local",
    });
    await provider.initialize();
  });

  test("adds and retrieves context", async () => {
    await provider.addContext({
      id: "test.py",
      content: "def hello(): pass",
      metadata: { filepath: "test.py" },
    }, "test-run");

    const results = await provider.searchQuery("hello function", "test-run");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.content).toContain("hello");
  });

  test("clears context", async () => {
    await provider.addContext({
      id: "test.py",
      content: "def hello(): pass",
      metadata: {},
    }, "test-run");

    await provider.clear("test-run");

    const results = await provider.searchQuery("hello", "test-run");
    expect(results.length).toBe(0);
  });
});
```

**2. Run tests:**

```bash
# Run all tests
bun test

# Run specific test file
bun test my-rag-provider.test.ts

# Run with coverage
bun test --coverage
```

### Integration Tests

**1. Create small test dataset:**

```bash
mkdir -p benchmarks/data/test-benchmark
cat > benchmarks/data/test-benchmark/test.json << 'EOF'
{
  "items": [
    {
      "id": "test-1",
      "question": "What does the hello function do?",
      "codeFiles": [
        { "path": "test.py", "code": "def hello():\n    print('Hello, World!')" }
      ],
      "relevantFiles": ["test.py"]
    }
  ]
}
EOF
```

**2. Run evaluation:**

```bash
superbench eval \
  --benchmarks test-benchmark \
  --providers my-rag \
  --limit 1 \
  --verbose
```

**3. Check results:**

```bash
superbench table --run latest --benchmark test-benchmark
```

---

## Advanced Topics

### Custom Relevance Matching

Override `isRelevant` in your benchmark pack:

```typescript
isRelevant: (item, chunk, config) => {
  // Line-range overlap strategy
  const chunkStart = chunk.metadata?.startLine as number;
  const chunkEnd = chunk.metadata?.endLine as number;
  const targetStart = item.metadata?.targetStartLine as number;
  const targetEnd = item.metadata?.targetEndLine as number;

  return chunkStart <= targetEnd && chunkEnd >= targetStart;
}
```

### Custom Embedding Providers

```typescript
// providers/embeddings/my-embedder.ts
import type { EmbeddingProvider, EmbedResult } from "./index.ts";

export class MyEmbedder implements EmbeddingProvider {
  async embed(text: string): Promise<EmbedResult> {
    const response = await fetch("https://api.myembedder.com/embed", {
      method: "POST",
      body: JSON.stringify({ text }),
    });

    const data = await response.json();
    return {
      vector: data.embedding,
      tokenCount: data.tokens,
    };
  }

  async embedBatch(texts: string[]): Promise<{ embeddings: EmbedResult[] }> {
    // Batch embedding
    const response = await fetch("https://api.myembedder.com/embed/batch", {
      method: "POST",
      body: JSON.stringify({ texts }),
    });

    const data = await response.json();
    return {
      embeddings: data.embeddings.map((emb: any) => ({
        vector: emb.vector,
        tokenCount: emb.tokens,
      })),
    };
  }

  getStats() {
    return { totalTokens: 0, totalCost: 0 };
  }
}
```

Register in `providers/embeddings/providers.ts`:

```typescript
import { MyEmbedder } from "./my-embedder.ts";

export function createEmbeddingProviderFromYaml(
  config?: EmbeddingProviderConfig
): EmbeddingProvider {
  if (config?.provider === "my-embedder") {
    return new MyEmbedder();
  }
  // ... existing providers ...
}
```

### Custom Vector Stores

```typescript
// providers/storage/my-vector-store.ts
import type { VectorStore, StoredChunk, ScoredChunk } from "./vector-store.ts";

export class MyVectorStore implements VectorStore {
  private client: MyVectorDBClient;

  async add(runTag: string, chunks: StoredChunk[]): Promise<void> {
    await this.client.insert(chunks, { tag: runTag });
  }

  async search(
    runTag: string,
    queryVector: number[],
    options?: { limit?: number; threshold?: number }
  ): Promise<ScoredChunk[]> {
    const results = await this.client.search(queryVector, {
      filter: { tag: runTag },
      limit: options?.limit ?? 10,
    });

    return results.map(r => ({
      chunk: r.chunk,
      score: r.score,
    }));
  }

  async clear(runTag: string): Promise<void> {
    await this.client.delete({ tag: runTag });
  }
}
```

Register:

```typescript
// providers/storage/registry.ts
import { MyVectorStore } from "./my-vector-store.ts";

registerVectorStore({
  name: "my-vector-db",
  factory: (config) => new MyVectorStore(config),
  description: "My custom vector database",
});
```

Use in config:

```typescript
const config: ProviderConfig = {
  name: "my-chunker",
  type: "local",
  local: {
    vectorStore: createVectorStore("my-vector-db", {
      apiKey: process.env.MY_VECTOR_DB_KEY,
    }),
  },
};
```

---

## API Reference

### Core Types

```typescript
// BenchmarkItem - A single evaluation item
interface BenchmarkItem {
  id: string;
  query: string;              // Question to answer
  contexts: PreparedData[];   // Code files to search
  metadata?: Record<string, unknown>;
}

// PreparedData - A code file with metadata
interface PreparedData {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

// SearchResult - Retrieved chunk
interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// EvalResult - Evaluation outcome
interface EvalResult {
  id: string;
  query: string;
  correct: boolean;
  score: number;
  metadata?: Record<string, unknown>;
}
```

### Configuration

```typescript
interface BenchmarkConfig {
  name: string;
  description?: string;
  dataPath?: string;
  evaluation: {
    method: "exact-match" | "llm-judge" | "custom";
    customEvaluator?: string;
    k?: number;
  };
  metrics?: string[];
}

interface ProviderConfig {
  name: string;
  type: "local" | "docker" | "http";
  adapter?: string;
  local?: {
    chunking?: ChunkingConfig;
    embedding?: EmbeddingProviderConfig;
    vectorStore?: VectorStore;
  };
}

interface ChunkingConfig {
  size?: number;
  overlap?: number;
  strategy?: string;
}
```

---

## Troubleshooting

### Common Issues

**1. "Unknown provider: my-chunker"**

```
Error: Could not find provider class in adapter module 'my-chunker'
```

**Solution**: Ensure you registered both in chunker-registry.ts AND factory.ts:

```typescript
// chunker-registry.ts
registerChunker({ name: "my-chunker", chunkFn: ... });

// factory.ts
providerByNameRegistry.set("my-chunker", GenericChunkerProvider);
```

**2. "Invalid ChunkerDefinition: must have chunkFn"**

```
Error: Invalid ChunkerDefinition: "my-chunker" must have chunkFn
```

**Solution**: Ensure `chunkFn` is provided in registration:

```typescript
registerChunker({
  name: "my-chunker",
  chunkFn: async (content, filepath, config) => { /* ... */ },
});
```

**3. "Unknown metric: my-metric"**

```
RegistryNotFoundError: MetricRegistry: "my-metric" not found
```

**Solution**: Register metric in `core/metrics/builtin/index.ts`:

```typescript
export function getBuiltinMetrics(): MetricCalculator[] {
  return [
    // ... existing ...
    new MyMetric(),
  ];
}
```

**4. Empty results / 0% recall**

Check:
- Is line information preserved? (`startLine`, `endLine`)
- Is relevance matching correct? (Check `isRelevant()` in pack)
- Is the ground truth correct? (Check `metadata.relevantIds`)

**5. "Module not found: my-chunker-package"**

Add preflight check:

```typescript
preflight: async () => {
  try {
    await import("my-chunker-package");
  } catch {
    throw new Error("Install: npm install my-chunker-package");
  }
}
```

### Debug Logging

Enable verbose logging:

```bash
DEBUG=* superbench eval --benchmarks repoeval --providers my-chunker --limit 1
```

Check individual item results:

```bash
superbench table --run latest --benchmark repoeval --verbose
```

### Performance Issues

**Slow chunking:**
- Use batch processing for embeddings
- Cache embeddings if possible
- Reduce chunk size/overlap

**High memory usage:**
- Use streaming for large files
- Clear contexts after each benchmark item
- Reduce batch size

**Slow evaluation:**
- Reduce `--limit` during testing
- Use `exact-match` instead of `llm-judge`
- Parallelize with `--concurrency`

---

## Examples

### Complete Example: Custom Chunker

```typescript
// providers/adapters/semantic-chunker.ts
import { registerChunker } from "./chunker-registry.ts";

registerChunker({
  name: "semantic-chunker",
  aliases: ["sem", "semantic"],

  preflight: async () => {
    // Verify dependencies
    try {
      await import("@langchain/text-splitters");
    } catch {
      throw new Error("npm install @langchain/text-splitters");
    }
  },

  chunkFn: async (content, filepath, config) => {
    const { RecursiveCharacterTextSplitter } = await import(
      "@langchain/text-splitters"
    );

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: config.size ?? 1500,
      chunkOverlap: config.overlap ?? 100,
    });

    const chunks = await splitter.createDocuments([content]);

    // Compute line numbers
    const lines = content.split("\n");
    let currentLine = 1;

    return chunks.map((chunk, i) => {
      const chunkLines = chunk.pageContent.split("\n").length;
      const startLine = currentLine;
      const endLine = currentLine + chunkLines - 1;
      currentLine = endLine + 1;

      return {
        content: chunk.pageContent,
        startLine,
        endLine,
        id: `${filepath}:${i}`,
      };
    });
  },
});
```

---

## Next Steps

1. **Start simple**: Add a custom chunker or metric
2. **Test thoroughly**: Write unit tests before integration
3. **Share**: Contribute back to the project
4. **Benchmark**: Compare your approach to baselines

For more examples, see:
- `providers/adapters/chunker-registry.ts` - 6 chunker implementations
- `core/metrics/builtin/` - 10 metric implementations
- `benchmarks/packs/` - 6 benchmark pack implementations

**Need help?** Check:
- `CLAUDE.md` - Quick reference
- `docs/CODE_CHUNKING_BENCHMARK.md` - Benchmark philosophy
- `docs/EXTENSIBILITY_ANALYSIS.md` - Architecture deep-dive
