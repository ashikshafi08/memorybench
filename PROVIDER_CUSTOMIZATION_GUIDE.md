# Provider & Benchmark Customization Guide

## Overview

This document explains how memorybench supports customization for two key personas:
1. **Benchmark Authors** - Add new benchmarks via YAML configuration
2. **Provider Authors** - Add new memory providers with customizable data preparation

## Architecture: One System, Three Components

```
┌─────────────────────────────────────────────────────────┐
│ PART 1: Benchmark YAML                                  │
│ - Benchmark author writes YAML schema                   │
│ - Declares how to extract data                          │
│ - NO CODE, just config                                  │
└─────────────────────────────────────────────────────────┘
              ↓ (feeds into)
┌─────────────────────────────────────────────────────────┐
│ PART 2: Generic Loader (memorybench core)              │
│ - Reads benchmark YAML schema                           │
│ - Extracts data automatically                           │
│ - Produces standardized PreparedData                    │
│ - Ships with memorybench                                │
└─────────────────────────────────────────────────────────┘
              ↓ (sends data to)
┌─────────────────────────────────────────────────────────┐
│ PART 3: Provider prepareData Hook                      │
│ - Provider customizes the PreparedData                  │
│ - Adds versioning, metadata, transformations            │
│ - Works for ALL benchmarks automatically                │
└─────────────────────────────────────────────────────────┘
```

---

## Persona 1: Benchmark Author (Non-Programmer)

### What They Do
Add a new benchmark to memorybench without writing any code.

### What They Customize

```yaml
# benchmarks/configs/my-benchmark.yaml

# ✅ Data source configuration
data:
  type: local  # or huggingface, or url
  path: "./my-data.json"
  format: json

# ✅ Schema (how to extract data from JSON)
schema:
  itemId: "id"
  question: "question"
  answer: "answer"

  # How to extract documents/context
  context:
    field: "documents"
    type: array
    itemSchema:
      content: "$.content"
      title: "$.title"
      source: "$.source"

  # Metadata fields to extract
  metadata:
    difficulty: "metadata.difficulty"
    category: "metadata.category"

# ✅ Evaluation settings
evaluation:
  method: llm-judge

  judge:
    model: "openrouter/qwen/qwen-2.5-7b-instruct:free"
    temperature: 0

  answeringModel:
    model: "openrouter/qwen/qwen-2.5-7b-instruct:free"
    temperature: 0

  judgePrompts:
    default: |
      Question: {{question}}
      Expected: {{expected}}
      Actual: {{actual}}

      Is the actual answer correct? Yes or no?
```

