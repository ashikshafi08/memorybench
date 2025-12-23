import { describe, test, expect, beforeEach } from "bun:test";
import { MetricRegistry } from "./registry.ts";
import type { MetricCalculator, MetricResult } from "./interface.ts";
import { RegistryNotFoundError } from "../registry/index.ts";

describe("MetricRegistry", () => {
	let registry: MetricRegistry;

	beforeEach(() => {
		registry = new MetricRegistry();
	});

	test("registers and retrieves metrics", () => {
		const mockMetric: MetricCalculator = {
			name: "test_metric",
			aliases: ["test-metric"],
			compute: () => ({ name: "test_metric", value: 0.5 }),
		};

		registry.register(mockMetric);
		expect(registry.get("test_metric")).toBe(mockMetric);
		expect(registry.get("test-metric")).toBe(mockMetric); // alias works
	});

	test("getOrThrow throws RegistryNotFoundError for unknown metric", () => {
		expect(() => registry.getOrThrow("unknown")).toThrow(RegistryNotFoundError);
	});

	test("get returns undefined for unknown metric", () => {
		expect(registry.get("unknown")).toBeUndefined();
	});

	test("lists all registered metrics", () => {
		const metric1: MetricCalculator = {
			name: "m1",
			compute: () => ({ name: "m1", value: 1 }),
		};
		const metric2: MetricCalculator = {
			name: "m2",
			compute: () => ({ name: "m2", value: 2 }),
		};

		registry.register(metric1);
		registry.register(metric2);

		const all = registry.list();
		expect(all).toHaveLength(2);
		expect(all).toContain(metric1);
		expect(all).toContain(metric2);
	});

	test("throws on duplicate registration when throwOnConflict=true", () => {
		const metric: MetricCalculator = {
			name: "dup",
			compute: () => ({ name: "dup", value: 1 }),
		};

		registry.register(metric);
		expect(() => registry.register(metric)).toThrow("already registered");
	});

	test("listMetricNames returns all metric names", () => {
		const metric1: MetricCalculator = {
			name: "precision",
			compute: () => ({ name: "precision", value: 0.8 }),
		};
		const metric2: MetricCalculator = {
			name: "recall",
			aliases: ["recall@5"],
			compute: () => ({ name: "recall", value: 0.9 }),
		};

		registry.register(metric1);
		registry.register(metric2);

		const names = registry.listMetricNames();
		expect(names).toContain("precision");
		expect(names).toContain("recall");
		expect(names).toHaveLength(2); // Only primary names, no aliases
	});

	test("has() checks existence by name and alias", () => {
		const metric: MetricCalculator = {
			name: "f1",
			aliases: ["f1-score", "f-measure"],
			compute: () => ({ name: "f1", value: 0.85 }),
		};

		registry.register(metric);

		expect(registry.has("f1")).toBe(true);
		expect(registry.has("f1-score")).toBe(true);
		expect(registry.has("f-measure")).toBe(true);
		expect(registry.has("unknown")).toBe(false);
	});

	test("compute() calculates single metric", () => {
		const mockMetric: MetricCalculator = {
			name: "accuracy",
			compute: (results) => ({
				name: "accuracy",
				value: results.filter((r) => r.correct).length / results.length,
			}),
		};

		registry.register(mockMetric);

		const results = [
			{ correct: true, score: 1 } as any,
			{ correct: false, score: 0 } as any,
			{ correct: true, score: 1 } as any,
		];

		const result = registry.compute("accuracy", results);
		expect(result.name).toBe("accuracy");
		expect(result.value).toBeCloseTo(0.666, 2);
	});

	test("computeAll() calculates multiple metrics", () => {
		const metric1: MetricCalculator = {
			name: "m1",
			compute: () => ({ name: "m1", value: 1 }),
		};
		const metric2: MetricCalculator = {
			name: "m2",
			compute: () => ({ name: "m2", value: 2 }),
		};

		registry.register(metric1);
		registry.register(metric2);

		const results = registry.computeAll(["m1", "m2"], []);
		expect(results).toHaveLength(2);
		expect(results.map((r) => r.name)).toEqual(["m1", "m2"]);
	});

	test("computeAll() avoids duplicates when same metric requested via name and alias", () => {
		const metric: MetricCalculator = {
			name: "precision",
			aliases: ["prec", "p"],
			compute: () => ({ name: "precision", value: 0.8 }),
		};

		registry.register(metric);

		const results = registry.computeAll(["precision", "prec", "p"], []);
		expect(results).toHaveLength(1); // Only computed once
		expect(results[0]?.name).toBe("precision");
	});

	test("validateMetrics() throws for unknown metrics", () => {
		const metric: MetricCalculator = {
			name: "known",
			compute: () => ({ name: "known", value: 1 }),
		};

		registry.register(metric);

		expect(() => registry.validateMetrics(["known"])).not.toThrow();
		expect(() => registry.validateMetrics(["unknown"])).toThrow(RegistryNotFoundError);
	});

	test("validateMetrics() throws with helpful error message", () => {
		try {
			registry.validateMetrics(["nonexistent"]);
			expect(true).toBe(false); // Should not reach here
		} catch (error) {
			expect(error).toBeInstanceOf(RegistryNotFoundError);
			expect((error as Error).message).toContain("MetricRegistry");
			expect((error as Error).message).toContain("nonexistent");
		}
	});
});
