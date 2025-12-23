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
