/**
 * Normalized Discounted Cumulative Gain (nDCG) metric calculators.
 *
 * nDCG measures ranking quality by rewarding relevant items at higher positions.
 * This implementation supports three relevance determination strategies:
 *
 * 1. **Explicit qrels** (recommended for code-chunk):
 *    Uses `result.metadata.relevantIds` or `relevantChunkIds` for ground-truth.
 *
 * 2. **Pack-owned relevance** (existing memorybench pattern):
 *    Uses pack's `isRelevant()` when `pack.sealedSemantics.relevance === true`.
 *
 * 3. **Token-based fallback**:
 *    Uses token overlap + F1 threshold when no labels exist.
 *
 * References:
 * - Järvelin, K., & Kekäläinen, J. (2002). Cumulated gain-based evaluation
 *   of IR techniques. ACM TOIS, 20(4), 422-446.
 * - Used by CoIR, MTEB, BEIR benchmarks for retrieval evaluation.
 *
 * Formula:
 *   DCG@K = Σ(i=1 to K) [rel_i / log₂(i+1)]
 *   IDCG@K = DCG of perfect ranking using min(k, |relevantSet|)
 *   nDCG@K = DCG@K / IDCG@K
 */

import type { EvalResult, BenchmarkItem, SearchResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize, computeF1FromPR } from "./utils.ts";
import { getPackRegistry } from "../../../benchmarks/packs/index.ts";

/**
 * Result of per-query relevance computation.
 */
interface RelevanceInfo {
	/** Binary relevance for each retrieved item (1 = relevant, 0 = not) */
	relevanceScores: number[];
	/** Total number of relevant items in the ground truth (for IDCG) */
	totalRelevant: number;
	/** Which strategy was used */
	strategy: "qrels" | "pack" | "token-fallback";
}

/**
 * Generic nDCG@K metric calculator.
 *
 * Uses a priority-based relevance determination:
 * 1. Explicit qrels in metadata (code-chunk style)
 * 2. Pack-owned relevance (LoCoMo/LongMemEval style)
 * 3. Token-based F1 fallback
 *
 * @param k - Number of top results to consider
 * @param f1Threshold - Minimum F1 score to consider item relevant in fallback mode (default: 0.3)
 */
export class NDCGAtKMetric implements MetricCalculator {
	readonly name: string;
	readonly aliases: readonly string[];
	readonly description: string;
	private readonly k: number;
	private readonly f1Threshold: number;

	constructor(k: number, f1Threshold = 0.3) {
		this.k = k;
		this.f1Threshold = f1Threshold;
		this.name = `ndcg_at_${k}`;
		this.aliases = [`ndcg@${k}`, `ndcg_${k}`] as const;
		this.description = `Normalized Discounted Cumulative Gain at top ${k} results`;
	}

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		// Try to get pack for label-grounded relevance (if available)
		const firstResult = results[0]!;
		const benchmarkName = firstResult.benchmark;
		const packRegistry = getPackRegistry();
		const pack = packRegistry.getLatest(benchmarkName);

		let totalNDCG = 0;
		let queriesWithRelevant = 0;
		let strategyUsed: "qrels" | "pack" | "token-fallback" | "mixed" =
			"token-fallback";
		const strategyCounts = { qrels: 0, pack: 0, "token-fallback": 0 };

		for (const result of results) {
			const retrievedContext = result.retrievedContext.slice(0, this.k);

			// Compute relevance info using priority-based strategy
			const relevanceInfo = this.computeRelevance(
				result,
				retrievedContext,
				pack,
			);
			strategyCounts[relevanceInfo.strategy]++;

			const { relevanceScores, totalRelevant } = relevanceInfo;

			// Calculate DCG: Σ rel_i / log2(i + 2) for i = 0..K-1
			let dcg = 0;
			for (let i = 0; i < relevanceScores.length; i++) {
				// i is 0-indexed, so we use log2(i + 2) which equals log2(rank + 1)
				dcg += relevanceScores[i]! / Math.log2(i + 2);
			}

			// Calculate IDCG: ideal DCG with all relevant items at top
			// Use min(k, totalRelevant) to match code-chunk's formula
			const idealK = Math.min(this.k, totalRelevant);
			let idcg = 0;
			for (let i = 0; i < idealK; i++) {
				idcg += 1 / Math.log2(i + 2);
			}

			// Calculate nDCG
			const ndcg = idcg > 0 ? dcg / idcg : 0;
			totalNDCG += ndcg;

			if (totalRelevant > 0) {
				queriesWithRelevant++;
			}
		}

		// Determine predominant strategy
		if (strategyCounts.qrels > 0 && strategyCounts.pack === 0 && strategyCounts["token-fallback"] === 0) {
			strategyUsed = "qrels";
		} else if (strategyCounts.pack > 0 && strategyCounts.qrels === 0 && strategyCounts["token-fallback"] === 0) {
			strategyUsed = "pack";
		} else if (strategyCounts["token-fallback"] > 0 && strategyCounts.qrels === 0 && strategyCounts.pack === 0) {
			strategyUsed = "token-fallback";
		} else {
			strategyUsed = "mixed";
		}