### What We Provide Them
- ❌ NO base class (they're not writing code!)
- ✅ YAML schema format with JSONPath support
- ✅ Documentation: "How to add a benchmark"
- ✅ Generic loader (automatically reads their YAML)

### Their Workflow
1. Write YAML config file in `benchmarks/configs/`
2. Add data file (JSON, CSV, or HuggingFace dataset)
3. Done! Memorybench automatically handles data extraction

### Example: Different Benchmark Types

**RAG-style benchmark:**
```yaml
name: rag-template
schema:
  itemId: "id"
  question: "question"
  answer: "expected_answer"
  context:
    field: "documents"
    type: array
    itemSchema:
      content: "$.content"
```

**Conversation-style benchmark (LoCoMo):**
```yaml
name: locomo
schema:
  itemId: "sample_id"
  context:
    field: "conversation"
    type: object
    itemSchema:
      sessionDate: "$.key"
      sessionData: "$.value"
```

**No code changes needed!** The generic loader handles both.

---

## Persona 2: Provider Author (Programmer)

### What They Do
Add a new memory provider to memorybench, with optional customization.

### Two Options

#### Option A: Simple Provider (90% of cases) - YAML Only

**What they customize:**

```yaml
# providers/configs/my-provider.yaml

name: my-provider
displayName: "My Memory Provider"
type: hosted
version: "1.0.0"

# Connection settings
connection:
  baseUrl: "https://api.myprovider.com"
  apiKey: "${MY_API_KEY}"
  timeout: 30000

# API endpoints
endpoints:
  add:
    method: POST
    path: /documents
    body:
      content: "{{content}}"
      metadata: "{{metadata}}"

  search:
    method: POST
    path: /search
    body:
      query: "{{query}}"
      limit: "{{topK}}"
    response:
      results: "$.results"
      contentField: "$.text"
      scoreField: "$.score"

  clear:
    method: DELETE
    path: /documents/all

# ✅ Customization via YAML
preprocessing:
  # Use benchmark's judge or override?
  useBenchmarkJudge: true

  # Transformations to apply
  transformations:
    - type: markdown-conversion
      enabled: true
    - type: tag-injection
      enabled: true
      tags:
        - "{{benchmarkName}}"
        - "run:{{runTag}}"

  # Metadata to inject
  metadata:
    source: "memorybench"
    userId: "benchmark-user"

# ✅ Versioning
schema:
  version: "1.0.0"
  description: "Initial schema"

# ✅ Optional: Benchmark-specific overrides
benchmarkOverrides:
  locomo:
    preprocessing:
      transformations:
        - type: conversation-formatting
          enabled: true
```

**What we provide:**
- ✅ **Base class: `HttpProvider`**
- ✅ Reads YAML config automatically
- ✅ Applies transformations from config
- ✅ Handles HTTP requests automatically
- ✅ Default versioning support

**Their workflow:**
1. Write YAML config file in `providers/configs/`
2. Set environment variable for API key
3. Done! Base `HttpProvider` handles everything

---

#### Option B: Advanced Provider (10% of cases) - TypeScript Adapter

**What they customize:**

```typescript
// providers/adapters/my-provider.ts

import { LocalProvider } from "../base/local-provider.ts";
import type {
  PreparedData,
  PreparedDataResult,
  DataPreparationContext,
  SearchResult,
  LocalProviderConfig,
} from "../types.ts";

export class MyProviderAdapter extends LocalProvider {
  private database: any;
  private readonly schemaVersion = "2.0.0";

  constructor(config: LocalProviderConfig) {
    super(config);
  }

  async initialize(): Promise<void> {
    // Initialize database, load models, etc.
    this.database = await this.setupDatabase();
  }

  /**
   * ✅ Override prepareData for custom logic
   * This works for ALL benchmarks automatically!
   */
  async prepareData(
    data: PreparedData,
    context: DataPreparationContext
  ): Promise<PreparedDataResult> {
    const transformations: string[] = [];

    // 1. Custom content transformation
    const chunkedContent = this.semanticChunk(data.content);
    transformations.push("semantic-chunking");

    // 2. Add versioning metadata
    const enhancedData: PreparedData = {
      ...data,
      content: chunkedContent,
      metadata: {
        ...data.metadata,
        provider: {
          // Versioning
          version: {
            schemaVersion: this.schemaVersion,
            providerVersion: "1.5.0",
            versionedAt: new Date().toISOString(),
          },

          // Custom metadata
          myProvider: {
            chunking: {
              strategy: "semantic",
              chunkCount: this.countChunks(chunkedContent),
            },
            runTag: context.runTag,
            benchmarkName: context.benchmarkConfig.name,
          },
        },
      },
    };

    return {
      data: enhancedData,
      preprocessingLog: {
        transformations,
        warnings: [],
      },
    };
  }

  async addContext(data: PreparedData, runTag: string): Promise<void> {
    // Custom storage logic
    await this.database.store(data, runTag);
  }

  async searchQuery(
    query: string,
    runTag: string,
    topK: number = 5
  ): Promise<SearchResult[]> {
    // Custom search logic with runTag filtering
    return await this.database.search(query, { runTag, limit: topK });
  }

  async clear(runTag: string): Promise<void> {
    // Custom cleanup logic
    await this.database.clearByTag(runTag);
  }

  // Helper methods
  private semanticChunk(content: string): string {
    // Custom chunking implementation
    return content;
  }

  private countChunks(content: string): number {
    return content.split("---CHUNK---").length;
  }
}
```

**What we provide:**
- ✅ **Base class: `LocalProvider`** (or `HttpProvider`)
- ✅ Default `prepareData()` implementation (can override)
- ✅ TypeScript interfaces for type safety
- ✅ Access to full benchmark context
- ✅ Preprocessing log support

**Their workflow:**
1. Create TypeScript file in `providers/adapters/`
2. Extend `LocalProvider` or `HttpProvider`
3. Override methods as needed
4. Register in `providers/factory.ts`

---

## What Exactly Do Providers Customize?

### 1. Content Transformation

Providers can transform content before storage:

```typescript
async prepareData(data, context) {
  return {
    data: {
      ...data,
      content: this.toMarkdown(data.content)  // ← Transform content
    }
  };
}
```

**Examples:**
- Convert to markdown/HTML
- Apply chunking (semantic, fixed, recursive)
- Format as templates
- Compress/expand content
- Translate languages
- Extract structured data

---

### 2. Metadata Injection

Providers can add custom metadata:

```typescript
async prepareData(data, context) {
  return {
    data: {
      ...data,
      metadata: {
        ...data.metadata,
        provider: {
          // ← Add provider-specific metadata
          userId: "user-123",
          spaceId: context.runTag,
          customField: "value",
          preprocessed: {
            steps: ["chunking", "markdown-conversion"],
            timestamp: new Date().toISOString(),
          }
        }
      }
    }
  };
}
```

**Examples:**
- User/tenant IDs for multi-tenancy
- Space/container IDs for isolation
- Preprocessing indicators
- Custom tracking fields
- Provider-specific configuration

---

### 3. Versioning

Providers can track schema versions:

```typescript
async prepareData(data, context) {
  return {
    data: {
      ...data,
      metadata: {
        ...data.metadata,
        provider: {
          version: {
            schemaVersion: "2.0.0",           // ← Schema version
            providerVersion: "1.5.0",         // ← Provider version
            versionedAt: new Date().toISOString(),
            migrationNotes: "Added chunking support"
          }
        }
      }
    }
  };
}
```

**Why versioning matters:**
- Compare results across provider versions
- Track schema migrations
- Debug version-specific issues
- Support backward compatibility

---

### 4. Benchmark-Specific Overrides (Optional)

Providers can customize behavior for specific benchmarks:

**Via YAML:**
```yaml
# providers/configs/my-provider.yaml
benchmarkOverrides:
  locomo:
    preprocessing:
      transformations:
        - type: conversation-formatting  # ← Special for LoCoMo only
          enabled: true
```

**Via TypeScript:**
```typescript
async prepareData(data, context) {
  const benchmarkName = context.benchmarkConfig.name;
  const override = this.config.benchmarkOverrides?.[benchmarkName];

  // Use override if exists, otherwise default
  const preprocessing = override?.preprocessing ?? this.config.preprocessing;

  // Apply transformations based on config
  return { data: this.applyTransformations(data, preprocessing) };
}
```

**Examples:**
- Special formatting for conversation benchmarks
- Different chunking for long-context benchmarks
- Custom metadata for specific benchmark types
- Benchmark-specific optimizations

---

## The Base Classes We Provide

### Base Class 1: `HttpProvider` (for hosted providers)

```typescript
// providers/base/http-provider.ts

/**
 * Base class for HTTP-based providers
 * Handles API requests and YAML-based preprocessing
 */
export class HttpProvider implements Provider {
  name: string;
  type: "http" = "http";
  protected config: HttpProviderConfig;

  constructor(config: HttpProviderConfig) {
    this.name = config.name;
    this.config = config;
  }

  /**
   * DEFAULT: Reads YAML preprocessing config and applies transformations
   * Providers can override for custom logic
   */
  async prepareData(
    data: PreparedData,
    context: DataPreparationContext
  ): Promise<PreparedDataResult> {
    const preprocessing = this.config.preprocessing;
    const transformations: string[] = [];

    // Apply transformations from YAML config
    let content = data.content;
    for (const transform of preprocessing?.transformations ?? []) {
      if (!transform.enabled) continue;

      if (transform.type === "markdown-conversion") {
        content = this.toMarkdown(content);
        transformations.push("markdown-conversion");
      }
      // ... more built-in transformations
    }

    // Inject metadata from YAML config
    return {
      data: {
        ...data,
        content,
        metadata: {
          ...data.metadata,
          ...preprocessing?.metadata,  // From YAML!
          provider: {
            version: {
              schemaVersion: this.config.schema?.version ?? "1.0.0",
              versionedAt: new Date().toISOString(),
            },
          },
        },
      },
      preprocessingLog: {
        transformations,
        warnings: [],
      },
    };
  }

  /**
   * DEFAULT: HTTP request handling for addContext
   */
  async addContext(data: PreparedData, runTag: string): Promise<void> {
    const endpoint = this.config.endpoints.add;
    await this.makeHttpRequest(endpoint, { ...data, runTag });
  }

  /**
   * DEFAULT: HTTP request handling for search
   */
  async searchQuery(
    query: string,
    runTag: string,
    topK?: number
  ): Promise<SearchResult[]> {
    const endpoint = this.config.endpoints.search;
    const response = await this.makeHttpRequest(endpoint, { query, runTag, topK });
    return this.parseSearchResponse(response, endpoint.response);
  }

  /**
   * DEFAULT: HTTP request handling for clear
   */
  async clear(runTag: string): Promise<void> {
    const endpoint = this.config.endpoints.clear;
    if (endpoint) {
      await this.makeHttpRequest(endpoint, { runTag });
    }
  }

  // Helper methods
  private toMarkdown(content: string): string { /* ... */ }
  private async makeHttpRequest(endpoint, payload): Promise<any> { /* ... */ }
  private parseSearchResponse(response, config): SearchResult[] { /* ... */ }
}
```

**What providers get:**
- ✅ Automatic HTTP request handling
- ✅ YAML preprocessing (markdown, tag injection, etc.)
- ✅ Default versioning
- ✅ Can override any method for custom logic
- ✅ Template variable interpolation (`{{query}}`, `{{runTag}}`, etc.)

---

### Base Class 2: `LocalProvider` (for local providers)

```typescript
// providers/base/local-provider.ts

/**
 * Base class for local (in-process) providers
 * Provides structure and default implementations
 */
export abstract class LocalProvider implements Provider {
  name: string;
  type: "local" = "local";
  protected config: LocalProviderConfig;
  private initialized = false;

  constructor(config: LocalProviderConfig) {
    this.name = config.name;
    this.config = config;
  }

  /**
   * DEFAULT: Pass-through implementation
   * Subclasses can override for custom preprocessing
   */
  async prepareData(
    data: PreparedData,
    context: DataPreparationContext
  ): Promise<PreparedDataResult> {
    return {
      data,
      preprocessingLog: {
        transformations: [],
        warnings: [],
      },
    };
  }

  /**
   * Initialize the provider (load models, setup DB, etc.)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.doInitialize();
    this.initialized = true;
  }

  /**
   * Ensure provider is initialized before operations
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Provider ${this.name} not initialized. Call initialize() first.`);
    }
  }

  // Subclasses MUST implement these
  protected abstract doInitialize(): Promise<void>;
  abstract addContext(data: PreparedData, runTag: string): Promise<void>;
  abstract searchQuery(query: string, runTag: string, topK?: number): Promise<SearchResult[]>;
  abstract clear(runTag: string): Promise<void>;

  /**
   * Optional cleanup when provider is no longer needed
   */
  async cleanup(): Promise<void> {
    await this.doCleanup();
    this.initialized = false;
  }

  protected async doCleanup(): Promise<void> {
    // Default: no cleanup needed
  }
}
```

**What providers get:**
- ✅ Structure for local providers
- ✅ Initialization lifecycle management
- ✅ Default `prepareData()` (can override)
- ✅ Helper methods for common operations
- ✅ Must implement storage/search logic

---

## Complete Examples

### Example 1: Benchmark Author Adds New Benchmark

```yaml
# benchmarks/configs/trivia.yaml
name: trivia
displayName: "Trivia Questions Benchmark"
description: "General knowledge trivia questions"

