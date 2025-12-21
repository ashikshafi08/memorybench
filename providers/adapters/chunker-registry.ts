/**
 * Chunker Registry
 *
 * Registry-based chunker dispatch for code retrieval benchmarks.
 * Instead of separate adapter classes for each chunker, we register
 * chunker functions that can be looked up by name (config.name).
 *
 * Adding a new chunker requires:
 * 1. Add registerChunker() call below (~15 lines)
 * 2. Add providerByNameRegistry.set() in factory.ts (~1 line)
 *
 * This replaces 4 separate adapter files (~548 lines) with one registry (~120 lines).
 */

import type { ChonkieChunkResult } from "./chonkie-bridge.ts";
import type { LlamaIndexChunkResult } from "./llamaindex-bridge.ts";
import type { LangChainChunkResult } from "./langchain-bridge.ts";

/**
 * Result of chunking a file.
 */
export interface ChunkResult {
	/** Chunk text content */
	content: string;
	/** Start line (1-indexed) */
	startLine?: number;
	/** End line (1-indexed, inclusive) */
	endLine?: number;
	/** Optional custom chunk ID (preserves backward compatibility) */
	id?: string;
}

/**
 * Configuration for chunking (from provider.local.chunking).
 */
export interface ChunkingConfig {
	size?: number;
	overlap?: number;
	strategy?: string;
}

/**
 * Chunker definition registered in the registry.
 */
export interface ChunkerDefinition {
	/** Chunker name (matches config.name) */
	name: string;
	/** Async function to chunk content */
	chunkFn: (
		content: string,
		filepath: string,
		config: ChunkingConfig,
	) => Promise<ChunkResult[]>;
	/** Optional preflight check (e.g., verify Python deps for Chonkie) */
	preflight?: () => Promise<void>;
}

/**
 * Registry of available chunkers.
 */
const CHUNKERS = new Map<string, ChunkerDefinition>();

/**
 * Register a chunker in the registry.
 */
export function registerChunker(def: ChunkerDefinition): void {
	CHUNKERS.set(def.name, def);
}

/**
 * Get a chunker by name.
 */
export function getChunker(name: string): ChunkerDefinition | undefined {
	return CHUNKERS.get(name);
}

/**
 * Get all registered chunker names.
 */
export function getChunkerNames(): string[] {
	return [...CHUNKERS.keys()];
}

// ============================================================================
// Built-in Chunkers
// ============================================================================

/**
 * code-chunk AST chunker
 * Uses tree-sitter parsing for semantic code chunking.
 */
registerChunker({
	name: "code-chunk-ast",
	chunkFn: async (content, filepath, config) => {
		try {
			// Dynamic import to handle missing package gracefully
			const { chunk } = await import("code-chunk" as string);
			const chunks = await chunk(filepath, content, {
				maxChunkSize: config.size ?? 1500,
			});
			return chunks.map(
				(c: { contextualizedText: string; lineRange: { start: number; end: number } }) => ({
					content: c.contextualizedText,
					startLine: c.lineRange.start,
					endLine: c.lineRange.end,
					id: `${filepath}:${c.lineRange.start}-${c.lineRange.end}`,
				}),
			);
		} catch (error) {
			// FALLBACK: Use fixed chunking instead of returning entire file
			// This handles unsupported languages, malformed syntax, missing package, etc.
			// Using fixedChunk ensures we never exceed embedding token limits
			console.warn(`[code-chunk-ast] AST parsing failed for ${filepath}, using fixed chunking fallback: ${error}`);
			const size = config.size ?? 1500;
			const overlap = Math.min(96, Math.floor(size * 0.1)); // 10% overlap, max 96 chars
			return fixedChunk(content, filepath, size, overlap);
		}
	},
});

/**
 * code-chunk fixed chunker
 * Fixed-size character windows with overlap. Baseline for comparison.
 */
registerChunker({
	name: "code-chunk-fixed",
	chunkFn: async (content, filepath, config) => {
		const size = config.size ?? 1024;
		const overlap = config.overlap ?? 96;

		// Preserve original validation
		if (overlap >= size) {
			throw new Error(
				`Overlap (${overlap}) must be less than chunk size (${size})`,
			);
		}

		return fixedChunk(content, filepath, size, overlap);
	},
});

/**
 * Chonkie code chunker
 * Python-based semantic chunker using tree-sitter.
 */
registerChunker({
	name: "chonkie-code",
	preflight: async () => {
		const { isChonkieAvailable } = await import("./chonkie-bridge.ts");
		const pythonPath = process.env.CHONKIE_PYTHON_PATH || "python3";
		if (!(await isChonkieAvailable(pythonPath))) {
			throw new Error(
				"Chonkie not available. Install with: pip install chonkie tree-sitter-language-pack",
			);
		}
	},
	chunkFn: async (content, filepath, config) => {
		const { callChonkie } = await import("./chonkie-bridge.ts");
		const chunks = await callChonkie(filepath, content, {
			chunkerType: "code",
			chunkSize: config.size ?? 1500,
		});
		return chunks.map((c: ChonkieChunkResult) => ({
			content: c.text,
			startLine: c.startLine,
			endLine: c.endLine,
			id: c.id,
		}));
	},
});

/**
 * Chonkie recursive chunker
 * Python-based character chunker with overlap. Baseline for comparison.
 */
