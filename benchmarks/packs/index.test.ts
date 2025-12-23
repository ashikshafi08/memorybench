import { describe, test, expect, beforeEach } from "bun:test";
import { PackRegistry, resetPackRegistry, isBenchmarkPack } from "./index.ts";
import type { BenchmarkPack } from "./interface.ts";

describe("PackRegistry", () => {
	let registry: PackRegistry;

	beforeEach(() => {
		resetPackRegistry();
		registry = new PackRegistry();
	});

	test("registers and retrieves packs by key", () => {
		const mockPack: BenchmarkPack = {
			benchmarkName: "test",
			packId: "v1@2024-01",
			sealedSemantics: { relevance: true, evaluation: true },
			buildAnswerPrompt: () => "test",
			evaluate: async () => ({ correct: true, score: 1 }),
			isRelevant: () => true,
		};

		registry.register(mockPack);
		expect(registry.getByKey("test", "v1@2024-01")).toBe(mockPack);
	});

	test("throws on invalid pack (missing required fields)", () => {
		const invalidPack = {
			benchmarkName: "test",
			// Missing packId, sealedSemantics, etc.
		};

		expect(() => registry.register(invalidPack as any)).toThrow("Invalid BenchmarkPack");
	});

	test("isBenchmarkPack validates pack structure", () => {
		const validPack: BenchmarkPack = {
			benchmarkName: "test",
			packId: "v1@2024-01",
			sealedSemantics: { relevance: true, evaluation: true },
			buildAnswerPrompt: () => "test",
			evaluate: async () => ({ correct: true, score: 1 }),
			isRelevant: () => true,
		};

		expect(isBenchmarkPack(validPack)).toBe(true);
		expect(isBenchmarkPack({})).toBe(false);
		expect(isBenchmarkPack(null)).toBe(false);
		expect(isBenchmarkPack({ benchmarkName: "test" })).toBe(false); // missing other fields
	});

	test("isBenchmarkPack checks for @ in packId", () => {
		const invalidPack = {
			benchmarkName: "test",
			packId: "v1-2024-01", // Missing @
			sealedSemantics: {},
			buildAnswerPrompt: () => "",
			evaluate: async () => ({ correct: true, score: 1 }),
			isRelevant: () => true,
		};

		expect(isBenchmarkPack(invalidPack)).toBe(false);
	});

	test("getLatest returns first pack for benchmark", () => {
		const pack1: BenchmarkPack = {
			benchmarkName: "test",
			packId: "v1@2024-01",
			sealedSemantics: {},
			buildAnswerPrompt: () => "",
			evaluate: async () => ({ correct: true, score: 1 }),
			isRelevant: () => true,
		};
		const pack2: BenchmarkPack = { ...pack1, packId: "v2@2024-02" };

		registry.register(pack1);
		registry.register(pack2);

		expect(registry.getLatest("test")).toBe(pack1); // First registered
	});

	test("getLatest returns undefined for unknown benchmark", () => {
		expect(registry.getLatest("nonexistent")).toBeUndefined();
	});

	test("hasBenchmark checks existence", () => {
		const pack: BenchmarkPack = {
			benchmarkName: "test",
			packId: "v1@2024-01",
			sealedSemantics: {},
			buildAnswerPrompt: () => "",
			evaluate: async () => ({ correct: true, score: 1 }),
			isRelevant: () => true,
		};

		registry.register(pack);
		expect(registry.hasBenchmark("test")).toBe(true);
		expect(registry.hasBenchmark("test", "v1@2024-01")).toBe(true);
		expect(registry.hasBenchmark("test", "v2@2024-02")).toBe(false);
		expect(registry.hasBenchmark("nonexistent")).toBe(false);
	});

	test("getPacksForBenchmark returns all packs for a benchmark", () => {
		const pack1: BenchmarkPack = {
			benchmarkName: "test",
			packId: "v1@2024-01",
			sealedSemantics: {},
			buildAnswerPrompt: () => "",
			evaluate: async () => ({ correct: true, score: 1 }),
			isRelevant: () => true,
		};
		const pack2: BenchmarkPack = { ...pack1, packId: "v2@2024-02" };
		const otherPack: BenchmarkPack = { ...pack1, benchmarkName: "other", packId: "v1@2024-01" };

		registry.register(pack1);
		registry.register(pack2);
		registry.register(otherPack);

		const testPacks = registry.getPacksForBenchmark("test");
		expect(testPacks).toHaveLength(2);
		expect(testPacks).toContain(pack1);
		expect(testPacks).toContain(pack2);
	});

	test("getBenchmarkNames returns unique benchmark names", () => {
		const pack1: BenchmarkPack = {
			benchmarkName: "test1",
			packId: "v1@2024-01",
			sealedSemantics: {},
			buildAnswerPrompt: () => "",
			evaluate: async () => ({ correct: true, score: 1 }),
			isRelevant: () => true,
		};
		const pack2: BenchmarkPack = { ...pack1, packId: "v2@2024-02" }; // Same benchmark
		const pack3: BenchmarkPack = { ...pack1, benchmarkName: "test2", packId: "v1@2024-01" };

		registry.register(pack1);
		registry.register(pack2);
		registry.register(pack3);

		const names = registry.getBenchmarkNames();
		expect(names).toEqual(["test1", "test2"]); // Sorted, unique
	});

	test("allows re-registration with throwOnConflict=false (first wins)", () => {
		const pack1: BenchmarkPack = {
			benchmarkName: "test",
			packId: "v1@2024-01",
			sealedSemantics: {},
			buildAnswerPrompt: () => "original",
			evaluate: async () => ({ correct: true, score: 1 }),
			isRelevant: () => true,
		};
		const pack2: BenchmarkPack = {
			...pack1,
			buildAnswerPrompt: () => "updated",
		};

		registry.register(pack1);
		// Should not throw (throwOnConflict=false), but silently skips
		registry.register(pack2);

		// First registered wins (duplicate is silently ignored)
		const retrieved = registry.getByKey("test", "v1@2024-01");
		expect(retrieved?.buildAnswerPrompt()).toBe("original");
	});

	test("list() returns all registered packs", () => {
		const pack1: BenchmarkPack = {
			benchmarkName: "test1",
			packId: "v1@2024-01",
			sealedSemantics: {},
			buildAnswerPrompt: () => "",
			evaluate: async () => ({ correct: true, score: 1 }),
			isRelevant: () => true,
		};
		const pack2: BenchmarkPack = { ...pack1, benchmarkName: "test2" };

		registry.register(pack1);
		registry.register(pack2);

		const all = registry.list();
		expect(all).toHaveLength(2);
		expect(all).toContain(pack1);
		expect(all).toContain(pack2);
	});
});