data:
  type: local
  path: "./benchmarks/trivia/data.json"
  format: json

schema:
  itemId: "id"
  question: "question"
  answer: "answer"

  context:
    field: "context_documents"
    type: array
    itemSchema:
      content: "$.text"

evaluation:
  method: llm-judge
  judge:
    model: "openrouter/qwen/qwen-2.5-7b-instruct:free"
```

**Done!** ✅ No code needed. Memorybench automatically:
1. Loads data from `./benchmarks/trivia/data.json`
2. Extracts questions, answers, and context using schema
3. Runs evaluations with LLM judge
4. Works with ALL providers automatically

---

### Example 2: Simple Provider (YAML Only)

```yaml
# providers/configs/myprovider.yaml
name: myprovider
displayName: "My Memory Service"
type: hosted
version: "1.0.0"

connection:
  baseUrl: "https://api.myprovider.com"
  apiKey: "${MYPROVIDER_API_KEY}"

endpoints:
  add:
    method: POST
    path: /documents
    body:
      content: "{{content}}"
      tags: ["{{runTag}}"]

  search:
    method: POST
    path: /search
    body:
      query: "{{query}}"
      tags: ["{{runTag}}"]
    response:
      results: "$.results"
      contentField: "$.text"
      scoreField: "$.score"

