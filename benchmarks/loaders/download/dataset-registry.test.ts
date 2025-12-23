/**
 * Unit tests for DatasetRegistry.
 *
 * Tests cover:
 * 1. Dataset registration and retrieval
 * 2. Built-in datasets presence
 * 3. Backward compatibility with getDataset/getDatasetNames
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
	DatasetRegistry,
	getDatasetRegistry,
	resetDatasetRegistry,
	getDataset,
	getDatasetNames,
	type DatasetDefinition,
} from "./dataset-registry.ts";

// Helper to create a mock dataset
function createMockDataset(name: string): DatasetDefinition {
	return {
		name,
		dataDir: `/mock/${name}`,
		envVar: `MOCK_${name.toUpperCase()}_DIR`,
		isAvailable: () => false,
		download: async () => {},
		loadTasks: async () => [],
		toBenchmarkItem: async () => ({
			id: "mock-id",
			question: "mock question",
			answer: "mock answer",
			contexts: [],
			metadata: {},
		}),
	};
}

describe("DatasetRegistry", () => {
	let registry: DatasetRegistry;

	beforeEach(() => {
		registry = new DatasetRegistry();
	});

	describe("Basic operations", () => {
		it("registers and retrieves a dataset", () => {
			const mockDataset = createMockDataset("test-dataset");
			registry.register(mockDataset);

			expect(registry.getDataset("test-dataset")).toEqual(mockDataset);
			expect(registry.has("test-dataset")).toBe(true);
		});

		it("returns undefined for non-existent dataset", () => {
			expect(registry.getDataset("nonexistent")).toBeUndefined();
			expect(registry.has("nonexistent")).toBe(false);
		});

		it("lists all registered dataset names", () => {
			registry.register(createMockDataset("dataset-a"));
			registry.register(createMockDataset("dataset-b"));

			const names = registry.getDatasetNames();
			expect(names).toContain("dataset-a");
			expect(names).toContain("dataset-b");
			expect(names.length).toBe(2);
		});

		it("returns sorted dataset names", () => {
			registry.register(createMockDataset("zebra"));
			registry.register(createMockDataset("alpha"));
			registry.register(createMockDataset("mango"));

			const names = registry.getDatasetNames();
			expect(names).toEqual(["alpha", "mango", "zebra"]);
		});
	});

	describe("Conflict detection", () => {
		it("throws on duplicate registration", () => {
			registry.register(createMockDataset("dup"));

			expect(() => registry.register(createMockDataset("dup"))).toThrow();
		});
	});
});

describe("Global DatasetRegistry functions", () => {
	beforeEach(() => {
		resetDatasetRegistry();
	});

	it("provides singleton access via getDatasetRegistry()", () => {
		const registry1 = getDatasetRegistry();
		const registry2 = getDatasetRegistry();
		expect(registry1).toBe(registry2);
	});

	it("resetDatasetRegistry clears the singleton", () => {
		const registry1 = getDatasetRegistry();
		resetDatasetRegistry();
		const registry2 = getDatasetRegistry();
		expect(registry1).not.toBe(registry2);
	});
});

describe("Built-in datasets", () => {
	beforeEach(() => {
		resetDatasetRegistry();
	});

	it("registers repoeval dataset", () => {
		expect(getDataset("repoeval")).toBeDefined();
		expect(getDataset("repoeval")?.name).toBe("repoeval");
	});

	it("registers repobench-r dataset", () => {
		expect(getDataset("repobench-r")).toBeDefined();
		expect(getDataset("repobench-r")?.name).toBe("repobench-r");
	});

	it("registers crosscodeeval dataset", () => {
		expect(getDataset("crosscodeeval")).toBeDefined();
		expect(getDataset("crosscodeeval")?.name).toBe("crosscodeeval");
	});

	it("registers swebench-lite dataset", () => {
		expect(getDataset("swebench-lite")).toBeDefined();
		expect(getDataset("swebench-lite")?.name).toBe("swebench-lite");
	});

	it("lists all built-in dataset names", () => {
		const names = getDatasetNames();
		// Code retrieval datasets
		expect(names).toContain("repoeval");
		expect(names).toContain("repobench-r");
		expect(names).toContain("crosscodeeval");
		expect(names).toContain("swebench-lite");
		// Memory benchmark datasets
		expect(names).toContain("longmemeval");
		expect(names).toContain("locomo");
		expect(names.length).toBe(6);
	});

	it("registers longmemeval dataset", () => {
		expect(getDataset("longmemeval")).toBeDefined();
		expect(getDataset("longmemeval")?.name).toBe("longmemeval");
	});

	it("registers locomo dataset", () => {
		expect(getDataset("locomo")).toBeDefined();
		expect(getDataset("locomo")?.name).toBe("locomo");
	});
});

describe("Backward compatibility", () => {
	beforeEach(() => {
		resetDatasetRegistry();
	});

	it("getDataset() returns same result as registry.getDataset()", () => {
		const direct = getDataset("repoeval");
		const viaRegistry = getDatasetRegistry().getDataset("repoeval");
		expect(direct).toBe(viaRegistry);
	});

	it("getDatasetNames() returns same result as registry.getDatasetNames()", () => {
		const direct = getDatasetNames();
		const viaRegistry = getDatasetRegistry().getDatasetNames();
		expect(direct).toEqual(viaRegistry);
	});
});

describe("Dataset interface", () => {
	beforeEach(() => {
		resetDatasetRegistry();
	});

	it("datasets have required properties", () => {
		const dataset = getDataset("repoeval");
		expect(dataset).toBeDefined();

		// Check all required properties exist
		expect(typeof dataset!.name).toBe("string");
		expect(typeof dataset!.dataDir).toBe("string");
		expect(typeof dataset!.envVar).toBe("string");
		expect(typeof dataset!.isAvailable).toBe("function");
		expect(typeof dataset!.download).toBe("function");
		expect(typeof dataset!.loadTasks).toBe("function");
		expect(typeof dataset!.toBenchmarkItem).toBe("function");
	});

	it("isAvailable returns boolean", () => {
		const dataset = getDataset("repoeval");
		const result = dataset!.isAvailable();
		expect(typeof result).toBe("boolean");
	});
});
