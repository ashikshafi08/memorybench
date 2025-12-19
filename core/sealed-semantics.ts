/**
 * Sealed Semantics Enforcement
 * 
 * Ensures that when a benchmark pack exists, YAML configs cannot override
 * semantic fields (prompts, scoring, relevance). Fails fast with clear errors.
 */

import type { BenchmarkConfig } from "./config.ts";
import type { BenchmarkPack } from "../benchmarks/packs/interface.ts";
import { getPackRegistry } from "../benchmarks/packs/index.ts";

/**
 * Semantic fields that cannot be overridden when a pack exists.
 */
const SEMANTIC_FIELDS = {
	prompts: [
		"evaluation.answerPrompt",
		"evaluation.judgePrompts",
	],
	scoring: [
		"evaluation.method",
		"evaluation.customEvaluator",
	],
	relevance: [
		// Relevance is typically computed by the pack's isRelevant method,
		// but we don't have explicit YAML fields for this yet.
		// This is a placeholder for future enforcement.
	],
} as const;

/**
 * Check if a benchmark config attempts to override sealed semantics.
 * 
 * @param config - Benchmark config from YAML
 * @param pack - Benchmark pack (if exists)
 * @throws Error if pack exists and config tries to override sealed semantics
 */
export function validateSealedSemantics(
	config: BenchmarkConfig,
	pack: BenchmarkPack | undefined,
): void {
	if (!pack) {
		// No pack exists, YAML can configure everything
		return;
	}

	const errors: string[] = [];

	// Check prompts
	if (pack.sealedSemantics.prompts) {
		if (config.evaluation?.answerPrompt) {
			errors.push(
				`Benchmark "${config.name}" has a pack (${pack.packId}) that owns prompt semantics. ` +
				`Cannot override 'evaluation.answerPrompt' in YAML. Remove this field from the config.`,
			);
		}
		if (config.evaluation?.judgePrompts) {
			errors.push(
				`Benchmark "${config.name}" has a pack (${pack.packId}) that owns prompt semantics. ` +
				`Cannot override 'evaluation.judgePrompts' in YAML. Remove this field from the config.`,
			);
		}
	}

	// Check scoring
	if (pack.sealedSemantics.scoring) {
		const method = config.evaluation?.method;
		if (method !== undefined) {
			errors.push(
				`Benchmark "${config.name}" has a pack (${pack.packId}) that owns scoring semantics. ` +
				`Cannot set 'evaluation.method' in YAML (got "${method}"). Remove this field from the config.`,
			);
		}

		if (config.evaluation?.customEvaluator !== undefined) {
			errors.push(
				`Benchmark "${config.name}" has a pack (${pack.packId}) that owns scoring semantics. ` +
				`Cannot set 'evaluation.customEvaluator' in YAML. Remove this field from the config.`,
			);
		}
	}

	if (errors.length > 0) {
		throw new Error(
			`Sealed semantics violation for benchmark "${config.name}":\n` +
			errors.map((e) => `  - ${e}`).join("\n") +
			`\n\nTo fix: Remove the semantic fields from the YAML config. ` +
			`The pack (${pack.packId}) is the source of truth for these semantics.`,
		);
	}
}

/**
 * Get the pack for a benchmark and validate sealed semantics.
 * 
 * @param config - Benchmark config
 * @param packId - Optional pack ID (if not provided, uses latest)
 * @returns Pack if exists, undefined otherwise
 * @throws Error if pack exists and config violates sealed semantics
 */
export function getPackAndValidate(
	config: BenchmarkConfig,
	packId?: string,
): BenchmarkPack | undefined {
	const registry = getPackRegistry();
	const pack = packId
		? registry.get(config.name, packId as `${string}@${string}`)
		: registry.getLatest(config.name);

	if (pack) {
		validateSealedSemantics(config, pack);
	}

	return pack;
}

