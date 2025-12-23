/**
 * Embedding Providers
 *
 * OpenAI and Voyage embedding provider implementations.
 * This consolidates openai.ts and voyage.ts into a single file.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import {
	EmbeddingCache,
	type EmbeddingProvider,
	type EmbeddingProviderConfig,
	type EmbeddingResult,
	type BatchEmbeddingResult,
	type EmbeddingStats,
} from "./core.ts";

// ============================================================================
// OpenAI Embedding Provider
// ============================================================================

/**
 * Default dimensions for OpenAI embedding models.
 */
const OPENAI_MODEL_DIMENSIONS: Record<string, number> = {
	"text-embedding-3-small": 1536,
	"text-embedding-3-large": 3072,
	"text-embedding-ada-002": 1536,
};

/**
 * OpenAI embedding provider implementation.
 *
 * Uses the @ai-sdk/openai package for embeddings.
 * Supports text-embedding-3-small, text-embedding-3-large, etc.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
	readonly provider = "openai";
	readonly model: string;
	readonly dimensions: number;

	private readonly client: ReturnType<typeof createOpenAI>;
	private readonly cache: EmbeddingCache | null;
	private apiCalls = 0;
	private totalTokens = 0;

	constructor(config: EmbeddingProviderConfig) {
		this.model = config.model || "text-embedding-3-small";
		this.dimensions = config.dimensions || OPENAI_MODEL_DIMENSIONS[this.model] || 1536;

		// Get API key from config or environment
		const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
		if (!apiKey) {
			throw new Error(
				"OpenAI API key is required. Set OPENAI_API_KEY environment variable or provide apiKey in config.",
			);
		}

		this.client = createOpenAI({ apiKey });

		// Initialize cache if enabled
		if (config.cacheEnabled !== false) {
			const cacheDir = config.cacheDir || ".cache/embeddings";
			this.cache = new EmbeddingCache(cacheDir, `openai:${this.model}`);
		} else {
			this.cache = null;
		}
	}

	async embed(text: string): Promise<EmbeddingResult> {
		// Check cache first
		if (this.cache) {
			const cached = this.cache.get(text);
			if (cached) {
				return {
					vector: cached.vector,
					tokenCount: cached.tokenCount,
					fromCache: true,
				};
			}
		}

		// Call OpenAI API
		const result = await embed({
			model: this.client.textEmbeddingModel(this.model),
			value: text,
		});

		this.apiCalls++;
		const tokenCount = result.usage?.tokens;
		if (tokenCount) {
			this.totalTokens += tokenCount;
		}

		// Cache the result
		if (this.cache) {
			this.cache.set(text, result.embedding, tokenCount);
		}

		return {
			vector: result.embedding,
			tokenCount,
			fromCache: false,
		};
	}

	async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
		if (texts.length === 0) {
			return { embeddings: [], totalTokens: 0, cacheHits: 0, apiCalls: 0 };
		}

		const results: EmbeddingResult[] = new Array(texts.length);
		const textsToEmbed: { index: number; text: string }[] = [];
		let cacheHits = 0;

		// Check cache for each text
		for (let i = 0; i < texts.length; i++) {
			const text = texts[i]!;
			if (this.cache) {
				const cached = this.cache.get(text);
				if (cached) {
					results[i] = { vector: cached.vector, tokenCount: cached.tokenCount, fromCache: true };
					cacheHits++;
					continue;
				}
			}
			textsToEmbed.push({ index: i, text });
		}

		// Batch embed uncached texts
		let batchTokens = 0;
		let apiCallsMade = 0;

		if (textsToEmbed.length > 0) {
			const BATCH_SIZE = 100; // OpenAI limit

			for (let i = 0; i < textsToEmbed.length; i += BATCH_SIZE) {
				const batch = textsToEmbed.slice(i, i + BATCH_SIZE);
				const batchTexts = batch.map((item) => item.text);

				const result = await embedMany({
					model: this.client.textEmbeddingModel(this.model),
					values: batchTexts,
				});

				apiCallsMade++;
				this.apiCalls++;

				const tokens = result.usage?.tokens || 0;
				batchTokens += tokens;
				this.totalTokens += tokens;

				const tokensPerItem = tokens / batch.length;

				for (let j = 0; j < batch.length; j++) {
					const item = batch[j]!;
					const embedding = result.embeddings[j]!;
					const itemTokens = Math.round(tokensPerItem);

					results[item.index] = { vector: embedding, tokenCount: itemTokens, fromCache: false };

					if (this.cache) {
						this.cache.set(item.text, embedding, itemTokens);
					}
				}
			}
		}

		return { embeddings: results, totalTokens: batchTokens, cacheHits, apiCalls: apiCallsMade };
	}

	getStats(): EmbeddingStats {
		const cacheStats = this.cache?.getStats() || { hits: 0, misses: 0 };
		return {
			apiCalls: this.apiCalls,
			totalTokens: this.totalTokens,
			cacheHits: cacheStats.hits,
			cacheMisses: cacheStats.misses,
		};
	}

	resetStats(): void {
		this.apiCalls = 0;
		this.totalTokens = 0;
		this.cache?.resetStats();
	}
}

// ============================================================================
// Voyage Embedding Provider
// ============================================================================

/**
 * Default dimensions for Voyage embedding models.
 */
