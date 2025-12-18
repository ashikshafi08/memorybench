/**
 * Accuracy metric calculator.
 * Measures the fraction of correct predictions.
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

export class AccuracyMetric implements MetricCalculator {
	readonly name = "accuracy";
	readonly aliases = ["acc"] as const;
	readonly description = "Fraction of correct predictions";

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		const correct = results.filter((r) => r.correct).length;
		const accuracy = correct / results.length;

		return {
			name: this.name,
			value: accuracy,
		};
	}
}
