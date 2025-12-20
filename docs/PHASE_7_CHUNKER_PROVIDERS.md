# Phase 7: Code Chunker Providers Implementation

## Overview

This document provides comprehensive implementation details for adding code chunker providers to memorybench for benchmarking different chunking strategies.

**Estimated Effort**: 4-6 hours
**Priority**: P3 (Core feature)
**Dependencies**: Phases 4-6 (benchmark loaders)

---

## 1. Provider Architecture

### LocalProvider Interface

memorybench uses a `LocalProvider` interface for in-process providers that handle chunking and search:

```typescript
interface LocalProvider {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  /**
   * Add a code file to the provider's index
   * @param context - The file content and metadata
   * @param runTag - Unique identifier for this benchmark run (for scoping/isolation)
   */
  addContext(context: {
    filepath: string;
    content: string;
    metadata?: Record<string, unknown>;
  }, runTag: string): Promise<void>;

  /**
   * Search for relevant chunks given a query
   * @param query - The search query
   * @param runTag - Unique identifier for this benchmark run
   * @param options - Search options (limit, threshold)
   */
  searchQuery(query: string, runTag: string, options?: {
    limit?: number;
    threshold?: number;
  }): Promise<SearchResult[]>;

  /**
   * Clear all indexed content for a specific run
   * @param runTag - Clear only content from this run
   */
  clear(runTag: string): Promise<void>;
}

interface SearchResult {
  id: string;           // Unique chunk identifier (required for metrics)
  content: string;
  score: number;
  metadata?: {
    filepath?: string;
    startLine?: number;
    endLine?: number;
    chunkIndex?: number;
    [key: string]: unknown;
  };
}
```

> **Note:** `runTag` is required for scoping and isolation between benchmark runs. This allows multiple evaluations to run in parallel without interference.

---

## 2. Unified Chunker Interface

### ChunkerAdapter Interface

```typescript
/**
 * Unified interface for all chunking strategies
 *
 * This abstraction allows memorybench to benchmark different
 * chunkers (AST-aware, fixed, semantic) uniformly.
 */
interface ChunkerAdapter {
  readonly name: string;
  readonly description: string;

  /**
   * Chunk a source file into pieces
   */
  chunk(filepath: string, content: string): Promise<ChunkResult[]>;

  /**
   * Get supported languages
   */
  getSupportedLanguages(): string[];
}

interface ChunkResult {
  /** The chunk text to embed */
  text: string;
  /** Text with semantic context (if available) */
  contextualizedText?: string;
  /** Line range in original file (0-indexed, inclusive) */
  startLine: number;
  endLine: number;
  /** Chunk index */
  index: number;
  /** Total chunks for this file */
  totalChunks: number;
  /** Optional metadata */
  metadata?: {
    entities?: string[];
    scope?: string[];
    language?: string;
  };
}
```

---

## 3. code-chunk (AST-Aware) Provider

### Implementation

