/**
 * Mean Reciprocal Rank (MRR) metric calculator.
 *
 * ⚠️ RETRIEVAL BENCHMARKS ONLY - NOT RECOMMENDED FOR MEMORY BENCHMARKS ⚠️
 *
 * MRR measures the average of 1/rank for the first relevant result,
 * where relevance is determined by exact substring matching.
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

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalRR = 0;

		for (const result of results) {
			const expected = result.expected.toLowerCase();

			// Find rank of first relevant result (0-indexed)
			const rank = result.retrievedContext.findIndex((ctx) =>
				ctx.content.toLowerCase().includes(expected),
			);

			if (rank !== -1) {
				// rank is 0-indexed, so add 1 for reciprocal
				totalRR += 1 / (rank + 1);
			}
		}

		return {
			name: this.name,
			value: totalRR / results.length,
		};
	}
}
