# Phase 8: Multi-Embedding Provider Support

## Overview

This document provides comprehensive implementation details for adding multi-embedding provider support to memorybench for code chunking evaluation.

**Estimated Effort**: 2-3 hours
**Priority**: P4 (Required for all evaluations)
**Dependencies**: Phase 7 (Chunker Providers)

---

## 1. Embedding Provider Interface

### Core Interface

```typescript
/**
 * Unified interface for embedding providers
 *
 * Supports batch embedding with caching for efficient evaluation.
 */
interface EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dimensions: number;
  readonly maxBatchSize: number;
  readonly maxTokens: number;

  /**
   * Generate embeddings for multiple texts
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Generate embedding for a single text
   */
  embedSingle(text: string): Promise<number[]>;

  /**
   * Get estimated cost for embedding
   */
  estimateCost(tokenCount: number): number;
}
```

---

## 2. OpenAI Embedding Provider

### Configuration

| Model | Dimensions | Max Tokens | Cost per 1M Tokens |
|-------|------------|------------|---------------------|
| `text-embedding-3-small` | 1536 | 8,191 | $0.02 |
| `text-embedding-3-large` | 3072 | 8,191 | $0.13 |
| `text-embedding-ada-002` | 1536 | 8,191 | $0.10 |

### Implementation

```typescript
// embedding/openai.ts
import OpenAI from 'openai';

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dimensions: number;
  readonly maxBatchSize = 2048;
  readonly maxTokens = 8191;

  private client: OpenAI;
  private model: string;
  private cache: Map<string, number[]>;
  private costPerToken: number;

  constructor(config: {
    apiKey?: string;
    model?: 'text-embedding-3-small' | 'text-embedding-3-large' | 'text-embedding-ada-002';
    dimensions?: number;
    enableCache?: boolean;
  } = {}) {
    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
    });

    this.model = config.model || 'text-embedding-3-small';
    this.id = `openai-${this.model}`;
    this.name = `OpenAI ${this.model}`;

    // Set dimensions based on model
    const defaultDimensions: Record<string, number> = {
      'text-embedding-3-small': 1536,
      'text-embedding-3-large': 3072,
      'text-embedding-ada-002': 1536,
    };
    this.dimensions = config.dimensions || defaultDimensions[this.model] || 1536;

    // Cost per token (in dollars per million)
    const costs: Record<string, number> = {
      'text-embedding-3-small': 0.02 / 1_000_000,
      'text-embedding-3-large': 0.13 / 1_000_000,
      'text-embedding-ada-002': 0.10 / 1_000_000,
    };
    this.costPerToken = costs[this.model] || 0.02 / 1_000_000;

    this.cache = config.enableCache !== false ? new Map() : new Map();
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Check cache first
    for (let i = 0; i < texts.length; i++) {
      const cacheKey = this.getCacheKey(texts[i]);
      const cached = this.cache.get(cacheKey);

      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    // Batch embed uncached texts
    if (uncachedTexts.length > 0) {
      const embeddings = await this.batchEmbed(uncachedTexts);

      for (let i = 0; i < uncachedIndices.length; i++) {
        const originalIndex = uncachedIndices[i];
        results[originalIndex] = embeddings[i];

        // Cache the result
        const cacheKey = this.getCacheKey(texts[originalIndex]);
        this.cache.set(cacheKey, embeddings[i]);
      }
    }

    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding;
  }

  private async batchEmbed(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);

      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        encoding_format: 'float',
        ...(this.model.startsWith('text-embedding-3') && this.dimensions !== 1536
          ? { dimensions: this.dimensions }
          : {}),
      });

      // Sort by index to maintain order
      const sortedData = response.data.sort((a, b) => a.index - b.index);
      embeddings.push(...sortedData.map(d => d.embedding));
    }

    return embeddings;
  }

  estimateCost(tokenCount: number): number {
    return tokenCount * this.costPerToken;
  }

  private getCacheKey(text: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(text).digest('hex');
  }
}
```