```typescript
// providers/code-chunk-ast.ts
import { chunk as astChunk } from 'code-chunk';
import type { Chunk, ChunkOptions } from 'code-chunk';

export class CodeChunkASTProvider implements LocalProvider {
  readonly id = 'code-chunk-ast';
  readonly name = 'code-chunk (AST)';
  readonly description = 'AST-aware code chunking using tree-sitter';

  private chunks: Map<string, ChunkResult[]> = new Map();
  private embeddings: Map<string, number[]> = new Map();
  private embeddingProvider: EmbeddingProvider;
  private options: ChunkOptions;

  constructor(config: {
    embeddingProvider: EmbeddingProvider;
    maxChunkSize?: number;
    contextMode?: 'none' | 'minimal' | 'full';
    siblingDetail?: 'none' | 'names' | 'signatures';
    overlapLines?: number;
  }) {
    this.embeddingProvider = config.embeddingProvider;
    this.options = {
      maxChunkSize: config.maxChunkSize || 1500,
      contextMode: config.contextMode || 'full',
      siblingDetail: config.siblingDetail || 'signatures',
      overlapLines: config.overlapLines || 0,
    };
  }

  async addContext(context: {
    filepath: string;
    content: string;
    metadata?: Record<string, unknown>;
  }, runTag: string): Promise<void> {
    // Chunk using code-chunk's AST-aware chunking
    const chunks = await astChunk(context.filepath, context.content, this.options);

    // Convert to ChunkResult format with runTag-scoped IDs
    const results: ChunkResult[] = chunks.map((c, idx) => ({
      id: `${runTag}:${context.filepath}:${idx}`,
      text: c.text,
      contextualizedText: c.contextualizedText,
      startLine: c.lineRange.start,
      endLine: c.lineRange.end,
      index: idx,
      totalChunks: chunks.length,
      metadata: {
        entities: c.context.entities.map(e => e.name),
        scope: c.context.scope.map(s => s.name),
        language: c.context.language,
        filepath: context.filepath,
      },
    }));

    // Store with runTag prefix for isolation
    const key = `${runTag}:${context.filepath}`;
    this.chunks.set(key, results);

    // Generate embeddings for contextualized text
    const texts = results.map(r => r.contextualizedText || r.text);
    const embeddings = await this.embeddingProvider.embed(texts);

    for (let i = 0; i < results.length; i++) {
      const chunkId = results[i].id;
      this.embeddings.set(chunkId, embeddings[i]);
    }
  }

  async searchQuery(query: string, runTag: string, options?: {
    limit?: number;
    threshold?: number;
  }): Promise<SearchResult[]> {
    const limit = options?.limit || 10;
    const threshold = options?.threshold || 0.0;

    // Get query embedding
    const [queryEmbedding] = await this.embeddingProvider.embed([query]);

    // Score all chunks for this runTag
    const scored: Array<{ chunkId: string; score: number; chunk: ChunkResult }> = [];

    for (const [key, chunks] of this.chunks) {
      if (!key.startsWith(`${runTag}:`)) continue; // Only search this run's chunks

      for (const chunk of chunks) {
        const embedding = this.embeddings.get(chunk.id);
        if (!embedding) continue;

        const score = this.cosineSimilarity(queryEmbedding, embedding);
        if (score >= threshold) {
          scored.push({ chunkId: chunk.id, score, chunk });
        }
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Return top results with id field
    return scored.slice(0, limit).map(({ chunkId, score, chunk }) => ({
      id: chunkId,
      content: chunk.contextualizedText || chunk.text,
      score,
      metadata: {
        filepath: chunk.metadata?.filepath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        chunkIndex: chunk.index,
        entities: chunk.metadata?.entities,
        scope: chunk.metadata?.scope,
      },
    }));
  }

  async clear(runTag: string): Promise<void> {
    // Only clear chunks for this run
    for (const key of this.chunks.keys()) {
      if (key.startsWith(`${runTag}:`)) {
        const chunks = this.chunks.get(key);
        if (chunks) {
          for (const chunk of chunks) {
            this.embeddings.delete(chunk.id);
          }
        }
        this.chunks.delete(key);
      }
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }
}
```

### code-chunk API Reference

From `code-chunk/packages/astchunk/src/types.ts`:

```typescript
interface ChunkOptions {
  /** Maximum size of each chunk in bytes (default: 1500) */
  maxChunkSize?: number;
  /** How much context to include (default: 'full') */
  contextMode?: 'none' | 'minimal' | 'full';
  /** Level of sibling detail (default: 'signatures') */
  siblingDetail?: 'none' | 'names' | 'signatures';
  /** Whether to filter out import statements (default: false) */
  filterImports?: boolean;
  /** Override language detection */
  language?: 'typescript' | 'javascript' | 'python' | 'rust' | 'go' | 'java';
  /** Number of lines to overlap from previous chunk (default: 0) */
  overlapLines?: number;
}

interface Chunk {
  /** The actual text content */
  text: string;
  /** Text with semantic context prepended for embedding */
  contextualizedText: string;
  /** Line range in original source (0-indexed, inclusive) */
  lineRange: { start: number; end: number };
  /** Byte range in original source */
  byteRange: { start: number; end: number };
  /** Contextual information */
  context: ChunkContext;
  /** Chunk index (0-based) */
  index: number;
  /** Total chunks */
  totalChunks: number;
}
```

### Supported Languages

