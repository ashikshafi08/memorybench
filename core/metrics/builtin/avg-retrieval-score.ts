/**
 * Average Retrieval Score metric calculator.
 * Computes the average similarity/relevance score across all retrieved contexts.
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

export class AvgRetrievalScoreMetric implements MetricCalculator {
	readonly name = "avg_retrieval_score";
	readonly aliases = ["avg_score"] as const;
	readonly description = "Average similarity/relevance score of retrieved contexts";

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalScore = 0;
		let count = 0;

		for (const result of results) {
			for (const ctx of result.retrievedContext) {
				totalScore += ctx.score;
				count++;
			}
		}

		return {
			name: this.name,
			value: count > 0 ? totalScore / count : 0,
		};
	}
}