preprocessing:
  transformations:
    - type: markdown-conversion
      enabled: true
  metadata:
    source: "memorybench"
    userId: "benchmark-user"

schema:
  version: "1.0.0"
```

**Done!** ✅ `HttpProvider` base class handles everything:
1. HTTP requests to API
2. Markdown conversion
3. Metadata injection
4. Versioning

---

### Example 3: Advanced Provider (TypeScript)

```typescript
// providers/adapters/openrouter-rag.ts

import { LocalProvider } from "../base/local-provider.ts";

export class OpenRouterRAGProvider extends LocalProvider {
  private addDocument: any;
  private retrieve: any;
  private schemaVersion = "2.0.0";

  async doInitialize(): Promise<void> {
    // Load modules
    const addModule = await import("../OpenRouterRAG/src/add.ts");
    const retrieveModule = await import("../OpenRouterRAG/src/retrieve.ts");
    const dbModule = await import("../OpenRouterRAG/src/db.ts");

    this.addDocument = addModule.addDocument;
    this.retrieve = retrieveModule.retrieve;

    await dbModule.initDatabase();
  }

  /**
   * Custom data preparation with semantic chunking
   */
  async prepareData(data, context) {
    const transformations: string[] = [];

    // 1. Apply semantic chunking
    let content = data.content;
    if (content.length > 512) {
      content = this.semanticChunk(content, 512, 128);
      transformations.push("semantic-chunking");
    }

    // 2. Add rich metadata
    return {
      data: {
        ...data,
        content,
        metadata: {
          ...data.metadata,
          provider: {
            version: {
              schemaVersion: this.schemaVersion,
              providerVersion: "1.5.0",
              versionedAt: new Date().toISOString(),
            },
            openrouterRAG: {
              chunking: {
                strategy: "semantic",
                chunkSize: 512,
                overlap: 128,
              },
              runTag: context.runTag,
              benchmarkName: context.benchmarkConfig.name,
            },
          },
        },
      },
      preprocessingLog: {
        transformations,
        warnings: [],
      },
    };
  }