const VOYAGE_MODEL_DIMENSIONS: Record<string, number> = {
	"voyage-code-3": 1024,
	"voyage-3": 1024,
	"voyage-3-lite": 512,
	"voyage-code-2": 1536,
	"voyage-2": 1024,
};

/**
 * Voyage API response types.
 */
interface VoyageEmbeddingResponse {
	object: "list";
	data: Array<{
		object: "embedding";
		embedding: number[];
		index: number;
	}>;
	model: string;
	usage: {
		total_tokens: number;
	};
}

/**
 * Voyage AI embedding provider implementation.
 *
 * Uses Voyage's REST API directly via fetch.
 * Supports voyage-code-3, voyage-3, voyage-3-lite, etc.
 *
 * API Reference: https://docs.voyageai.com/reference/embeddings-api
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
	readonly provider = "voyage";
	readonly model: string;
	readonly dimensions: number;

	private readonly apiKey: string;
	private readonly cache: EmbeddingCache | null;
	private apiCalls = 0;
	private totalTokens = 0;

	private static readonly API_URL = "https://api.voyageai.com/v1/embeddings";

	constructor(config: EmbeddingProviderConfig) {
		this.model = config.model || "voyage-code-3";
		this.dimensions = config.dimensions || VOYAGE_MODEL_DIMENSIONS[this.model] || 1024;

		// Get API key from config or environment
		const apiKey = config.apiKey || process.env.VOYAGE_API_KEY;
		if (!apiKey) {
			throw new Error(
				"Voyage API key is required. Set VOYAGE_API_KEY environment variable or provide apiKey in config.",
			);
		}
		this.apiKey = apiKey;

		// Initialize cache if enabled
		if (config.cacheEnabled !== false) {
			const cacheDir = config.cacheDir || ".cache/embeddings";
			this.cache = new EmbeddingCache(cacheDir, `voyage:${this.model}`);
		} else {
			this.cache = null;
		}
	}

	async embed(text: string): Promise<EmbeddingResult> {
		// Check cache first
		if (this.cache) {
			const cached = this.cache.get(text);
			if (cached) {
				return { vector: cached.vector, tokenCount: cached.tokenCount, fromCache: true };
			}
		}

		// Call Voyage API
		const response = await this.callApi([text]);

		this.apiCalls++;
		this.totalTokens += response.usage.total_tokens;

		const embedding = response.data[0]!.embedding;

		// Cache the result
		if (this.cache) {
			this.cache.set(text, embedding, response.usage.total_tokens);
		}

		return { vector: embedding, tokenCount: response.usage.total_tokens, fromCache: false };
	}

	async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
		if (texts.length === 0) {
			return { embeddings: [], totalTokens: 0, cacheHits: 0, apiCalls: 0 };
		}

		const results: EmbeddingResult[] = new Array(texts.length);
		const textsToEmbed: { index: number; text: string }[] = [];
		let cacheHits = 0;

		// Check cache for each text
		for (let i = 0; i < texts.length; i++) {
			const text = texts[i]!;
			if (this.cache) {
				const cached = this.cache.get(text);
				if (cached) {
					results[i] = { vector: cached.vector, tokenCount: cached.tokenCount, fromCache: true };
					cacheHits++;
					continue;
				}
			}
			textsToEmbed.push({ index: i, text });
		}

		// Batch embed uncached texts
		let batchTokens = 0;
		let apiCallsMade = 0;

		if (textsToEmbed.length > 0) {
			const BATCH_SIZE = 128; // Voyage limit

			for (let i = 0; i < textsToEmbed.length; i += BATCH_SIZE) {
				const batch = textsToEmbed.slice(i, i + BATCH_SIZE);
				const batchTexts = batch.map((item) => item.text);

				const response = await this.callApi(batchTexts);

				apiCallsMade++;
				this.apiCalls++;
				batchTokens += response.usage.total_tokens;
				this.totalTokens += response.usage.total_tokens;

				const tokensPerItem = response.usage.total_tokens / batch.length;

				for (const item of response.data) {
					const originalIndex = batch[item.index]!.index;
					const embedding = item.embedding;
					const itemTokens = Math.round(tokensPerItem);

					results[originalIndex] = { vector: embedding, tokenCount: itemTokens, fromCache: false };

					if (this.cache) {
						this.cache.set(batch[item.index]!.text, embedding, itemTokens);
					}
				}
			}
		}

		return { embeddings: results, totalTokens: batchTokens, cacheHits, apiCalls: apiCallsMade };
	}

	getStats(): EmbeddingStats {
		const cacheStats = this.cache?.getStats() || { hits: 0, misses: 0 };
		return {
			apiCalls: this.apiCalls,
			totalTokens: this.totalTokens,
			cacheHits: cacheStats.hits,
			cacheMisses: cacheStats.misses,
		};
	}

	resetStats(): void {
		this.apiCalls = 0;
		this.totalTokens = 0;
		this.cache?.resetStats();
	}

	/**
	 * Call the Voyage API.
	 */
	private async callApi(texts: string[]): Promise<VoyageEmbeddingResponse> {
		const response = await fetch(VoyageEmbeddingProvider.API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.model,
				input: texts,
				input_type: "document",
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Voyage API error (${response.status}): ${errorText}`);
		}

		return (await response.json()) as VoyageEmbeddingResponse;
	}
}

// ============================================================================
// Factory (Registry-based)
// ============================================================================

import {
	getEmbeddingProviderRegistry,
	registerEmbeddingProvider,
} from "./registry.ts";

// Register built-in providers
registerEmbeddingProvider({
	name: "openai",
	factory: (config) => new OpenAIEmbeddingProvider(config),
});

registerEmbeddingProvider({
	name: "voyage",
	aliases: ["voyageai"],
	factory: (config) => new VoyageEmbeddingProvider(config),
});

/**
 * Create an embedding provider from configuration.
 * Uses registry-based dispatch for extensibility.
 */
export function createEmbeddingProvider(config: EmbeddingProviderConfig): EmbeddingProvider {
	return getEmbeddingProviderRegistry().create(config);
}

/**
 * Create an embedding provider from ProviderConfig.local.embedding.
 *
 * This is a convenience function for chunker adapters that receive
 * embedding configuration via the provider YAML config.
 */
export function createEmbeddingProviderFromYaml(
	embeddingConfig: { provider?: string; model?: string; dimensions?: number } | undefined,
): EmbeddingProvider {
	const provider = embeddingConfig?.provider || "openai";
	const model = embeddingConfig?.model || (provider === "openai" ? "text-embedding-3-small" : "voyage-code-3");

	return createEmbeddingProvider({
		provider,
		model,
		dimensions: embeddingConfig?.dimensions,
	});
}