registerChunker({
	name: "chonkie-recursive",
	preflight: async () => {
		const { isChonkieAvailable } = await import("./chonkie-bridge.ts");
		const pythonPath = process.env.CHONKIE_PYTHON_PATH || "python3";
		if (!(await isChonkieAvailable(pythonPath))) {
			throw new Error(
				"Chonkie not available. Install with: pip install chonkie tree-sitter-language-pack",
			);
		}
	},
	chunkFn: async (content, filepath, config) => {
		const { callChonkie } = await import("./chonkie-bridge.ts");
		const chunks = await callChonkie(filepath, content, {
			chunkerType: "recursive",
			chunkSize: config.size ?? 1500,
			overlap: config.overlap ?? 0,
		});
		return chunks.map((c: ChonkieChunkResult) => ({
			content: c.text,
			startLine: c.startLine,
			endLine: c.endLine,
			id: c.id,
		}));
	},
});

// ============================================================================
// NOTE: chonkie-semantic, chonkie-token, chonkie-sentence were removed.
// These are designed for natural language prose, NOT source code.
// For code chunking benchmarks, we only need:
//   - code-chunk-ast (AST-aware)
//   - code-chunk-fixed (baseline)
//   - chonkie-code (tree-sitter competitor)
//   - chonkie-recursive (fallback baseline)
//   - llamaindex-code (LlamaIndex CodeSplitter)
//   - langchain-code (LangChain RecursiveCharacterTextSplitter)
// ============================================================================

/**
 * LlamaIndex CodeSplitter chunker
 * Python-based semantic chunker using tree-sitter via LlamaIndex.
 */
registerChunker({
	name: "llamaindex-code",
	preflight: async () => {
		const { isLlamaIndexAvailable } = await import("./llamaindex-bridge.ts");
		const pythonPath = process.env.LLAMAINDEX_PYTHON_PATH || "python3";
		if (!(await isLlamaIndexAvailable(pythonPath))) {
			throw new Error(
				"LlamaIndex not available. Install with: pip install llama-index-core",
			);
		}
	},
	chunkFn: async (content, filepath, config) => {
		const { callLlamaIndex } = await import("./llamaindex-bridge.ts");
		const chunks = await callLlamaIndex(filepath, content, {
			chunkSize: config.size ?? 1500,
		});
		return chunks.map((c: LlamaIndexChunkResult) => ({
			content: c.text,
			startLine: c.startLine,
			endLine: c.endLine,
			id: c.id,
		}));
	},
});

/**
 * LangChain RecursiveCharacterTextSplitter chunker
 * Python-based language-aware chunker using LangChain.
 */
registerChunker({
	name: "langchain-code",
	preflight: async () => {
		const { isLangChainAvailable } = await import("./langchain-bridge.ts");
		const pythonPath = process.env.LANGCHAIN_PYTHON_PATH || "python3";
		if (!(await isLangChainAvailable(pythonPath))) {
			throw new Error(
				"LangChain not available. Install with: pip install langchain-text-splitters",
			);
		}
	},
	chunkFn: async (content, filepath, config) => {
		const { callLangChain } = await import("./langchain-bridge.ts");
		const chunks = await callLangChain(filepath, content, {
			chunkSize: config.size ?? 1500,
			overlap: config.overlap ?? 100,
		});
		return chunks.map((c: LangChainChunkResult) => ({
			content: c.text,
			startLine: c.startLine,
			endLine: c.endLine,
			id: c.id,
		}));
	},
});

// ============================================================================
// Helper Functions (moved from code-chunk-fixed.ts)
// ============================================================================

/**
 * Fixed-size chunking with line number computation.
 * Splits code into fixed-size character windows with overlap.
 */
function fixedChunk(
	content: string,
	filepath: string,
	size: number,
	overlap: number,
): ChunkResult[] {
	const chunks: ChunkResult[] = [];

	if (content.length === 0) {
		return chunks;
	}

	// Pre-compute line starts for line number calculation
	const lineStarts = computeLineStarts(content);

	let start = 0;
	const step = size - overlap;
	let chunkIndex = 0;

	while (start < content.length) {
		const end = Math.min(start + size, content.length);
		const chunkContent = content.slice(start, end);

		if (chunkContent.trim().length > 0) {
			// Calculate line numbers (1-indexed)
			const startLine = getLineNumber(lineStarts, start);
			const endLine = getLineNumber(lineStarts, end - 1);

			chunks.push({
				content: chunkContent,
				startLine,
				endLine,
				id: `${filepath}:${chunkIndex}`,
			});
			chunkIndex++;
		}

		start += step;

		// Avoid creating very small trailing chunks
		if (start < content.length && content.length - start < overlap) {
			break;
		}
	}

	return chunks;
}

/**
 * Compute the character offsets where each line starts.
 * Used for efficient line number lookups.
 */
function computeLineStarts(content: string): number[] {
	const lineStarts = [0];
	for (let i = 0; i < content.length; i++) {
		if (content[i] === "\n") {
			lineStarts.push(i + 1);
		}
	}
	return lineStarts;
}

/**
 * Get the line number (1-indexed) for a character offset.
 * Uses binary search for O(log n) lookup.
 */
function getLineNumber(lineStarts: number[], offset: number): number {
	let low = 0;
	let high = lineStarts.length - 1;

	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		if (lineStarts[mid]! <= offset) {
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	return high + 1; // 1-indexed
}
