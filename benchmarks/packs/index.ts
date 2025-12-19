/**
 * Benchmark Pack Registry
 * 
 * Discovers and loads benchmark packs that provide paper-faithful semantics.
 */

import type { BenchmarkPack, PackId } from "./interface.ts";
import { longMemEvalPack } from "./longmemeval.ts";
import { locomoPack } from "./locomo.ts";

/**
 * Registry for benchmark packs.
 */
export class PackRegistry {
	private packs = new Map<string, BenchmarkPack>();

	/**
	 * Register a benchmark pack.
	 */
	register(pack: BenchmarkPack): void {
		const key = `${pack.benchmarkName}:${pack.packId}`;
		this.packs.set(key, pack);
	}

	/**
	 * Get a pack by benchmark name and pack ID.
	 */
	get(benchmarkName: string, packId: PackId): BenchmarkPack | undefined {
		const key = `${benchmarkName}:${packId}`;
		return this.packs.get(key);
	}

	/**
	 * Get the latest pack for a benchmark (by pack ID version).
	 * For now, returns the first registered pack. In the future, could parse
	 * version strings and return the latest.
	 */
	getLatest(benchmarkName: string): BenchmarkPack | undefined {
		for (const [key, pack] of this.packs.entries()) {
			if (pack.benchmarkName === benchmarkName) {
				return pack;
			}
		}
		return undefined;
	}

	/**
	 * Check if a pack exists for a benchmark.
	 */
	has(benchmarkName: string, packId?: PackId): boolean {
		if (packId) {
			return this.get(benchmarkName, packId) !== undefined;
		}
		return this.getLatest(benchmarkName) !== undefined;
	}

	/**
	 * List all registered packs.
	 */
	list(): BenchmarkPack[] {
		return Array.from(this.packs.values());
	}
}

// Singleton instance
let globalPackRegistry: PackRegistry | null = null;

export function getPackRegistry(): PackRegistry {
	if (!globalPackRegistry) {
		globalPackRegistry = new PackRegistry();
		// Register built-in packs
		globalPackRegistry.register(longMemEvalPack);
		globalPackRegistry.register(locomoPack);
	}
	return globalPackRegistry;
}

export function resetPackRegistry(): void {
	globalPackRegistry = null;
}

