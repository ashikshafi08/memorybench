/**
 * F1 Score metric calculator.
 *
 * Token-level F1 score measuring the harmonic mean of precision and recall
 * based on token overlap between predicted and expected answers.
 *
 * Reference: LongMemEval, LoCoMo, SQuAD evaluation
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";
import { tokenize, computeTokenF1 } from "./utils.ts";

/**
 * Token-level F1 Score metric.
 */
export class F1Metric implements MetricCalculator {
	readonly name = "f1";
	readonly aliases = ["f1_score", "token_f1"] as const;
	readonly description =
		"Token-level F1 score between predicted and expected answers";

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		let totalF1 = 0;
		let totalPrecision = 0;
		let totalRecall = 0;

		for (const result of results) {
			const predictedTokens = tokenize(result.actual);
			const expectedTokens = tokenize(result.expected);
			const { f1, precision, recall } = computeTokenF1(predictedTokens, expectedTokens);

			totalF1 += f1;
			totalPrecision += precision;
			totalRecall += recall;
		}

		return {
			name: this.name,
			value: totalF1 / results.length,
			details: {
				avgPrecision: totalPrecision / results.length,
				avgRecall: totalRecall / results.length,
				count: results.length,
			},
		};
	}
}
