/**
 * Abstention Accuracy metric calculator.
 * Measures accuracy specifically for unanswerable questions (abstention cases).
 * 
 * For LongMemEval: questions with `_abs` in question_id
 * For LoCoMo: category 5 (adversarial) questions
 */

import type { EvalResult } from "../../config.ts";
import type { MetricCalculator, MetricResult } from "../interface.ts";

export class AbstentionAccuracyMetric implements MetricCalculator {
	readonly name = "abstention_accuracy";
	readonly aliases = ["abstention_acc", "abst_acc"] as const;
	readonly description = "Accuracy on abstention/unanswerable questions";

	compute(results: EvalResult[]): MetricResult {
		if (results.length === 0) {
			return { name: this.name, value: 0 };
		}

		// Filter to abstention cases
		const abstentionResults = results.filter((r) => {
			// LongMemEval: question_id contains "_abs"
			if (r.itemId.includes("_abs")) {
				return true;
			}
			
			// LoCoMo: category 5 (adversarial)
			const categoryId = r.metadata?.categoryId as number | undefined;
			if (categoryId === 5) {
				return true;
			}
			
			// Check metadata for explicit abstention flag
			if (r.metadata?.isAbstention === true) {
				return true;
			}
			
			return false;
		});

		if (abstentionResults.length === 0) {
			return {
				name: this.name,
				value: 0,
				details: {
					total: 0,
					message: "No abstention cases found in results",
				},
			};
		}

		const correct = abstentionResults.filter((r) => r.correct).length;
		const accuracy = correct / abstentionResults.length;

		return {
			name: this.name,
			value: accuracy,
			details: {
				correct,
				total: abstentionResults.length,
				abstentionCases: abstentionResults.map((r) => ({
					itemId: r.itemId,
					correct: r.correct,
					score: r.score,
				})),
			},
		};
	}
}

