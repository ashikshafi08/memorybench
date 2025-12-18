/**
 * Metric calculator interface for the Metric Registry pattern.
 * Each metric is a small, self-contained calculator that can be registered
 * and invoked by name.
 */

import type { EvalResult } from "../config.ts";

/**
 * Result of a metric calculation.
 */
export interface MetricResult {
	name: string;
	value: number;
	details?: Record<string, unknown>;
}

/**
 * Interface for metric calculators.
 * Each calculator is responsible for computing a single metric from evaluation results.
 */
export interface MetricCalculator {
	/**
	 * Primary name of the metric (used for lookup and output).
	 */
	readonly name: string;

	/**
	 * Optional aliases that can also be used to invoke this metric.
	 */
	readonly aliases?: readonly string[];

	/**
	 * Human-readable description of what this metric measures.
	 */
	readonly description?: string;

	/**
	 * Compute the metric value from evaluation results.
	 * @param results - Array of evaluation results to compute the metric from
	 * @returns MetricResult with the computed value and optional details
	 */
	compute(results: EvalResult[]): MetricResult;
}