### Vercel AI SDK Alternative

```typescript
// embedding/openai-vercel.ts
import { openai } from '@ai-sdk/openai';
import { embedMany, embed } from 'ai';

export class VercelAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'vercel-openai';
  readonly name = 'OpenAI via Vercel AI SDK';
  readonly dimensions = 1536;
  readonly maxBatchSize = 100;
  readonly maxTokens = 8191;

  private model = openai.textEmbeddingModel('text-embedding-3-small');

  async embed(texts: string[]): Promise<number[][]> {
    const { embeddings } = await embedMany({
      model: this.model,
      values: texts,
    });
    return embeddings;
  }

  async embedSingle(text: string): Promise<number[]> {
    const { embedding } = await embed({
      model: this.model,
      value: text,
    });
    return embedding;
  }

  estimateCost(tokenCount: number): number {
    return tokenCount * (0.02 / 1_000_000);
  }
}
```

---

## 3. Voyage AI Embedding Provider

### Configuration

| Model | Dimensions | Max Tokens | Cost per 1M Tokens |
|-------|------------|------------|---------------------|
| `voyage-code-3` | 1024 | 32,000 | $0.18 |
| `voyage-3` | 1024 | 32,000 | $0.06 |
| `voyage-3-lite` | 512 | 32,000 | $0.02 |
| `voyage-3.5` | 1024 | 32,000 | $0.06 |

### Implementation

```typescript
// embedding/voyage.ts
import { VoyageAIClient } from 'voyageai';

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dimensions: number;
  readonly maxBatchSize = 128;
  readonly maxTokens = 32000;

  private client: VoyageAIClient;
  private model: string;
  private cache: Map<string, number[]>;
  private costPerToken: number;

  constructor(config: {
    apiKey?: string;
    model?: 'voyage-code-3' | 'voyage-3' | 'voyage-3-lite' | 'voyage-3.5';
    dimensions?: number;
    enableCache?: boolean;
  } = {}) {
    this.client = new VoyageAIClient({
      apiKey: config.apiKey || process.env.VOYAGE_API_KEY,
    });

    this.model = config.model || 'voyage-code-3';
    this.id = `voyage-${this.model}`;
    this.name = `Voyage AI ${this.model}`;

    // Set dimensions based on model
    const defaultDimensions: Record<string, number> = {
      'voyage-code-3': 1024,
      'voyage-3': 1024,
      'voyage-3-lite': 512,
      'voyage-3.5': 1024,
    };
    this.dimensions = config.dimensions || defaultDimensions[this.model] || 1024;

    // Cost per token (in dollars per million)
    const costs: Record<string, number> = {
      'voyage-code-3': 0.18 / 1_000_000,
      'voyage-3': 0.06 / 1_000_000,
      'voyage-3-lite': 0.02 / 1_000_000,
      'voyage-3.5': 0.06 / 1_000_000,
    };
    this.costPerToken = costs[this.model] || 0.18 / 1_000_000;

    this.cache = config.enableCache !== false ? new Map() : new Map();
  }

  async embed(texts: string[]): Promise<number[][]> {
    const results: number[][] = new Array(texts.length);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    // Check cache first
    for (let i = 0; i < texts.length; i++) {
      const cacheKey = this.getCacheKey(texts[i]);
      const cached = this.cache.get(cacheKey);

      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    // Batch embed uncached texts
    if (uncachedTexts.length > 0) {
      const embeddings = await this.batchEmbed(uncachedTexts);

      for (let i = 0; i < uncachedIndices.length; i++) {
        const originalIndex = uncachedIndices[i];
        results[originalIndex] = embeddings[i];

        // Cache the result
        const cacheKey = this.getCacheKey(texts[originalIndex]);
        this.cache.set(cacheKey, embeddings[i]);
      }
    }

    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding;
  }

  private async batchEmbed(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);

      const response = await this.client.embed({
        input: batch,
        model: this.model,
        inputType: 'document', // Use 'query' for search queries
        outputDimension: this.dimensions,
        outputDtype: 'float',
      });

      embeddings.push(...response.data.map((d: any) => d.embedding));
    }

    return embeddings;
  }

  estimateCost(tokenCount: number): number {
    return tokenCount * this.costPerToken;
  }

  private getCacheKey(text: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(text).digest('hex');
  }
}
```