		return {
			name: this.name,
			value: totalNDCG / results.length,
			details: {
				avgNDCG: totalNDCG / results.length,
				queriesWithRelevant,
				total: results.length,
				k: this.k,
				f1Threshold: this.f1Threshold,
				strategyUsed,
				strategyCounts,
			},
		};
	}

	/**
	 * Compute relevance scores and total relevant count using priority-based strategy.
	 */
	private computeRelevance(
		result: EvalResult,
		retrievedContext: SearchResult[],
		pack: ReturnType<typeof getPackRegistry>["prototype"]["getLatest"] extends (name: string) => infer R ? R : never,
	): RelevanceInfo {
		// Strategy A: Explicit qrels in metadata (code-chunk style)
		const qrels = this.extractQrels(result);
		if (qrels !== null) {
			const relevanceScores = retrievedContext.map((ctx) =>
				qrels.has(ctx.id) ? 1 : 0,
			);
			return {
				relevanceScores,
				totalRelevant: qrels.size,
				strategy: "qrels",
			};
		}

		// Strategy B: Pack-owned relevance
		if (pack && pack.sealedSemantics.relevance) {
			// Reconstruct item from result metadata (best effort)
			const item: BenchmarkItem = {
				id: result.itemId,
				question: result.question,
				answer: result.expected,
				contexts: [],
				metadata: result.metadata || {},
			};

			const relevanceScores: number[] = [];
			let relevantInTopK = 0;

			for (const ctx of retrievedContext) {
				const isRel = pack.isRelevant({ item, result: ctx }) ? 1 : 0;
				relevanceScores.push(isRel);
				if (isRel) relevantInTopK++;
			}

			// Try to infer totalRelevant from metadata (e.g., LoCoMo evidence)
			const totalRelevant = this.inferTotalRelevant(result, relevantInTopK);

			return {
				relevanceScores,
				totalRelevant,
				strategy: "pack",
			};
		}

		// Strategy C: Token-based fallback
		return this.computeTokenBasedRelevance(result, retrievedContext);
	}

	/**
	 * Extract qrels from result metadata if available.
	 * Looks for `relevantIds`, `relevantChunkIds`, or similar fields.
	 */
	private extractQrels(result: EvalResult): Set<string> | null {
		const metadata = result.metadata;
		if (!metadata) return null;

		// Check common field names for qrels
		const qrelsField =
			metadata.relevantIds ??
			metadata.relevantChunkIds ??
			metadata.groundTruthIds ??
			metadata.qrels;

		if (Array.isArray(qrelsField)) {
			const ids = qrelsField
				.map((id) => String(id).trim())
				.filter((id) => id.length > 0);
			if (ids.length > 0) {
				return new Set(ids);
			}
		}

		return null;
	}

	/**
	 * Try to infer total relevant count from metadata.
	 * Falls back to relevantInTopK if no reliable count exists.
	 */
	private inferTotalRelevant(result: EvalResult, relevantInTopK: number): number {
		const metadata = result.metadata;
		if (!metadata) return relevantInTopK;

		// LoCoMo: evidence can be single ID or array
		const evidence = metadata.evidence;
		if (evidence !== undefined) {
			if (Array.isArray(evidence)) {
				return evidence.length;
			}
			if (typeof evidence === "string" && evidence.trim()) {
				return 1;
			}
		}

		// LongMemEval: answerCorpusIds
		const answerCorpusIds = metadata.answerCorpusIds;
		if (Array.isArray(answerCorpusIds) && answerCorpusIds.length > 0) {
			return answerCorpusIds.length;
		}

		// No reliable count, fall back to what we found
		return relevantInTopK;
	}

	/**
	 * Compute relevance using token-based F1 scoring (fallback strategy).
	 */
	private computeTokenBasedRelevance(
		result: EvalResult,
		retrievedContext: SearchResult[],
	): RelevanceInfo {
		const expectedTokens = tokenize(result.expected);
		const expectedSet = new Set(expectedTokens);

		const relevanceScores: number[] = [];
		let relevantInTopK = 0;

		for (const ctx of retrievedContext) {
			const chunkTokens = tokenize(ctx.content);
			const chunkSet = new Set(chunkTokens);

			// Compute token overlap
			let overlap = 0;
			for (const token of expectedSet) {
				if (chunkSet.has(token)) overlap++;
			}

			// Calculate F1 score
			const precision = chunkSet.size > 0 ? overlap / chunkSet.size : 0;
			const recall = expectedSet.size > 0 ? overlap / expectedSet.size : 0;
			const f1 = computeF1FromPR(precision, recall);

			const isRelevant = f1 >= this.f1Threshold ? 1 : 0;
			relevanceScores.push(isRelevant);
			if (isRelevant) relevantInTopK++;
		}

		// For token-based fallback, we don't know the true totalRelevant
		// so we use relevantInTopK (this may underestimate IDCG)
		return {
			relevanceScores,
			totalRelevant: relevantInTopK,
			strategy: "token-fallback",
		};
	}
}

// Pre-built instances for common K values
export class NDCGAt5Metric extends NDCGAtKMetric {
	constructor() {
		super(5);
	}
}

export class NDCGAt10Metric extends NDCGAtKMetric {
	constructor() {
		super(10);
	}
}