| Language | File Extensions | Status |
|----------|-----------------|--------|
| TypeScript | `.ts`, `.tsx` | ✅ Full support |
| JavaScript | `.js`, `.jsx`, `.mjs` | ✅ Full support |
| Python | `.py` | ✅ Full support |
| Rust | `.rs` | ✅ Full support |
| Go | `.go` | ✅ Full support |
| Java | `.java` | ✅ Full support |

---

## 4. Fixed-Size (Baseline) Provider

### Implementation

```typescript
// providers/code-chunk-fixed.ts

/**
 * Fixed-size chunker baseline
 *
 * Splits code by non-whitespace character count (NWS).
 * Used as a simple baseline for comparison with AST-aware chunking.
 */
export class FixedChunkerProvider implements LocalProvider {
  readonly id = 'code-chunk-fixed';
  readonly name = 'Fixed Baseline';
  readonly description = 'Fixed-size line-based chunking (baseline)';

  private chunks: Map<string, ChunkResult[]> = new Map();
  private embeddings: Map<string, number[]> = new Map();
  private embeddingProvider: EmbeddingProvider;
  private maxNwsChars: number;

  constructor(config: {
    embeddingProvider: EmbeddingProvider;
    maxNwsChars?: number;
  }) {
    this.embeddingProvider = config.embeddingProvider;
    this.maxNwsChars = config.maxNwsChars || 1500;
  }

  async addContext(context: {
    filepath: string;
    content: string;
    metadata?: Record<string, unknown>;
  }, runTag: string): Promise<void> {
    const chunks = this.chunkByNws(context.filepath, context.content, runTag);
    const key = `${runTag}:${context.filepath}`;
    this.chunks.set(key, chunks);

    // Generate embeddings
    const texts = chunks.map(c => c.text);
    const embeddings = await this.embeddingProvider.embed(texts);

    for (let i = 0; i < chunks.length; i++) {
      this.embeddings.set(chunks[i].id, embeddings[i]);
    }
  }

  private chunkByNws(filepath: string, code: string, runTag: string): ChunkResult[] {
    const lines = code.split('\n');
    const chunks: ChunkResult[] = [];

    let currentLines: string[] = [];
    let currentNws = 0;
    let startLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      const lineNws = this.countNws(line);

      if (currentNws + lineNws > this.maxNwsChars && currentLines.length > 0) {
        // Flush current chunk with runTag-scoped id
        chunks.push({
          id: `${runTag}:${filepath}:${chunks.length}`,
          text: currentLines.join('\n'),
          startLine,
          endLine: startLine + currentLines.length - 1,
          index: chunks.length,
          totalChunks: 0, // Will be updated
          metadata: { filepath },
        });

        // Start new chunk
        currentLines = [line];
        currentNws = lineNws;
        startLine = i;
      } else {
        currentLines.push(line);
        currentNws += lineNws;
      }
    }

    // Flush remaining
    if (currentLines.length > 0) {
      chunks.push({
        id: `${runTag}:${filepath}:${chunks.length}`,
        text: currentLines.join('\n'),
        startLine,
        endLine: startLine + currentLines.length - 1,
        index: chunks.length,
        totalChunks: 0,
        metadata: { filepath },
      });
    }

    // Update totalChunks
    for (const chunk of chunks) {
      chunk.totalChunks = chunks.length;
    }

    return chunks;
  }

  private countNws(text: string): number {
    let count = 0;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) > 32) count++;
    }
    return count;
  }

  async searchQuery(query: string, runTag: string, options?: {
    limit?: number;
    threshold?: number;
  }): Promise<SearchResult[]> {
    // Same implementation as CodeChunkASTProvider (scoped by runTag)
    const limit = options?.limit || 10;
    const threshold = options?.threshold || 0.0;
    const [queryEmbedding] = await this.embeddingProvider.embed([query]);

    const scored: Array<{ chunk: ChunkResult; score: number }> = [];
    for (const [key, chunks] of this.chunks) {
      if (!key.startsWith(`${runTag}:`)) continue;
      for (const chunk of chunks) {
        const embedding = this.embeddings.get(chunk.id);
        if (!embedding) continue;
        const score = this.cosineSimilarity(queryEmbedding, embedding);
        if (score >= threshold) scored.push({ chunk, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ chunk, score }) => ({
      id: chunk.id,
      content: chunk.text,
      score,
      metadata: { filepath: chunk.metadata?.filepath, startLine: chunk.startLine, endLine: chunk.endLine },
    }));
  }

  async clear(runTag: string): Promise<void> {
    for (const key of this.chunks.keys()) {
      if (key.startsWith(`${runTag}:`)) {
        const chunks = this.chunks.get(key);
        if (chunks) for (const chunk of chunks) this.embeddings.delete(chunk.id);
        this.chunks.delete(key);
      }
    }
  }
}
```

