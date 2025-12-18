/**
 * Accuracy by question type metric calculator.
 * Groups results by question type and calculates accuracy for each.
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

export class AccuracyByQuestionTypeMetric implements MetricCalculator {
	readonly name = "accuracy_by_question_type";
	readonly aliases = ["acc_by_type"] as const;
	readonly description = "Accuracy grouped by question type";

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return {
				name: this.name,
				value: 0,
				details: {},
			};
		}

		const byType: Record<string, { correct: number; total: number }> = {};

		for (const result of results) {
			const questionType =
				(result.metadata?.questionType as string) ?? "unknown";

			if (!byType[questionType]) {
				byType[questionType] = { correct: 0, total: 0 };
			}

			byType[questionType].total++;
			if (result.correct) {
				byType[questionType].correct++;
			}
		}

		// Calculate accuracy per type
		const accuracies: Record<string, number> = {};
		for (const [type, counts] of Object.entries(byType)) {
			accuracies[type] = counts.total > 0 ? counts.correct / counts.total : 0;
		}

		// Average accuracy across types (macro average)
		const typeCount = Object.keys(accuracies).length;
		const avgAccuracy =
			typeCount > 0
				? Object.values(accuracies).reduce((a, b) => a + b, 0) / typeCount
				: 0;

		return {
			name: this.name,
			value: avgAccuracy,
			details: accuracies,
		};
	}
}
