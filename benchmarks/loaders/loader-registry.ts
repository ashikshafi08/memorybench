/**
 * Loader Registry - pluggable benchmark data loaders.
 *
 * Replaces hardcoded if-statements in loader.ts with registry-based dispatch.
 * Adding a new benchmark loader now requires only registering here.
 *
 * @example
 * ```typescript
 * registerLoader({
 *   name: "my-benchmark",
 *   loadFn: async (config, options) => {
 *     // Load and return benchmark items
 *     return [...items];
 *   },
 * });
 * ```
 */

import type { BenchmarkConfig, BenchmarkItem } from "../../core/config.ts";
import { BaseRegistry } from "../../core/registry/index.ts";

/**
 * Options passed to loader functions.
 */
export interface LoaderOptions {
	limit?: number;
	start?: number;
	end?: number;
	questionType?: string;
	/** Task type for RepoEval: "function" (default), "line", or "api" */
	taskType?: "function" | "line" | "api";
}

/**
 * Definition of a benchmark loader.
 *
 * Loaders can define:
 * - `loadFn`: Fully custom loading logic (replaces generic schema-based loading)
 * - `postProcessItem`: Post-processing hook applied after loading
 *
 * Both are optional. If only `postProcessItem` is defined, the generic
 * schema-based loader is used, then post-processing is applied.
 */
export interface LoaderDefinition {
	/** Benchmark name (matches config.name) */
	name: string;
	/** Optional aliases for the loader */
	aliases?: readonly string[];
	/** Description of what this loader handles */
	description?: string;
	/**
	 * Custom async function to load benchmark data.
	 * If not provided, the generic schema-based loader is used.
	 */
	loadFn?: (
		config: BenchmarkConfig,
		options?: LoaderOptions,
	) => Promise<BenchmarkItem[]>;
	/** Optional preflight check (e.g., verify data exists) */
	preflight?: () => Promise<void>;
	/**
	 * Optional post-processing hook for each loaded item.
	 * Called after loading (whether custom or schema-based), before filters.
	 * Use to enrich item metadata with benchmark-specific labels.
	 *
	 * @param item - The mapped benchmark item
	 * @returns The enriched item (can mutate or return new object)
	 */
	postProcessItem?: (item: BenchmarkItem) => BenchmarkItem;
}

/**
 * Registry for benchmark data loaders.
 *
 * Extends BaseRegistry with loader-specific methods.
 */
export class LoaderRegistry extends BaseRegistry<LoaderDefinition> {
	constructor() {
		super({ name: "LoaderRegistry", throwOnConflict: true });
	}

	/**
	 * Register a loader definition.
	 */
	register(def: LoaderDefinition): void {
		this.registerItem(def.name, def, def.aliases);
	}

	/**
	 * Get a loader by name or alias.
	 */
	getLoader(nameOrAlias: string): LoaderDefinition | undefined {
		return super.get(nameOrAlias);
	}

	/**
	 * Check if a custom loader exists for a benchmark.
	 */
	hasCustomLoader(benchmarkName: string): boolean {
		return this.has(benchmarkName);
	}

	/**
	 * Get all registered loader names.
	 */
	getLoaderNames(): string[] {
		return this.keys();
	}
}

// Singleton instance
let globalLoaderRegistry: LoaderRegistry | null = null;

/**
 * Get the global loader registry.
 * Lazily initializes and registers built-in loaders.
 */
export function getLoaderRegistry(): LoaderRegistry {
	if (!globalLoaderRegistry) {
		globalLoaderRegistry = new LoaderRegistry();
		// Built-in loaders are registered in registerBuiltinLoaders()
		// Called after imports are resolved to avoid circular dependencies
	}
	return globalLoaderRegistry;
}

// Callback to reset builtin loaders registration (set by builtin-loaders.ts)
let builtinLoadersResetCallback: (() => void) | null = null;

/**
 * Register a callback to reset builtin loaders registration.
 * Called by builtin-loaders.ts to avoid circular dependency.
 * @internal
 */
export function setBuiltinLoadersResetCallback(callback: () => void): void {
	builtinLoadersResetCallback = callback;
}

/**
 * Reset the loader registry (for testing).
 * Also resets the builtin loaders registration flag.
 */
export function resetLoaderRegistry(): void {
	globalLoaderRegistry = null;
	// Also reset builtin loaders flag so they can be re-registered
	builtinLoadersResetCallback?.();
}

/**
 * Register a loader in the global registry.
 */
export function registerLoader(def: LoaderDefinition): void {
	getLoaderRegistry().register(def);
}

/**
 * Get a loader by name from the global registry.
 */
export function getLoader(name: string): LoaderDefinition | undefined {
	return getLoaderRegistry().getLoader(name);
}

/**
 * Check if a custom loader exists for a benchmark.
 */
export function hasCustomLoader(benchmarkName: string): boolean {
	return getLoaderRegistry().hasCustomLoader(benchmarkName);
}

/**
 * Get all registered loader names.
 */
export function getLoaderNames(): string[] {
	return getLoaderRegistry().getLoaderNames();
}
