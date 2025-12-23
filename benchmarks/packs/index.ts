/**
 * Benchmark Pack Registry
 *
 * Discovers and loads benchmark packs that provide paper-faithful semantics.
 *
 * Now extends BaseRegistry for consistent registry behavior across the codebase.
 */

import type { BenchmarkPack, PackId } from "./interface.ts";
import { BaseRegistry } from "../../core/registry/index.ts";
import { longMemEvalPack } from "./longmemeval.ts";
import { locomoPack } from "./locomo.ts";
// Code retrieval packs (consolidated)
import {
	repoEvalPack,
	repoBenchRPack,
	crossCodeEvalPack,
	sweBenchLitePack,
} from "./generic-code-retrieval-pack.ts";

// Re-export for backward compatibility
export { repoEvalPack, repoBenchRPack, crossCodeEvalPack, sweBenchLitePack };
export { createCodeRetrievalPack } from "./generic-code-retrieval-pack.ts";

/**
 * Type guard to check if an object is a valid BenchmarkPack.
 * Used for validation during registration and future dynamic discovery.
 */
export function isBenchmarkPack(value: unknown): value is BenchmarkPack {
	if (!value || typeof value !== "object") return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.benchmarkName === "string" &&
		typeof obj.packId === "string" &&
		obj.packId.includes("@") &&
		typeof obj.sealedSemantics === "object" &&
		obj.sealedSemantics !== null &&
		typeof obj.buildAnswerPrompt === "function" &&
		typeof obj.evaluate === "function" &&
		typeof obj.isRelevant === "function"
	);
}

/**
 * All built-in packs.
 * To add a new pack: import it above and add to this array.
 * The array pattern eliminates scattered manual registration calls.
 */
const BUILTIN_PACKS: readonly BenchmarkPack[] = [
	longMemEvalPack,
	locomoPack,
	repoEvalPack,
	repoBenchRPack,
	sweBenchLitePack,
	crossCodeEvalPack,
] as const;

/**
 * Registry for benchmark packs.
 *
 * Uses throwOnConflict=false to allow pack re-registration during development
 * and hot-reloading scenarios. Duplicate registrations are silently ignored (first wins).
 *
 * Extends BaseRegistry with composite key support (benchmarkName:packId).
 */
export class PackRegistry extends BaseRegistry<BenchmarkPack> {
	constructor() {
		// throwOnConflict=false allows re-registration without errors
		// Duplicates are silently ignored (first wins)
		// Useful for: development, testing, hot-reloading
		super({ name: "PackRegistry", throwOnConflict: false });
	}

	/**
	 * Register a benchmark pack.
	 * Validates the pack structure before registration.
	 */
	register(pack: BenchmarkPack): void {
		if (!isBenchmarkPack(pack)) {
			throw new Error(
				`Invalid BenchmarkPack: missing required fields. ` +
				`Pack must have: benchmarkName, packId (with @), sealedSemantics, ` +
				`buildAnswerPrompt, evaluate, isRelevant`
			);
		}
		const key = `${pack.benchmarkName}:${pack.packId}`;
		this.registerItem(key, pack);
	}

	/**
	 * Get a pack by benchmark name and pack ID.
	 */
	getByKey(benchmarkName: string, packId: PackId): BenchmarkPack | undefined {
		const key = `${benchmarkName}:${packId}`;
		return super.get(key);
	}

	/**
	 * Get the latest pack for a benchmark (by pack ID version).
	 * For now, returns the first registered pack. In the future, could parse
	 * version strings and return the latest.
	 */
	getLatest(benchmarkName: string): BenchmarkPack | undefined {
		for (const pack of this.list()) {
			if (pack.benchmarkName === benchmarkName) {
				return pack;
			}
		}
		return undefined;
	}

	/**
	 * Check if a pack exists for a benchmark.
	 */
	hasBenchmark(benchmarkName: string, packId?: PackId): boolean {
		if (packId) {
			return this.getByKey(benchmarkName, packId) !== undefined;
		}
		return this.getLatest(benchmarkName) !== undefined;
	}

	/**
	 * Get all packs for a specific benchmark.
	 */
	getPacksForBenchmark(benchmarkName: string): BenchmarkPack[] {
		return this.list().filter((pack) => pack.benchmarkName === benchmarkName);
	}

	/**
	 * Get all unique benchmark names.
	 */
	getBenchmarkNames(): string[] {
		const names = new Set<string>();
		for (const pack of this.list()) {
			names.add(pack.benchmarkName);
		}
		return Array.from(names).sort();
	}
}

// Singleton instance
let globalPackRegistry: PackRegistry | null = null;

export function getPackRegistry(): PackRegistry {
	if (!globalPackRegistry) {
		globalPackRegistry = new PackRegistry();
		// Auto-register all built-in packs from BUILTIN_PACKS array
		for (const pack of BUILTIN_PACKS) {
			globalPackRegistry.register(pack);
		}
	}
	return globalPackRegistry;
}

export function resetPackRegistry(): void {
	globalPackRegistry = null;
}
