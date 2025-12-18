/**
 * Accuracy by category metric calculator.
 * Groups results by category and calculates accuracy for each.
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

export class AccuracyByCategoryMetric implements MetricCalculator {
	readonly name = "accuracy_by_category";
	readonly aliases = ["acc_by_cat"] as const;
	readonly description = "Accuracy grouped by category";

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return {
				name: this.name,
				value: 0,
				details: {},
			};
		}

		const byCategory: Record<string, { correct: number; total: number }> = {};

		for (const result of results) {
			const category = (result.metadata?.category as string) ?? "unknown";

			if (!byCategory[category]) {
				byCategory[category] = { correct: 0, total: 0 };
			}

			byCategory[category].total++;
			if (result.correct) {
				byCategory[category].correct++;
			}
		}

		// Calculate accuracy per category
		const accuracies: Record<string, number> = {};
		for (const [cat, counts] of Object.entries(byCategory)) {
			accuracies[cat] = counts.total > 0 ? counts.correct / counts.total : 0;
		}

		// Average accuracy across categories (macro average)
		const catCount = Object.keys(accuracies).length;
		const avgAccuracy =
			catCount > 0
				? Object.values(accuracies).reduce((a, b) => a + b, 0) / catCount
				: 0;

		return {
			name: this.name,
			value: avgAccuracy,
			details: accuracies,
		};
	}
}