### voyage-code-3 Features

| Feature | Description |
|---------|-------------|
| **32K Context** | Handles large code files without truncation |
| **Code Optimized** | 13.8% better than OpenAI on code retrieval |
| **Matryoshka Learning** | Reduce dimensions (1024 → 512 → 256) with minimal quality loss |
| **Quantization** | int8 and binary formats for lower storage |

---

## 4. Disk-Based Embedding Cache

### SHA256-Based Caching

For large-scale evaluations, memory cache isn't sufficient. Use disk-based caching:

```typescript
// embedding/cache.ts
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export class DiskEmbeddingCache {
  private cacheDir: string;
  private modelId: string;

  constructor(config: {
    cacheDir?: string;
    modelId: string;
  }) {
    this.modelId = config.modelId;
    this.cacheDir = config.cacheDir || join(process.cwd(), '.embedding-cache', this.modelId);

    // Create cache directory structure
    mkdirSync(this.cacheDir, { recursive: true });

    // Create 256 subdirectories for sharding (first 2 chars of hash)
    for (let i = 0; i < 256; i++) {
      const subdir = i.toString(16).padStart(2, '0');
      mkdirSync(join(this.cacheDir, subdir), { recursive: true });
    }
  }

  /**
   * Get cached embedding
   */
  get(text: string): number[] | null {
    const hash = this.hash(text);
    const path = this.getPath(hash);

    if (!existsSync(path)) {
      return null;
    }

    try {
      const data = readFileSync(path);
      return Array.from(new Float32Array(data.buffer, data.byteOffset, data.length / 4));
    } catch {
      return null;
    }
  }

  /**
   * Store embedding in cache
   */
  set(text: string, embedding: number[]): void {
    const hash = this.hash(text);
    const path = this.getPath(hash);

    const buffer = Buffer.from(new Float32Array(embedding).buffer);
    writeFileSync(path, buffer);
  }

  /**
   * Check if embedding is cached
   */
  has(text: string): boolean {
    const hash = this.hash(text);
    const path = this.getPath(hash);
    return existsSync(path);
  }

  /**
   * Get batch from cache (returns cached and uncached separately)
   */
  getBatch(texts: string[]): {
    cached: Map<number, number[]>;
    uncachedIndices: number[];
  } {
    const cached = new Map<number, number[]>();
    const uncachedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const embedding = this.get(texts[i]);
      if (embedding) {
        cached.set(i, embedding);
      } else {
        uncachedIndices.push(i);
      }
    }

    return { cached, uncachedIndices };
  }

  /**
   * Store batch in cache
   */
  setBatch(texts: string[], embeddings: number[][], indices: number[]): void {
    for (let i = 0; i < indices.length; i++) {
      const originalIndex = indices[i];
      this.set(texts[originalIndex], embeddings[i]);
    }
  }

  private hash(text: string): string {
    return createHash('sha256').update(text).digest('hex');
  }

  private getPath(hash: string): string {
    // Use first 2 chars for sharding
    const shard = hash.slice(0, 2);
    return join(this.cacheDir, shard, `${hash}.bin`);
  }
}
```

### Cache-Enabled Provider Wrapper

