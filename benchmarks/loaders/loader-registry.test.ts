/**
 * Unit tests for LoaderRegistry.
 *
 * Tests cover:
 * 1. Loader registration and retrieval
 * 2. Alias support
 * 3. Built-in loaders presence
 * 4. Conflict detection
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
	LoaderRegistry,
	getLoaderRegistry,
	resetLoaderRegistry,
	registerLoader,
	getLoader,
	hasCustomLoader,
	getLoaderNames,
} from "./loader-registry.ts";
import { ensureBuiltinLoadersRegistered, resetBuiltinLoadersRegistration } from "./builtin-loaders.ts";
import type { BenchmarkConfig, BenchmarkItem } from "../../core/config.ts";

describe("LoaderRegistry", () => {
	let registry: LoaderRegistry;

	beforeEach(() => {
		registry = new LoaderRegistry();
	});

	describe("Basic operations", () => {
		it("registers and retrieves a loader", () => {
			const mockLoader = {
				name: "test-loader",
				loadFn: async () => [],
			};

			registry.register(mockLoader);

			expect(registry.getLoader("test-loader")).toEqual(mockLoader);
			expect(registry.hasCustomLoader("test-loader")).toBe(true);
		});

		it("returns undefined for non-existent loader", () => {
			expect(registry.getLoader("nonexistent")).toBeUndefined();
			expect(registry.hasCustomLoader("nonexistent")).toBe(false);
		});

		it("lists all registered loader names", () => {
			registry.register({ name: "loader-a", loadFn: async () => [] });
			registry.register({ name: "loader-b", loadFn: async () => [] });

			const names = registry.getLoaderNames();
			expect(names).toContain("loader-a");
			expect(names).toContain("loader-b");
		});
	});

	describe("Alias support", () => {
		it("retrieves loader by alias", () => {
			const mockLoader = {
				name: "primary-name",
				aliases: ["alias1", "alias2"] as const,
				loadFn: async () => [],
			};

			registry.register(mockLoader);

			expect(registry.getLoader("primary-name")).toEqual(mockLoader);
			expect(registry.getLoader("alias1")).toEqual(mockLoader);
			expect(registry.getLoader("alias2")).toEqual(mockLoader);
		});

		it("has() works with aliases", () => {
			registry.register({
				name: "loader",
				aliases: ["loader-alias"],
				loadFn: async () => [],
			});

			expect(registry.hasCustomLoader("loader")).toBe(true);
			expect(registry.hasCustomLoader("loader-alias")).toBe(true);
			expect(registry.hasCustomLoader("unknown")).toBe(false);
		});
	});

	describe("Conflict detection", () => {
		it("throws on duplicate registration", () => {
			registry.register({ name: "dup", loadFn: async () => [] });

			expect(() =>
				registry.register({ name: "dup", loadFn: async () => [] }),
			).toThrow();
		});

		it("throws when alias conflicts with existing name", () => {
			registry.register({ name: "original", loadFn: async () => [] });

			expect(() =>
				registry.register({
					name: "new",
					aliases: ["original"],
					loadFn: async () => [],
				}),
			).toThrow();
		});
	});
});

describe("Global LoaderRegistry functions", () => {
	beforeEach(() => {
		resetLoaderRegistry();
		resetBuiltinLoadersRegistration();
	});

	it("provides singleton access via getLoaderRegistry()", () => {
		const registry1 = getLoaderRegistry();
		const registry2 = getLoaderRegistry();
		expect(registry1).toBe(registry2);
	});

	it("resetLoaderRegistry clears the singleton", () => {
		const registry1 = getLoaderRegistry();
		resetLoaderRegistry();
		const registry2 = getLoaderRegistry();
		expect(registry1).not.toBe(registry2);
	});
});

describe("Built-in loaders", () => {
	beforeEach(() => {
		resetLoaderRegistry();
		resetBuiltinLoadersRegistration();
		ensureBuiltinLoadersRegistered();
	});

	it("registers repoeval loader", () => {
		expect(hasCustomLoader("repoeval")).toBe(true);
		expect(getLoader("repoeval")).toBeDefined();
		expect(getLoader("repoeval")?.name).toBe("repoeval");
	});

	it("registers repobench-r loader", () => {
		expect(hasCustomLoader("repobench-r")).toBe(true);
		expect(getLoader("repobench-r")).toBeDefined();
	});

	it("registers crosscodeeval loader", () => {
		expect(hasCustomLoader("crosscodeeval")).toBe(true);
	});

	it("registers swebench-lite loader", () => {
		expect(hasCustomLoader("swebench-lite")).toBe(true);
	});

	it("supports aliases for built-in loaders", () => {
		// RepoEval aliases
		expect(getLoader("repo-eval")).toBeDefined();
		expect(getLoader("repoeval-function")).toBeDefined();

		// RepoBench aliases
		expect(getLoader("repobench")).toBeDefined();
		expect(getLoader("repo-bench-r")).toBeDefined();

		// CrossCodeEval aliases
		expect(getLoader("cross-code-eval")).toBeDefined();
		expect(getLoader("crosscode")).toBeDefined();

		// SWE-bench aliases
		expect(getLoader("swebench")).toBeDefined();
		expect(getLoader("swe-bench")).toBeDefined();
		expect(getLoader("swe-bench-lite")).toBeDefined();
	});

	it("lists all built-in loader names", () => {
		const names = getLoaderNames();
		expect(names).toContain("repoeval");
		expect(names).toContain("repobench-r");
		expect(names).toContain("crosscodeeval");
		expect(names).toContain("swebench-lite");
		expect(names).toContain("longmemeval");
		expect(names.length).toBe(5);
	});
});

describe("Loader invocation", () => {
	beforeEach(() => {
		resetLoaderRegistry();
		resetBuiltinLoadersRegistration();
	});

	it("loadFn is callable and returns items", async () => {
		const mockItems: BenchmarkItem[] = [
			{
				id: "item-1",
				question: "What is this?",
				answer: "Test answer",
				contexts: [],
				metadata: {},
			},
		];

		registerLoader({
			name: "mock-loader",
			loadFn: async (config, options) => {
				// Verify options are passed through
				expect(config.name).toBe("mock-loader");
				expect(options?.limit).toBe(10);
				return mockItems;
			},
		});

		const loader = getLoader("mock-loader");
		expect(loader).toBeDefined();

		const result = await loader!.loadFn(
			{ name: "mock-loader" } as BenchmarkConfig,
			{ limit: 10 },
		);

		expect(result).toEqual(mockItems);
	});
});
