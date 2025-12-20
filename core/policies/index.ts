/**
 * Retrieval Policies
 *
 * Implements different retrieval strategies:
 * - 1-hop: Single query, return top-K (baseline)
 * - H-hop: Multi-hop with query expansion (tests chunker + policy synergy)
 */

export {
	type MultiHopConfig,
	type MultiHopStats,
	type PolicyType,
	type ScoredChunk,
	DEFAULT_MULTI_HOP_CONFIG,
	multiHopRetrieve,
	singleHopRetrieve,
	executePolicy,
	extractExpansionQueries,
} from "./multi-hop.ts";

