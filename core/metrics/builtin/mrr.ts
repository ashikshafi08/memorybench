/**
 * Mean Reciprocal Rank (MRR) metric calculator.
 *
 * MRR measures the average of 1/rank for the first relevant result.
 *
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
 * ⚠️ RETRIEVAL BENCHMARKS ONLY - NOT RECOMMENDED FOR MEMORY BENCHMARKS ⚠️
 *
 * Why MRR is NOT suitable for memory benchmarks:
 *   - MRR assumes a single correct item exists
 *   - MRR assumes relevance is binary and positional
 *   - Memory tasks often require synthesizing across multiple chunks
 *   - Expected answers rarely appear verbatim in retrieved context
 *
 * Use instead for memory benchmarks:
 *   - accuracy (LLM-judge correctness)
 *   - f1, bleu_1, rouge_l (answer quality)
 *   - success_at_5, success_at_10 (semantic retrieval success)
 *   - recall_at_5, recall_at_10 (context coverage)
 *
 * Appropriate use cases for MRR:
 *   - MS MARCO, Natural Questions (retrieval stage)
 *   - DPR, BEIR passage ranking
 *   - Pure retrieval benchmarks with known answer passages
 *   - Code chunk retrieval benchmarks (RepoEval, RepoBench-R, etc.)
 *
 * Formula:
 *   MRR = (1/N) * Σ (1 / rank_i)
 *   where rank_i is the position of the first relevant result for query i
 *
 * Reference: Information Retrieval literature
 */

import type { EvalResult, BenchmarkItem, SearchResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize, computeF1FromPR } from "./utils.ts";
import { getPackRegistry } from "../../../benchmarks/packs/index.ts";

/**
 * Mean Reciprocal Rank (MRR) metric.
 *
 * Uses priority-based relevance: qrels > pack > token-fallback.
 *
 * @deprecated For memory benchmarks. Use accuracy, f1, or success_at_k instead.
 */
export class MRRMetric implements MetricCalculator {
	readonly name = "mrr";
	readonly aliases = ["mean_reciprocal_rank"] as const;
	readonly description =
		"Mean Reciprocal Rank (retrieval benchmarks only) - average of 1/rank for first relevant result";
	private readonly f1Threshold: number;

	constructor(f1Threshold = 0.3) {
		this.f1Threshold = f1Threshold;
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

		let totalRR = 0;
		let foundCount = 0;
		let strategyUsed: "qrels" | "pack" | "token-fallback" | "mixed" = "token-fallback";
		const strategyCounts = { qrels: 0, pack: 0, "token-fallback": 0 };

		for (const result of results) {
			// Determine relevance strategy for this item
			const { rank, strategy } = this.findFirstRelevantRank(result, pack);
			strategyCounts[strategy]++;

			if (rank !== -1) {
				// rank is 0-indexed, so add 1 for reciprocal
				totalRR += 1 / (rank + 1);
				foundCount++;
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
			value: totalRR / results.length,
			details: {
				foundCount,
				total: results.length,
				f1Threshold: this.f1Threshold,
				strategyUsed,
				strategyCounts,
			},
		};
	}

	/**
	 * Find the rank of the first relevant result using priority-based strategy.
	 */
	private findFirstRelevantRank(
		result: EvalResult,
		pack: import("../../../benchmarks/packs/interface.ts").BenchmarkPack | undefined,
	): { rank: number; strategy: "qrels" | "pack" | "token-fallback" } {
		// Strategy A: Explicit qrels in metadata
		const qrels = this.extractQrels(result);
		if (qrels !== null) {
			const rank = result.retrievedContext.findIndex((ctx) => qrels.has(ctx.id));
			return { rank, strategy: "qrels" };
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

			const rank = result.retrievedContext.findIndex((ctx) =>
				pack.isRelevant({ item, result: ctx }),
			);
			return { rank, strategy: "pack" };
		}

		// Strategy C: Token-based F1 fallback
		const expectedTokens = tokenize(result.expected);
		const expectedSet = new Set(expectedTokens);

		const rank = result.retrievedContext.findIndex((ctx) => {
			const chunkTokens = tokenize(ctx.content);
			const chunkSet = new Set(chunkTokens);

			// Compute token overlap
			let overlap = 0;
			for (const token of expectedSet) {
				if (chunkSet.has(token)) overlap++;
			}

			// Calculate F1 score for this chunk
			const precision = chunkSet.size > 0 ? overlap / chunkSet.size : 0;
			const recall = expectedSet.size > 0 ? overlap / expectedSet.size : 0;
			const f1 = computeF1FromPR(precision, recall);

			return f1 >= this.f1Threshold;
		});

		return { rank, strategy: "token-fallback" };
	}

	/**
	 * Extract qrels from result metadata if available.
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
}
