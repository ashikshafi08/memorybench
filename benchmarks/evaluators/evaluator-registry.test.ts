import { describe, test, expect, beforeEach } from "bun:test";
import {
	EvaluatorRegistry,
	resetEvaluatorRegistry,
	UnknownEvaluatorError,
	getEvaluatorRegistry,
} from "./evaluator-registry.ts";
import type { EvaluatorDefinition } from "./evaluator-registry.ts";

describe("EvaluatorRegistry", () => {
	beforeEach(() => {
		resetEvaluatorRegistry();
	});

	test("registers and retrieves evaluators", () => {
		const registry = new EvaluatorRegistry();
		const mockEvaluator: EvaluatorDefinition = {
			name: "test-eval",
			aliases: ["test"],
			evaluateFn: async () => ({ correct: true, score: 1 }),
		};

		registry.register(mockEvaluator);
		expect(registry.get("test-eval")).toBe(mockEvaluator);
		expect(registry.get("test")).toBe(mockEvaluator); // alias works
	});

	test("get returns undefined for unknown evaluator", () => {
		const registry = new EvaluatorRegistry();
		expect(registry.get("unknown")).toBeUndefined();
	});

	test("UnknownEvaluatorError includes available evaluators", () => {
		const error = new UnknownEvaluatorError("typo-eval", ["exact-match", "llm-judge"]);

		expect(error.message).toContain("typo-eval");
		expect(error.message).toContain("exact-match, llm-judge");
		expect(error.message).toContain("Available evaluators");
		expect(error.requestedEvaluator).toBe("typo-eval");
		expect(error.availableEvaluators).toEqual(["exact-match", "llm-judge"]);
	});

	test("UnknownEvaluatorError has correct name", () => {
		const error = new UnknownEvaluatorError("test", []);
		expect(error.name).toBe("UnknownEvaluatorError");
	});

	test("lists all registered evaluators", () => {
		const registry = new EvaluatorRegistry();
		const eval1: EvaluatorDefinition = {
			name: "eval1",
			evaluateFn: async () => ({ correct: true, score: 1 }),
		};
		const eval2: EvaluatorDefinition = {
			name: "eval2",
			evaluateFn: async () => ({ correct: false, score: 0 }),
		};

		registry.register(eval1);
		registry.register(eval2);

		const all = registry.list();
		expect(all).toHaveLength(2);
		expect(all).toContain(eval1);
		expect(all).toContain(eval2);
	});

	test("throws on duplicate registration", () => {
		const registry = new EvaluatorRegistry();
		const evaluator: EvaluatorDefinition = {
			name: "dup",
			evaluateFn: async () => ({ correct: true, score: 1 }),
		};

		registry.register(evaluator);
		expect(() => registry.register(evaluator)).toThrow("already registered");
	});

	test("getEvaluatorNames returns all names", () => {
		const registry = new EvaluatorRegistry();
		registry.register({
			name: "eval1",
			evaluateFn: async () => ({ correct: true, score: 1 }),
		});
		registry.register({
			name: "eval2",
			evaluateFn: async () => ({ correct: true, score: 1 }),
		});

		const names = registry.getEvaluatorNames();
		expect(names).toContain("eval1");
		expect(names).toContain("eval2");
	});

	test("has() checks existence by name and alias", () => {
		const registry = new EvaluatorRegistry();
		const evaluator: EvaluatorDefinition = {
			name: "llm-judge",
			aliases: ["llm", "judge"],
			evaluateFn: async () => ({ correct: true, score: 1 }),
		};

		registry.register(evaluator);

		expect(registry.has("llm-judge")).toBe(true);
		expect(registry.has("llm")).toBe(true);
		expect(registry.has("judge")).toBe(true);
		expect(registry.has("unknown")).toBe(false);
	});

	test("getEvaluatorRegistry returns singleton", () => {
		const registry1 = getEvaluatorRegistry();
		const registry2 = getEvaluatorRegistry();

		expect(registry1).toBe(registry2); // Same instance
	});

	test("resetEvaluatorRegistry creates new instance", () => {
		const registry1 = getEvaluatorRegistry();
		registry1.register({
			name: "test",
			evaluateFn: async () => ({ correct: true, score: 1 }),
		});

		resetEvaluatorRegistry();
		const registry2 = getEvaluatorRegistry();

		expect(registry2).not.toBe(registry1); // Different instance
		expect(registry2.has("test")).toBe(false); // Fresh registry
	});

	test("evaluateFn can be async", async () => {
		const registry = new EvaluatorRegistry();
		const evaluator: EvaluatorDefinition = {
			name: "async-eval",
			evaluateFn: async (item, results) => {
				// Simulate async operation
				await new Promise((resolve) => setTimeout(resolve, 10));
				return { correct: true, score: 0.95 };
			},
		};

		registry.register(evaluator);
		const retrieved = registry.get("async-eval");

		expect(retrieved).toBe(evaluator);
		const result = await retrieved!.evaluateFn({} as any, []);
		expect(result.correct).toBe(true);
		expect(result.score).toBe(0.95);
	});

	test("aliases are optional", () => {
		const registry = new EvaluatorRegistry();
		const evaluator: EvaluatorDefinition = {
			name: "no-aliases",
			evaluateFn: async () => ({ correct: true, score: 1 }),
		};

		registry.register(evaluator);
		expect(registry.get("no-aliases")).toBe(evaluator);
	});

	test("keys() returns all registered evaluator names", () => {
		const registry = new EvaluatorRegistry();
		registry.register({
			name: "eval-a",
			evaluateFn: async () => ({ correct: true, score: 1 }),
		});
		registry.register({
			name: "eval-b",
			aliases: ["b"],
			evaluateFn: async () => ({ correct: true, score: 1 }),
		});

		const keys = registry.keys();
		expect(keys).toHaveLength(2);
		expect(keys).toContain("eval-a");
		expect(keys).toContain("eval-b");
		// Aliases should not be in keys(), only primary names
	});

	test("size property returns number of registered evaluators", () => {
		const registry = new EvaluatorRegistry();
		expect(registry.size).toBe(0);

		registry.register({
			name: "eval1",
			evaluateFn: async () => ({ correct: true, score: 1 }),
		});
		expect(registry.size).toBe(1);

		registry.register({
			name: "eval2",
			evaluateFn: async () => ({ correct: true, score: 1 }),
		});
		expect(registry.size).toBe(2);
	});
});