```typescript
// embedding/cached-provider.ts

export class CachedEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dimensions: number;
  readonly maxBatchSize: number;
  readonly maxTokens: number;

  private provider: EmbeddingProvider;
  private cache: DiskEmbeddingCache;

  constructor(
    provider: EmbeddingProvider,
    cacheDir?: string
  ) {
    this.provider = provider;
    this.id = `cached-${provider.id}`;
    this.name = `${provider.name} (Cached)`;
    this.dimensions = provider.dimensions;
    this.maxBatchSize = provider.maxBatchSize;
    this.maxTokens = provider.maxTokens;

    this.cache = new DiskEmbeddingCache({
      modelId: provider.id,
      cacheDir,
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    // Check cache
    const { cached, uncachedIndices } = this.cache.getBatch(texts);

    // All cached - return immediately
    if (uncachedIndices.length === 0) {
      return texts.map((_, i) => cached.get(i)!);
    }

    // Embed uncached texts
    const uncachedTexts = uncachedIndices.map(i => texts[i]);
    const newEmbeddings = await this.provider.embed(uncachedTexts);

    // Cache new embeddings
    this.cache.setBatch(texts, newEmbeddings, uncachedIndices);

    // Merge results
    const results: number[][] = new Array(texts.length);
    for (const [index, embedding] of cached) {
      results[index] = embedding;
    }
    for (let i = 0; i < uncachedIndices.length; i++) {
      results[uncachedIndices[i]] = newEmbeddings[i];
    }

    return results;
  }

  async embedSingle(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    return embedding;
  }

  estimateCost(tokenCount: number): number {
    return this.provider.estimateCost(tokenCount);
  }
}
```

---

## 5. Provider Factory

```typescript
// embedding/factory.ts

export type EmbeddingConfig =
  | { type: 'openai'; model?: string; dimensions?: number }
  | { type: 'voyage'; model?: string; dimensions?: number }
  | { type: 'vercel-openai' };

export function createEmbeddingProvider(
  config: EmbeddingConfig,
  options?: {
    cacheDir?: string;
    enableCache?: boolean;
  }
): EmbeddingProvider {
  let provider: EmbeddingProvider;

  switch (config.type) {
    case 'openai':
      provider = new OpenAIEmbeddingProvider({
        model: config.model as any,
        dimensions: config.dimensions,
      });
      break;

    case 'voyage':
      provider = new VoyageEmbeddingProvider({
        model: config.model as any,
        dimensions: config.dimensions,
      });
      break;

    case 'vercel-openai':
      provider = new VercelAIEmbeddingProvider();
      break;

    default:
      throw new Error(`Unknown embedding provider: ${(config as any).type}`);
  }

  // Wrap with cache if enabled
  if (options?.enableCache !== false) {
    provider = new CachedEmbeddingProvider(provider, options?.cacheDir);
  }

  return provider;
}
```

---

## 6. Configuration File

```yaml
# config/embeddings.yaml
providers:
  openai-small:
    type: openai
    model: text-embedding-3-small
    dimensions: 1536
    cache: true

  openai-large:
    type: openai
    model: text-embedding-3-large
    dimensions: 3072
    cache: true

  voyage-code:
    type: voyage
    model: voyage-code-3
    dimensions: 1024
    cache: true

  voyage-code-compact:
    type: voyage
    model: voyage-code-3
    dimensions: 512  # Reduced for storage efficiency
    cache: true

default: openai-small

cache:
  directory: .embedding-cache
  maxSizeMB: 10240  # 10 GB max cache size
```

---

## 7. CLI Usage

```bash
# List available embedding providers
memorybench embeddings list

# Run evaluation with specific embedding
memorybench eval \
  --benchmarks repoeval \
  --providers code-chunk-ast \
  --embeddings voyage-code-3 \
  --metrics ndcg_at_10 \
  --limit 100

# Compare embedding providers
memorybench eval \
  --benchmarks repoeval \
  --providers code-chunk-ast \
  --embeddings openai-small,voyage-code-3 \
  --metrics ndcg_at_5 ndcg_at_10 \
  --limit 100

# Estimate costs before running
memorybench eval \
  --benchmarks repoeval \
  --providers code-chunk-ast \
  --embeddings voyage-code-3 \
  --dry-run  # Shows estimated costs
```

---

## 8. Implementation Checklist

