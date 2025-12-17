/**
 * Metrics calculation for benchmark evaluation.
 */

import type { EvalResult, SearchResult } from "./config.ts";

export interface MetricResult {
	name: string;
	value: number;
	details?: Record<string, unknown>;
}

export interface MetricsReport {
	accuracy: number;
	metrics: MetricResult[];
	byQuestionType?: Record<string, number>;
	byCategory?: Record<string, number>;
}

/**
 * Calculate accuracy from evaluation results.
 */
export function calculateAccuracy(results: EvalResult[]): number {
	if (results.length === 0) {
		return 0;
	}
	const correct = results.filter((r) => r.correct).length;
	return correct / results.length;
}

/**
 * Calculate accuracy grouped by question type.
 */
export function calculateAccuracyByQuestionType(
	results: EvalResult[],
): Record<string, number> {
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

	const accuracies: Record<string, number> = {};
	for (const [type, counts] of Object.entries(byType)) {
		accuracies[type] = counts.total > 0 ? counts.correct / counts.total : 0;
	}

	return accuracies;
}

/**
 * Calculate accuracy grouped by category.
 */
export function calculateAccuracyByCategory(
	results: EvalResult[],
): Record<string, number> {
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

	const accuracies: Record<string, number> = {};
	for (const [cat, counts] of Object.entries(byCategory)) {
		accuracies[cat] = counts.total > 0 ? counts.correct / counts.total : 0;
	}

	return accuracies;
}

/**
 * Calculate recall@k for retrieval results.
 * Measures what fraction of relevant items are retrieved in top k.
 */
export function calculateRecallAtK(
	results: EvalResult[],
	k: number = 5,
): number {
	if (results.length === 0) {
		return 0;
	}

	let totalRecall = 0;

	for (const result of results) {
		const retrievedContext = result.retrievedContext.slice(0, k);
		const expected = result.expected.toLowerCase();

		// Check if any retrieved context contains the expected answer
		const hasRelevant = retrievedContext.some((ctx) =>
			ctx.content.toLowerCase().includes(expected),
		);

		if (hasRelevant) {
			totalRecall++;
		}
	}

	return totalRecall / results.length;
}

/**
 * Calculate precision@k for retrieval results.
 * Measures what fraction of retrieved items are relevant.
 */
export function calculatePrecisionAtK(
	results: EvalResult[],
	k: number = 5,
): number {
	if (results.length === 0) {
		return 0;
	}

	let totalPrecision = 0;

	for (const result of results) {
		const retrievedContext = result.retrievedContext.slice(0, k);
		const expected = result.expected.toLowerCase();

		if (retrievedContext.length === 0) {
			continue;
		}

		// Count how many retrieved contexts are relevant
		const relevantCount = retrievedContext.filter((ctx) =>
			ctx.content.toLowerCase().includes(expected),
		).length;

		totalPrecision += relevantCount / retrievedContext.length;
	}

	return totalPrecision / results.length;
}

/**
 * Calculate mean reciprocal rank (MRR).
 * The average of 1/rank for the first relevant result.
 */
export function calculateMRR(results: EvalResult[]): number {
	if (results.length === 0) {
		return 0;
	}

	let totalRR = 0;

	for (const result of results) {
		const expected = result.expected.toLowerCase();

		// Find rank of first relevant result
		const rank = result.retrievedContext.findIndex((ctx) =>
			ctx.content.toLowerCase().includes(expected),
		);

		if (rank !== -1) {
			totalRR += 1 / (rank + 1);
		}
	}

	return totalRR / results.length;
}

/**
 * Calculate average retrieval score.
 */
export function calculateAvgRetrievalScore(results: EvalResult[]): number {
	if (results.length === 0) {
		return 0;
	}

	let totalScore = 0;
	let count = 0;

	for (const result of results) {
		for (const ctx of result.retrievedContext) {
			totalScore += ctx.score;
			count++;
		}
	}

	return count > 0 ? totalScore / count : 0;
}

/**
 * Calculate all metrics for a set of results.
 */
export function calculateAllMetrics(
	results: EvalResult[],
	metricsToCalculate: string[] = ["accuracy"],
): MetricsReport {
	const metrics: MetricResult[] = [];

	const accuracy = calculateAccuracy(results);
	metrics.push({ name: "accuracy", value: accuracy });

	for (const metricName of metricsToCalculate) {
		switch (metricName) {
			case "accuracy":
				// Already added
				break;

			case "accuracy_by_question_type": {
				const byType = calculateAccuracyByQuestionType(results);
				metrics.push({
					name: "accuracy_by_question_type",
					value: Object.values(byType).reduce((a, b) => a + b, 0) / Object.keys(byType).length || 0,
					details: byType,
				});
				break;
			}

			case "accuracy_by_category": {
				const byCat = calculateAccuracyByCategory(results);
				metrics.push({
					name: "accuracy_by_category",
					value: Object.values(byCat).reduce((a, b) => a + b, 0) / Object.keys(byCat).length || 0,
					details: byCat,
				});
				break;
			}

			case "recall_at_5":
				metrics.push({
					name: "recall_at_5",
					value: calculateRecallAtK(results, 5),
				});
				break;

			case "recall_at_10":
				metrics.push({
					name: "recall_at_10",
					value: calculateRecallAtK(results, 10),
				});
				break;

			case "precision_at_5":
				metrics.push({
					name: "precision_at_5",
					value: calculatePrecisionAtK(results, 5),
				});
				break;

			case "precision_at_10":
				metrics.push({
					name: "precision_at_10",
					value: calculatePrecisionAtK(results, 10),
				});
				break;

			case "mrr":
				metrics.push({
					name: "mrr",
					value: calculateMRR(results),
				});
				break;

			case "avg_retrieval_score":
				metrics.push({
					name: "avg_retrieval_score",
					value: calculateAvgRetrievalScore(results),
				});
				break;
		}
	}

	return {
		accuracy,
		metrics,
		byQuestionType: calculateAccuracyByQuestionType(results),
		byCategory: calculateAccuracyByCategory(results),
	};
}