---

## 5. Chonkie Provider

### Overview

Chonkie is a multi-strategy chunking library with TypeScript and Python SDKs. It supports:
- **TokenChunker**: Token-count based splitting
- **SentenceChunker**: Sentence boundary splitting
- **RecursiveChunker**: Hierarchical recursive splitting
- **CodeChunker**: Language-aware code splitting
- **SemanticChunker**: Embedding-based semantic splitting
- **NeuralChunker**: ML-based chunking

### Implementation

```typescript
// providers/chonkie.ts
import { TokenChunker, SemanticChunker, CodeChunker } from 'chonkie';

export class ChonkieProvider implements LocalProvider {
  readonly id = 'chonkie';
  readonly name = 'Chonkie';
  readonly description = 'Multi-strategy chunking with Chonkie';

  private chunks: Map<string, ChunkResult[]> = new Map();
  private embeddings: Map<string, number[]> = new Map();
  private embeddingProvider: EmbeddingProvider;
  private chunkerType: 'token' | 'semantic' | 'code' | 'recursive';
  private chunker: any;

  constructor(config: {
    embeddingProvider: EmbeddingProvider;
    chunkerType?: 'token' | 'semantic' | 'code' | 'recursive';
    maxTokens?: number;
  }) {
    this.embeddingProvider = config.embeddingProvider;
    this.chunkerType = config.chunkerType || 'code';

    // Initialize Chonkie chunker
    switch (this.chunkerType) {
      case 'token':
        this.chunker = new TokenChunker({
          chunkSize: config.maxTokens || 512,
          chunkOverlap: 50,
        });
        break;
      case 'semantic':
        this.chunker = new SemanticChunker({
          // Requires embedding model
        });
        break;
      case 'code':
        this.chunker = new CodeChunker({
          chunkSize: config.maxTokens || 512,
          language: 'python', // Auto-detect in practice
        });
        break;
      case 'recursive':
        // RecursiveChunker with custom separators
        break;
    }
  }

  async addContext(context: {
    filepath: string;
    content: string;
    metadata?: Record<string, unknown>;
  }, runTag: string): Promise<void> {
    // Chunk using Chonkie
    const chonkieChunks = await this.chunker.chunk(context.content);

    // Convert to our format with runTag-scoped IDs
    const results: ChunkResult[] = chonkieChunks.map((c: any, idx: number) => ({
      id: `${runTag}:${context.filepath}:${idx}`,
      text: c.text,
      startLine: c.startIndex ? this.indexToLine(context.content, c.startIndex) : 0,
      endLine: c.endIndex ? this.indexToLine(context.content, c.endIndex) : 0,
      index: idx,
      totalChunks: chonkieChunks.length,
      metadata: {
        filepath: context.filepath,
        tokenCount: c.tokenCount,
      },
    }));

    const key = `${runTag}:${context.filepath}`;
    this.chunks.set(key, results);

    // Generate embeddings
    const texts = results.map(r => r.text);
    const embeddings = await this.embeddingProvider.embed(texts);

    for (let i = 0; i < results.length; i++) {
      this.embeddings.set(results[i].id, embeddings[i]);
    }
  }

  private indexToLine(content: string, index: number): number {
    return content.slice(0, index).split('\n').length - 1;
  }

  async searchQuery(query: string, runTag: string, options?: {
    limit?: number;
    threshold?: number;
  }): Promise<SearchResult[]> {
    // Same as other providers (scoped by runTag)
    const limit = options?.limit || 10;
    const threshold = options?.threshold || 0.0;
    const [queryEmbedding] = await this.embeddingProvider.embed([query]);

    const scored: Array<{ chunk: ChunkResult; score: number }> = [];
    for (const [key, chunks] of this.chunks) {
      if (!key.startsWith(`${runTag}:`)) continue;
      for (const chunk of chunks) {
        const embedding = this.embeddings.get(chunk.id);
        if (!embedding) continue;
        const score = this.cosineSimilarity(queryEmbedding, embedding);
        if (score >= threshold) scored.push({ chunk, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ chunk, score }) => ({
      id: chunk.id,
      content: chunk.text,
      score,
      metadata: { filepath: chunk.metadata?.filepath, startLine: chunk.startLine, endLine: chunk.endLine },
    }));
  }

  async clear(runTag: string): Promise<void> {
    for (const key of this.chunks.keys()) {
      if (key.startsWith(`${runTag}:`)) {
        const chunks = this.chunks.get(key);
        if (chunks) for (const chunk of chunks) this.embeddings.delete(chunk.id);
        this.chunks.delete(key);
      }
    }
  }
}
```