  async addContext(data, runTag) {
    this.ensureInitialized();
    await this.addDocument(data.content, runTag);
  }

  async searchQuery(query, runTag, topK = 5) {
    this.ensureInitialized();
    const results = await this.retrieve(query, runTag, topK);

    return results.map(r => ({
      id: r.id.toString(),
      content: r.content,
      score: r.similarity_score,
      metadata: r.metadata,
    }));
  }

  async clear(runTag) {
    this.ensureInitialized();
    await this.deleteDocumentsByRunTag(runTag);
  }

  private semanticChunk(content: string, chunkSize: number, overlap: number): string {
    // Custom chunking implementation
    // ...
  }
}
```

**Done!** ✅ Full control over:
1. Custom semantic chunking
2. Rich metadata injection
3. Versioning
4. Database operations

---

## Summary Table

| Who | What They Customize | Base Class | Config Type | Code Required? |
|-----|-------------------|-----------|------------|----------------|
| **Benchmark Author** | Data schema, evaluation settings | ❌ None | YAML | ❌ No |
| **Simple Provider** | Preprocessing, metadata, endpoints | ✅ `HttpProvider` | YAML | ❌ No |
| **Advanced Provider** | Content transforms, custom logic | ✅ `LocalProvider` or `HttpProvider` | YAML + TS | ✅ Yes |

---

## Key Benefits

### For Benchmark Authors
- ✅ No code required - just YAML
- ✅ Works with ALL providers automatically
- ✅ Easy to add new benchmarks
- ✅ Standardized format

### For Simple Provider Authors
- ✅ No code required - just YAML
- ✅ Base class handles HTTP/preprocessing
- ✅ Works with ALL benchmarks automatically
- ✅ Easy to configure

### For Advanced Provider Authors
- ✅ Full control via TypeScript
- ✅ Access to benchmark context
- ✅ Custom transformations
- ✅ Versioning support
- ✅ Works with ALL benchmarks automatically

### For Everyone
- ✅ **No switch/case statements** for benchmark types
- ✅ **Add 100 benchmarks = 0 provider code changes**
- ✅ **Add 100 providers = 0 benchmark code changes**
- ✅ Clean separation of concerns
- ✅ Versioning and metadata tracking
- ✅ Easy debugging and comparison

---

## The Key Insight

**Old Pattern (Bad):**
```typescript
// Provider must handle every benchmark type ❌
prepareProvider: (benchmarkType, data) => {
    switch (benchmarkType) {
        case "RAG": { /* logic */ }
        case "LoCoMo": { /* logic */ }
        case "TriviaQA": { /* logic */ }
        // ... 50 more cases
    }
}
```

**New Pattern (Good):**
```typescript
// Provider customizes once, works for all benchmarks ✅
async prepareData(data, context) {
  return {
    data: {
      ...data,
      content: this.myTransform(data.content),  // Provider preference
      metadata: { ...data.metadata, myField: "value" }
    }
  };
}
```

**Result:** Adding a new benchmark requires:
- ❌ Old: Update every provider's switch statement
- ✅ New: Just add YAML config, zero code changes

---

## Next Steps

1. **For Benchmark Authors:** See `docs/adding-benchmarks.md`
2. **For Simple Provider Authors:** See `docs/adding-simple-providers.md`
3. **For Advanced Provider Authors:** See `docs/adding-advanced-providers.md`
4. **For Implementation Details:** See `ARCHITECTURE.md`

---

## Questions?

- How do I add a benchmark? → Write YAML schema, no code needed
- How do I add a simple provider? → Write YAML config, base class handles everything
- How do I customize preprocessing? → Override `prepareData()` method
- How do I add versioning? → Inject version metadata in `prepareData()`
- Do I need code for every benchmark? → No! Generic loader handles all benchmarks
- Can I customize per benchmark? → Yes! Use `benchmarkOverrides` in YAML

**Key Principle:** Write once (provider customization), works everywhere (all benchmarks).
