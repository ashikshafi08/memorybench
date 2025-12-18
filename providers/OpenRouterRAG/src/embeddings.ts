import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { embedMany } from "ai";

const openrouter = createOpenRouter({
	apiKey: process.env.OPENROUTER_API_KEY,
});

/**
 * Generate embeddings using OpenRouter's text-embedding-3-small model
 * @param texts - Array of texts to embed
 * @returns Array of embedding vectors
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
	try {
		// OpenRouter supports embeddings but the SDK types may not include textEmbeddingModel
		// Use type assertion to access the embedding model method
		const provider = openrouter as any;
		const { embeddings } = await embedMany({
			model: provider.textEmbeddingModel("openai/text-embedding-3-small"),
			values: texts,
		});

		return embeddings;
	} catch (error) {
		console.error("Failed to generate embeddings:", error);
		throw new Error("Failed to generate embeddings");
	}
}

/**
 * Simple text chunking by character count with overlap
 */
export function chunkText(
	text: string,
	chunkSize: number = 512,
	overlap: number = 128,
): string[] {
	const chunks: string[] = [];
	let start = 0;

	while (start < text.length) {
		const end = Math.min(start + chunkSize, text.length);
		const chunk = text.slice(start, end);

		if (chunk.trim().length > 0) {
			chunks.push(chunk.trim());
		}

		start += chunkSize - overlap;
	}

	return chunks;
}