### Chonkie Chunker Types

| Chunker | Best For | Notes |
|---------|----------|-------|
| `TokenChunker` | Simple splitting | Fast, predictable size |
| `SentenceChunker` | Natural language | Respects sentence boundaries |
| `RecursiveChunker` | Hierarchical | Paragraph → sentence → word |
| `CodeChunker` | Source code | Language-aware splitting |
| `SemanticChunker` | Coherent chunks | Uses embeddings |
| `NeuralChunker` | Advanced | ML-based boundary detection |

---

## 6. Provider Factory

```typescript
// providers/factory.ts

export type ProviderConfig =
  | { type: 'code-chunk-ast'; maxChunkSize?: number; contextMode?: string }
  | { type: 'code-chunk-fixed'; maxNwsChars?: number }
  | { type: 'chonkie'; chunkerType?: string; maxTokens?: number };

export function createProvider(
  config: ProviderConfig,
  embeddingProvider: EmbeddingProvider
): LocalProvider {
  switch (config.type) {
    case 'code-chunk-ast':
      return new CodeChunkASTProvider({
        embeddingProvider,
        maxChunkSize: config.maxChunkSize,
        contextMode: config.contextMode as any,
      });

    case 'code-chunk-fixed':
      return new FixedChunkerProvider({
        embeddingProvider,
        maxNwsChars: config.maxNwsChars,
      });

    case 'chonkie':
      return new ChonkieProvider({
        embeddingProvider,
        chunkerType: config.chunkerType as any,
        maxTokens: config.maxTokens,
      });

    default:
      throw new Error(`Unknown provider type: ${(config as any).type}`);
  }
}
```

---

## 7. Provider Registration

```typescript
// providers/index.ts

// Core providers (used in all benchmarks)
export const BUILTIN_PROVIDERS: Record<string, () => LocalProvider> = {
  // Core: AST-aware chunking with context preservation
  'code-chunk-ast': () => new CodeChunkASTProvider({
    embeddingProvider: getDefaultEmbeddingProvider(),
  }),
  // Core: Fixed-size baseline for comparison
  'code-chunk-fixed': () => new FixedChunkerProvider({
    embeddingProvider: getDefaultEmbeddingProvider(),
  }),
  // Core: Chonkie tree-sitter semantic chunking
  'chonkie-code': () => new ChonkieProvider({
    embeddingProvider: getDefaultEmbeddingProvider(),
    chunkerType: 'code',
  }),
  // Core: Chonkie recursive character fallback
  'chonkie-recursive': () => new ChonkieProvider({
    embeddingProvider: getDefaultEmbeddingProvider(),
    chunkerType: 'recursive',
  }),
  // Optional: Chonkie semantic chunking (embedding-based)
  'chonkie-semantic': () => new ChonkieProvider({
    embeddingProvider: getDefaultEmbeddingProvider(),
    chunkerType: 'semantic',
  }),
  // Optional: Chonkie simple token-based splitting
  'chonkie-token': () => new ChonkieProvider({
    embeddingProvider: getDefaultEmbeddingProvider(),
    chunkerType: 'token',
  }),
};

export function getProvider(id: string): LocalProvider {
  const factory = BUILTIN_PROVIDERS[id];
  if (!factory) {
    throw new Error(`Unknown provider: ${id}. Available: ${Object.keys(BUILTIN_PROVIDERS).join(', ')}`);
  }
  return factory();
}
```

