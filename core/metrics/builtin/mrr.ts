/**
 * Mean Reciprocal Rank (MRR) metric calculator.
 *
 * ⚠️ RETRIEVAL BENCHMARKS ONLY - NOT RECOMMENDED FOR MEMORY BENCHMARKS ⚠️
 *
 * MRR measures the average of 1/rank for the first relevant result,
 * where relevance is determined by token-based F1 scoring (not exact matching).
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
 *
 * Formula:
 *   MRR = (1/N) * Σ (1 / rank_i)
 *   where rank_i is the position of the first relevant result for query i
 *
 * Reference: Information Retrieval literature
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize, computeF1FromPR } from "./utils.ts";

/**
 * Mean Reciprocal Rank (MRR) metric.
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

		let totalRR = 0;
		let foundCount = 0;

		for (const result of results) {
			const expectedTokens = tokenize(result.expected);

			// Find rank of first relevant result (0-indexed) using token-based F1
			const rank = result.retrievedContext.findIndex((ctx) => {
				const chunkTokens = tokenize(ctx.content);
				const expectedSet = new Set(expectedTokens);
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

			if (rank !== -1) {
				// rank is 0-indexed, so add 1 for reciprocal
				totalRR += 1 / (rank + 1);
				foundCount++;
			}
		}

		return {
			name: this.name,
			value: totalRR / results.length,
			details: {
				foundCount,
				total: results.length,
				f1Threshold: this.f1Threshold,
			},
		};
	}
}
