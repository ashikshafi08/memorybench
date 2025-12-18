/**
 * Metrics module - exports registry, interfaces, and built-in metrics.
 *
 * This module provides a pluggable metric system inspired by OpenBench.
 * Metrics are registered once at startup and can be computed on-demand.
 */

// Re-export types and interfaces
export * from "./interface.ts";
export * from "./registry.ts";
export * from "./builtin/index.ts";

import { MetricRegistry } from "./registry.ts";
import { getBuiltinMetrics } from "./builtin/index.ts";
import type { EvalResult } from "../config.ts";
import type { MetricResult } from "./interface.ts";
import { tokenize, computeF1FromPR } from "./builtin/utils.ts";

// Global default registry instance
let _defaultRegistry: MetricRegistry | null = null;

/**
 * Get the default metric registry with all built-in metrics registered.
 * This is a singleton - the same registry is returned on subsequent calls.
 */
export function getDefaultRegistry(): MetricRegistry {
	if (!_defaultRegistry) {
		_defaultRegistry = new MetricRegistry();

		// Register all built-in metrics
		for (const metric of getBuiltinMetrics()) {
			_defaultRegistry.register(metric);
		}
	}

	return _defaultRegistry;
}

/**
 * Create a new metric registry with built-in metrics.
 * Use this if you need an isolated registry instance.
 */
export function createRegistry(): MetricRegistry {
	const registry = new MetricRegistry();

	for (const metric of getBuiltinMetrics()) {
		registry.register(metric);
	}

	return registry;
}

/**
 * Convenience function to compute metrics using the default registry.
 */
export function computeMetrics(
	results: EvalResult[],
	metricNames: string[] = ["accuracy"],
): MetricResult[] {
	return getDefaultRegistry().computeAll(metricNames, results);
}

/**
 * Get list of available metric names from the default registry.
 */
export function getAvailableMetrics(): string[] {
	return getDefaultRegistry().listMetricNames();
}

// ============================================================================
// Legacy compatibility exports
// ============================================================================
// These maintain backward compatibility with code using the old metrics.ts API

/**
 * @deprecated Use computeMetrics or MetricRegistry instead
 */
export function calculateAccuracy(results: EvalResult[]): number {
	const metric = getDefaultRegistry().compute("accuracy", results);
	return metric.value;
}

/**
 * @deprecated Use computeMetrics with "accuracy_by_question_type" instead
 */
export function calculateAccuracyByQuestionType(
	results: EvalResult[],
): Record<string, number> {
	const metric = getDefaultRegistry().compute(
		"accuracy_by_question_type",
		results,
	);
	return (metric.details as Record<string, number>) ?? {};
}

/**
 * @deprecated Use computeMetrics with "accuracy_by_category" instead
 */
export function calculateAccuracyByCategory(
	results: EvalResult[],
): Record<string, number> {
	const metric = getDefaultRegistry().compute("accuracy_by_category", results);
	return (metric.details as Record<string, number>) ?? {};
}

/**
 * @deprecated Use computeMetrics with "recall_at_5" or "recall_at_10" instead
 */
export function calculateRecallAtK(
	results: EvalResult[],
	k: number = 5,
): number {
	const metricName = `recall_at_${k}`;
	// For non-standard K values, fall back to computing manually
	if (!getDefaultRegistry().has(metricName)) {
		// Fallback implementation using token-based F1 scoring
		if (results.length === 0) return 0;
		const f1Threshold = 0.3;
		let totalRecall = 0;
		for (const result of results) {
			const retrievedContext = result.retrievedContext.slice(0, k);
			const expectedTokens = tokenize(result.expected);
			const hasRelevant = retrievedContext.some((ctx) => {
				const chunkTokens = tokenize(ctx.content);
				const expectedSet = new Set(expectedTokens);
				const chunkSet = new Set(chunkTokens);
				let overlap = 0;
				for (const token of expectedSet) {
					if (chunkSet.has(token)) overlap++;
				}
				const precision = chunkSet.size > 0 ? overlap / chunkSet.size : 0;
				const recall = expectedSet.size > 0 ? overlap / expectedSet.size : 0;
				const f1 = computeF1FromPR(precision, recall);
				return f1 >= f1Threshold;
			});
			if (hasRelevant) totalRecall++;
		}
		return totalRecall / results.length;
	}
	const metric = getDefaultRegistry().compute(metricName, results);
	return metric.value;
}

/**
 * @deprecated Use computeMetrics with "precision_at_5" or "precision_at_10" instead
 */
export function calculatePrecisionAtK(
	results: EvalResult[],
	k: number = 5,
): number {
	const metricName = `precision_at_${k}`;
	// For non-standard K values, fall back to computing manually
	if (!getDefaultRegistry().has(metricName)) {
		if (results.length === 0) return 0;
		const f1Threshold = 0.3;
		let totalPrecision = 0;
		for (const result of results) {
			const retrievedContext = result.retrievedContext.slice(0, k);
			const expectedTokens = tokenize(result.expected);
			if (retrievedContext.length === 0) continue;
			const relevantCount = retrievedContext.filter((ctx) => {
				const chunkTokens = tokenize(ctx.content);
				const expectedSet = new Set(expectedTokens);
				const chunkSet = new Set(chunkTokens);
				let overlap = 0;
				for (const token of expectedSet) {
					if (chunkSet.has(token)) overlap++;
				}
				const precision = chunkSet.size > 0 ? overlap / chunkSet.size : 0;
				const recall = expectedSet.size > 0 ? overlap / expectedSet.size : 0;
				const f1 = computeF1FromPR(precision, recall);
				return f1 >= f1Threshold;
			}).length;
			totalPrecision += relevantCount / retrievedContext.length;
		}
		return totalPrecision / results.length;
	}
	const metric = getDefaultRegistry().compute(metricName, results);
	return metric.value;
}

/**
 * @deprecated Use computeMetrics with "mrr" instead
 */
export function calculateMRR(results: EvalResult[]): number {
	const metric = getDefaultRegistry().compute("mrr", results);
	return metric.value;
}

/**
 * @deprecated Use computeMetrics with "avg_retrieval_score" instead
 */
export function calculateAvgRetrievalScore(results: EvalResult[]): number {
	const metric = getDefaultRegistry().compute("avg_retrieval_score", results);
	return metric.value;
}

/**
 * Legacy metrics report interface.
 * @deprecated Use MetricResult[] from computeMetrics instead
 */
export interface MetricsReport {
	accuracy: number;
	metrics: MetricResult[];
	byQuestionType?: Record<string, number>;
	byCategory?: Record<string, number>;
}

/**
 * @deprecated Use computeMetrics instead
 */
export function calculateAllMetrics(
	results: EvalResult[],
	metricsToCalculate: string[] = ["accuracy"],
): MetricsReport {
	const registry = getDefaultRegistry();
	const metrics: MetricResult[] = [];

	const accuracy = calculateAccuracy(results);
	metrics.push({ name: "accuracy", value: accuracy });

	for (const metricName of metricsToCalculate) {
		if (metricName === "accuracy") continue; // Already added

		if (registry.has(metricName)) {
			metrics.push(registry.compute(metricName, results));
		}
	}

	return {
		accuracy,
		metrics,
		byQuestionType: calculateAccuracyByQuestionType(results),
		byCategory: calculateAccuracyByCategory(results),
	};
}