---

## 8. CLI Usage

```bash
# List available providers
memorybench providers list

# Run evaluation with specific providers
memorybench eval \
  --benchmarks repoeval \
  --providers code-chunk-ast,code-chunk-fixed,chonkie-code \
  --metrics ndcg_at_5 ndcg_at_10 recall_at_5 \
  --limit 100

# Run with custom provider config
memorybench eval \
  --benchmarks repoeval \
  --provider-config '{"type":"code-chunk-ast","maxChunkSize":2000}' \
  --metrics ndcg_at_10 \
  --limit 50

# Compare all chunking strategies
memorybench eval \
  --benchmarks repoeval,repobench-r \
  --providers code-chunk-ast,code-chunk-fixed,chonkie-code,chonkie-recursive \
  --metrics ndcg_at_5 ndcg_at_10 precision_at_5 recall_at_10 mrr \
  --limit 200 \
  --output results/chunker-comparison.json
```

---

## 9. Implementation Checklist

- [ ] Create `providers/code-chunk-ast.ts`
- [ ] Create `providers/code-chunk-fixed.ts`
- [ ] Create `providers/chonkie.ts`
- [ ] Create `providers/factory.ts`
- [ ] Create `providers/index.ts` with registration
- [ ] Add npm dependencies: `code-chunk`, `chonkie`
- [ ] Implement `EmbeddingProvider` interface (see Phase 8)
- [ ] Add provider CLI commands
- [ ] Write provider tests
- [ ] Benchmark provider performance

---

## 10. Expected Performance

Based on code-chunk's existing eval on RepoEval:

| Provider | nDCG@5 | nDCG@10 | Recall@5 | Recall@10 |
|----------|--------|---------|----------|-----------|
| code-chunk-ast | ~0.75 | ~0.82 | ~0.65 | ~0.78 |
| code-chunk-fixed | ~0.55 | ~0.62 | ~0.45 | ~0.58 |
| chonkie-code | TBD | TBD | TBD | TBD |
| chonkie-recursive | TBD | TBD | TBD | TBD |

### Performance Factors

1. **Chunk Size**: Smaller chunks = more precise but more embedding calls
2. **Context Mode**: `full` context improves embedding quality
3. **Language Support**: AST parsing quality varies by language
4. **Overlap Lines**: Can improve recall at chunk boundaries

---

## 11. Key Differences Between Chunkers

| Aspect | code-chunk (AST) | Fixed Baseline | Chonkie |
|--------|------------------|----------------|---------|
| **Boundary Detection** | AST node boundaries | Line count (NWS) | Varies by type |
| **Context Awareness** | Full (scope, imports, siblings) | None | Partial |
| **Language Support** | 6 languages (tree-sitter) | All (text-based) | Varies |
| **Semantic Enrichment** | `contextualizedText` field | None | Embedding-based |
| **Speed** | Medium (parsing required) | Fast | Varies |
| **Use Case** | Production code RAG | Baseline comparison | General chunking |

---

## 12. Customization Options

### code-chunk Configuration

```typescript
const astProvider = new CodeChunkASTProvider({
  embeddingProvider,
  maxChunkSize: 2000,       // Larger chunks for more context
  contextMode: 'full',      // Include all context
  siblingDetail: 'signatures', // Include sibling signatures
  overlapLines: 2,          // Overlap for boundary coverage
});
```

### Chonkie Configuration

```typescript
const chonkieProvider = new ChonkieProvider({
  embeddingProvider,
  chunkerType: 'semantic',  // Embedding-based boundaries
  maxTokens: 512,           // Token limit
});
```

### Fixed Baseline Configuration

```typescript
const fixedProvider = new FixedChunkerProvider({
  embeddingProvider,
  maxNwsChars: 1500,        // NWS character limit
});
```
