/**
 * Built-in Benchmark Loaders
 *
 * Registers all built-in code retrieval benchmark loaders.
 * This file is imported by loader.ts to populate the registry.
 */

import { registerLoader, setBuiltinLoadersResetCallback } from "./loader-registry.ts";
import {
	loadRepoEvalData,
	loadRepoBenchRData,
	loadCrossCodeEvalData,
	loadSWEBenchLiteData,
} from "./generic-loader.ts";

/**
 * Register all built-in loaders.
 * Called once when the loader module is first imported.
 */
export function registerBuiltinLoaders(): void {
	// RepoEval - function/line/api completion benchmark
	registerLoader({
		name: "repoeval",
		aliases: ["repo-eval", "repoeval-function"],
		description: "RepoEval code completion benchmark (function/line/api)",
		loadFn: loadRepoEvalData,
	});

	// LongMemEval - memory/conversation benchmark
	// Uses generic schema-based loading with metadata enrichment for relevance labels
	registerLoader({
		name: "longmemeval",
		aliases: ["long-mem-eval", "longmemeval-v1"],
		description: "LongMemEval memory benchmark with relevance labels",
		// No loadFn - uses generic schema-based loading
		postProcessItem: (item) => {
			// Attach dataset-native relevance labels for retrieval metrics.
			// The official retrieval evaluation treats any corpus_id containing "answer" as relevant.
			const corpusIds = item.contexts
				.map((c) => c.metadata?.corpusId)
				.filter((x): x is string => typeof x === "string");
			const answerCorpusIds = corpusIds.filter((cid) => cid.includes("answer"));

			return {
				...item,
				metadata: {
					...item.metadata,
					corpusIds,
					answerCorpusIds,
					hasRelevanceLabels: answerCorpusIds.length > 0,
					isAbstention: String(item.id).includes("_abs"),
				},
			};
		},
	});

	// RepoBench-R - repository-level retrieval benchmark
	registerLoader({
		name: "repobench-r",
		aliases: ["repobench", "repo-bench-r"],
		description: "RepoBench-R repository-level retrieval benchmark",
		loadFn: loadRepoBenchRData,
	});

	// CrossCodeEval - cross-file code evaluation
	registerLoader({
		name: "crosscodeeval",
		aliases: ["cross-code-eval", "crosscode"],
		description: "CrossCodeEval cross-file code benchmark",
		loadFn: loadCrossCodeEvalData,
	});

	// SWE-bench Lite - software engineering benchmark
	registerLoader({
		name: "swebench-lite",
		aliases: ["swebench", "swe-bench-lite", "swe-bench"],
		description: "SWE-bench Lite software engineering benchmark",
		loadFn: loadSWEBenchLiteData,
	});
}

// Track registration state
let registered = false;

/**
 * Ensure built-in loaders are registered.
 * Call this before using the loader registry.
 * Thread-safe: Sets flag before registration to prevent concurrent calls.
 */
export function ensureBuiltinLoadersRegistered(): void {
	if (registered) return;
	// Set flag FIRST to prevent race condition in concurrent calls
	registered = true;
	registerBuiltinLoaders();
}

/**
 * Reset the registration state (for testing).
 * Called automatically by resetLoaderRegistry().
 */
export function resetBuiltinLoadersRegistration(): void {
	registered = false;
}

// Register the reset callback so resetLoaderRegistry() can reset us too
setBuiltinLoadersResetCallback(resetBuiltinLoadersRegistration);
