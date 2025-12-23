/**
 * Evaluator Registry - pluggable benchmark evaluators.
 *
 * Replaces hardcoded switch statement in llm-judge.ts with registry-based dispatch.
 * Adding a new evaluator now requires only calling registerEvaluator().
 *
 * @example
 * ```typescript
 * registerEvaluator({
 *   name: "my-evaluator",
 *   evaluateFn: async (item, searchResults, config, options) => {
 *     // Custom evaluation logic
 *     return { answer: "...", judgeResponse: "...", correct: true, score: 1 };
 *   },
 * });
 * ```
 */

import type { BenchmarkConfig, BenchmarkItem, SearchResult } from "../../core/config.ts";
import { BaseRegistry } from "../../core/registry/index.ts";

/**
 * Result of an evaluation.
 */
export interface EvaluationResult {
	answer: string;
	judgeResponse: string;
	correct: boolean;
	score: number;
	reasoning?: string;
}

/**
 * Options passed to evaluator functions.
 */
export interface EvaluatorOptions {
	answerPromptOverride?: string;
	judgePromptOverride?: string;
	answeringModel?: string;
	judgeModel?: string;
}

/**
 * Function signature for evaluators.
 */
export type EvaluatorFn = (
	item: BenchmarkItem,
	searchResults: SearchResult[],
	config: BenchmarkConfig,
	options?: EvaluatorOptions,
) => Promise<EvaluationResult>;

/**
 * Definition of an evaluator.
 */
export interface EvaluatorDefinition {
	/** Evaluator name (matches evaluation.method or evaluation.customEvaluator in config) */
	name: string;
	/** Optional aliases for the evaluator */
	aliases?: readonly string[];
	/** Description of what this evaluator does */
	description?: string;
	/** Async function to evaluate an item */
	evaluateFn: EvaluatorFn;
}

/**
 * Error thrown when an unknown evaluator is requested.
 * Provides a list of available evaluators to help users fix their configuration.
 */
export class UnknownEvaluatorError extends Error {
	constructor(
		public readonly requestedEvaluator: string,
		public readonly availableEvaluators: string[],
	) {
		const available = availableEvaluators.length > 0
			? availableEvaluators.join(", ")
			: "none registered";
		super(
			`Unknown evaluator: "${requestedEvaluator}". ` +
			`Available evaluators: ${available}. ` +
			`Check your benchmark config's evaluation.method or evaluation.customEvaluator field.`
		);
		this.name = "UnknownEvaluatorError";
	}
}

/**
 * Registry for evaluators.
 *
 * Extends BaseRegistry with evaluator-specific methods.
 */
export class EvaluatorRegistry extends BaseRegistry<EvaluatorDefinition> {
	constructor() {
		super({ name: "EvaluatorRegistry", throwOnConflict: true });
	}

	/**
	 * Register an evaluator definition.
	 */
	register(def: EvaluatorDefinition): void {
		this.registerItem(def.name, def, def.aliases);
	}

	/**
	 * Get an evaluator by name or alias.
	 */
	getEvaluator(nameOrAlias: string): EvaluatorDefinition | undefined {
		return super.get(nameOrAlias);
	}

	/**
	 * Get all registered evaluator names.
	 */
	getEvaluatorNames(): string[] {
		return this.keys();
	}
}

// Singleton instance
let globalEvaluatorRegistry: EvaluatorRegistry | null = null;

/**
 * Get the global evaluator registry.
 */
export function getEvaluatorRegistry(): EvaluatorRegistry {
	if (!globalEvaluatorRegistry) {
		globalEvaluatorRegistry = new EvaluatorRegistry();
	}
	return globalEvaluatorRegistry;
}

/**
 * Reset the evaluator registry (for testing).
 */
export function resetEvaluatorRegistry(): void {
	globalEvaluatorRegistry = null;
}

/**
 * Register an evaluator in the global registry.
 */
export function registerEvaluator(def: EvaluatorDefinition): void {
	getEvaluatorRegistry().register(def);
}

/**
 * Get an evaluator by name from the global registry.
 */
export function getEvaluator(name: string): EvaluatorDefinition | undefined {
	return getEvaluatorRegistry().getEvaluator(name);
}

/**
 * Get all registered evaluator names.
 */
export function getEvaluatorNames(): string[] {
	return getEvaluatorRegistry().getEvaluatorNames();
}
