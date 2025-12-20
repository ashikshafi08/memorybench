/**
 * Embedding Providers
 *
 * Factory and exports for embedding providers used by chunker adapters.
 *
 * Supported providers:
 * - OpenAI: text-embedding-3-small, text-embedding-3-large
 * - Voyage: voyage-code-3, voyage-3, voyage-3-lite
 *
 * Environment variables:
 * - OPENAI_API_KEY: Required for OpenAI embeddings
 * - VOYAGE_API_KEY: Required for Voyage embeddings
 *
 * Caching:
 * - Embeddings are cached to disk by default
 * - Cache key: sha256(text) + modelId
 * - Cache location: .cache/embeddings/ (configurable)
 */

// Types and utilities from core
export type {
	EmbeddingProvider,
	EmbeddingProviderConfig,
	EmbeddingResult,
	BatchEmbeddingResult,
	EmbeddingStats,
} from "./core.ts";
export { cosineSimilarity, EmbeddingCache } from "./core.ts";

// Providers and factory from providers
export {
	OpenAIEmbeddingProvider,
	VoyageEmbeddingProvider,
	createEmbeddingProvider,
	createEmbeddingProviderFromYaml,
} from "./providers.ts";