- [ ] Create `embedding/interface.ts` with EmbeddingProvider
- [ ] Create `embedding/openai.ts`
- [ ] Create `embedding/voyage.ts`
- [ ] Create `embedding/cache.ts` with DiskEmbeddingCache
- [ ] Create `embedding/cached-provider.ts`
- [ ] Create `embedding/factory.ts`
- [ ] Create `embedding/index.ts` with exports
- [ ] Add npm dependencies: `openai`, `voyageai`
- [ ] Add CLI commands for embedding management
- [ ] Write provider tests
- [ ] Benchmark caching performance

---

## 9. Cost Comparison

### Per 1M Tokens

| Provider | Model | Cost | Dimensions |
|----------|-------|------|------------|
| OpenAI | text-embedding-3-small | $0.02 | 1536 |
| OpenAI | text-embedding-3-large | $0.13 | 3072 |
| Voyage | voyage-code-3 | $0.18 | 1024 |
| Voyage | voyage-3 | $0.06 | 1024 |
| Voyage | voyage-3-lite | $0.02 | 512 |

### Storage Costs

| Dimensions | Per 1M Vectors (Float32) | Per 1M Vectors (Int8) |
|------------|--------------------------|----------------------|
| 1536 | 6.14 GB | 1.54 GB |
| 1024 | 4.10 GB | 1.02 GB |
| 512 | 2.05 GB | 0.51 GB |

### Evaluation Cost Estimate

For RepoEval with 455 samples and ~100 chunks per file:
- **Texts to embed**: ~45,500 chunks + 455 queries ≈ 46K texts
- **Avg tokens per text**: ~200 tokens
- **Total tokens**: ~9.2M tokens

| Provider | Estimated Cost |
|----------|----------------|
| OpenAI text-embedding-3-small | $0.18 |
| OpenAI text-embedding-3-large | $1.20 |
| Voyage voyage-code-3 | $1.66 |

---

## 10. Best Practices

### 1. Always Enable Caching

```typescript
const provider = createEmbeddingProvider(
  { type: 'voyage', model: 'voyage-code-3' },
  { enableCache: true }
);
```

### 2. Batch Embeddings

```typescript
// Good: Batch many texts together
const embeddings = await provider.embed(allChunkTexts);

// Bad: Individual calls (slow, more API calls)
for (const text of allChunkTexts) {
  const embedding = await provider.embedSingle(text);
}
```

### 3. Use Appropriate Model

- **Code retrieval**: `voyage-code-3` (13.8% better than OpenAI)
- **General text**: `text-embedding-3-small` (cost-effective)
- **High precision**: `text-embedding-3-large` or `voyage-3`

### 4. Dimension Reduction

```typescript
// Voyage supports Matryoshka dimensions
const provider = new VoyageEmbeddingProvider({
  model: 'voyage-code-3',
  dimensions: 512,  // Reduced from 1024 - 30% quality loss for 50% storage savings
});
```

### 5. Query vs Document Input Type

```typescript
// For documents/chunks being indexed
const docEmbeddings = await voyageClient.embed({
  input: chunks,
  inputType: 'document',  // Optimized for retrieval targets
});

// For search queries
const queryEmbedding = await voyageClient.embed({
  input: [query],
  inputType: 'query',  // Optimized for search
});
```

---

## 11. Error Handling

```typescript
async function embedWithRetry(
  provider: EmbeddingProvider,
  texts: string[],
  maxRetries = 3
): Promise<number[][]> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await provider.embed(texts);
    } catch (error: any) {
      lastError = error;

      // Rate limit - wait and retry
      if (error.status === 429) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(`Rate limited. Waiting ${waitTime}ms...`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }

      // Token limit exceeded - split batch
      if (error.message?.includes('token')) {
        // Split texts in half and retry
        const mid = Math.floor(texts.length / 2);
        const [first, second] = await Promise.all([
          embedWithRetry(provider, texts.slice(0, mid), maxRetries),
          embedWithRetry(provider, texts.slice(mid), maxRetries),
        ]);
        return [...first, ...second];
      }

      throw error;
    }
  }

  throw lastError || new Error('Max retries exceeded');
}
```
