/**
 * Multi-Hop Retrieval Policy (Phase 9A)
 *
 * Implements the H-hop retrieval strategy that expands queries based on
 * retrieved chunk content. This tests chunker + retrieval synergy.
 *
 * Budget-controlled: Multi-hop uses the same total budget as single-hop
 * for fair comparison (e.g., 15 total chunks seen).
 *
 * Reference: docs/PHASE_9_MULTI_HOP_BENCHMARK.md
 */

import type { SearchResult } from "../config.ts";

export interface MultiHopConfig {
	/** Maximum number of retrieval hops (default: 2) */
	maxHops: number;
	/** Chunks to retrieve per hop (default: 5) */
	chunksPerHop: number;
	/** Total budget of chunks to consider (for fair comparison) */
	totalBudget: number;
	/** Expansion method - 'text' is fair to all chunkers */
	expansionMethod: "text";
}

export const DEFAULT_MULTI_HOP_CONFIG: MultiHopConfig = {
	maxHops: 2,
	chunksPerHop: 5,
	totalBudget: 15,
	expansionMethod: "text",
};

export interface MultiHopStats {
	totalHops: number;
	chunksPerHop: number[];
	embeddingCalls: number;
	uniqueChunks: number;
}

export interface ScoredChunk extends SearchResult {
	hop: number;
}

/**
 * Extract expansion queries from chunk text.
 * Uses simple heuristics to find identifiers, function names, imports.
 * This is fair to all chunkers since it only looks at text content.
 */
export function extractExpansionQueries(chunks: SearchResult[]): string[] {
	const queries: string[] = [];

	for (const chunk of chunks) {
		const content = chunk.content;

		// Extract import statements (Python)
		const importMatches = content.match(/(?:from\s+(\S+)\s+)?import\s+(\S+)/g);
		if (importMatches) {
			for (const match of importMatches) {
				// Get the module or function being imported
				const parts = match.replace(/from\s+/, "").replace(/import\s+/, " ").trim();
				queries.push(parts);
			}
		}

		// Extract function/method calls (simple heuristic)
		const callMatches = content.match(/\b([a-zA-Z_]\w*)\s*\(/g);
		if (callMatches) {
			for (const match of callMatches) {
				const funcName = match.replace(/\s*\($/, "");
				// Skip common builtins and short names
				if (funcName.length > 3 && !["print", "range", "list", "dict", "tuple", "self"].includes(funcName)) {
					queries.push(funcName);
				}
			}
		}

		// Extract class references
		const classMatches = content.match(/class\s+([A-Z]\w+)/g);
		if (classMatches) {
			for (const match of classMatches) {
				queries.push(match.replace(/class\s+/, ""));
			}
		}
	}

	// Deduplicate and limit
	return [...new Set(queries)].slice(0, 5);
}

/**
 * Multi-hop retrieval executor.
 *
 * @param query - Initial query
 * @param searchFn - Search function (provider.searchQuery)
 * @param k - Final number of results to return
 * @param config - Multi-hop configuration
 * @returns Top-K chunks with stats
 */
export async function multiHopRetrieve(
	query: string,
	searchFn: (q: string, opts: { limit: number }) => Promise<SearchResult[]>,
	k: number,
	config: MultiHopConfig = DEFAULT_MULTI_HOP_CONFIG,
): Promise<{ results: SearchResult[]; stats: MultiHopStats }> {
	const seen = new Set<string>();
	const allChunks: ScoredChunk[] = [];
	let currentQueries = [query];
	let budgetRemaining = config.totalBudget;
	const chunksPerHop: number[] = [];
	let embeddingCalls = 0;

	for (let hop = 0; hop < config.maxHops && budgetRemaining > 0; hop++) {
		const hopLimit = Math.min(config.chunksPerHop, budgetRemaining);
		let hopChunks = 0;

		for (const q of currentQueries) {
			if (budgetRemaining <= 0) break;

			embeddingCalls++;
			const chunks = await searchFn(q, { limit: hopLimit });

			for (const chunk of chunks) {
				const chunkId = chunk.id ?? `${chunk.metadata?.filepath}:${chunk.metadata?.startLine}`;
				if (!seen.has(chunkId)) {
					seen.add(chunkId);
					allChunks.push({ ...chunk, hop });
					budgetRemaining--;
					hopChunks++;
				}
			}
		}

		chunksPerHop.push(hopChunks);

		// Text-only expansion (fair to all chunkers)
		if (hop < config.maxHops - 1 && budgetRemaining > 0) {
			const recentChunks = allChunks.filter((c) => c.hop === hop);
			currentQueries = extractExpansionQueries(recentChunks);

			// If no expansion queries, stop early
			if (currentQueries.length === 0) break;
		}
	}

	// Return top-K by original relevance score
	const topK = allChunks
		.sort((a, b) => b.score - a.score)
		.slice(0, k);

	return {
		results: topK,
		stats: {
			totalHops: chunksPerHop.length,
			chunksPerHop,
			embeddingCalls,
			uniqueChunks: allChunks.length,
		},
	};
}

/**
 * Single-hop retrieval (baseline).
 * Just wraps the search function for consistency.
 */
export async function singleHopRetrieve(
	query: string,
	searchFn: (q: string, opts: { limit: number }) => Promise<SearchResult[]>,
	k: number,
): Promise<{ results: SearchResult[]; stats: MultiHopStats }> {
	const results = await searchFn(query, { limit: k });

	return {
		results,
		stats: {
			totalHops: 1,
			chunksPerHop: [results.length],
			embeddingCalls: 1,
			uniqueChunks: results.length,
		},
	};
}

export type PolicyType = "1-hop" | "H-hop";

/**
 * Execute retrieval with specified policy.
 */
export async function executePolicy(
	policy: PolicyType,
	query: string,
	searchFn: (q: string, opts: { limit: number }) => Promise<SearchResult[]>,
	k: number,
	config?: Partial<MultiHopConfig>,
): Promise<{ results: SearchResult[]; stats: MultiHopStats }> {
	if (policy === "1-hop") {
		return singleHopRetrieve(query, searchFn, k);
	} else {
		return multiHopRetrieve(query, searchFn, k, {
			...DEFAULT_MULTI_HOP_CONFIG,
			...config,
		});
	}
}

