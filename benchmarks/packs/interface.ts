/**
 * Benchmark Pack Interface
 * 
 * Benchmark packs encode paper-faithful prompt templates, scoring logic, and relevance
 * functions. They are the source of truth for semantic behavior, preventing drift from
 * YAML configuration overrides.
 */

import type { BenchmarkItem, SearchResult } from "../../core/config.ts";

/**
 * Versioned pack identifier (e.g., "longmemeval@paper-v1")
 */
export type PackId = `${string}@${string}`;

/**
 * Prompt artifact with stable hash for drift detection and golden tests.
 */
export type PromptArtifact = {
	text: string;
	sha256: string; // stable hash for golden tests + drift detection
};

/**
 * Run configuration passed to pack methods.
 * Contains model selections, top-k, and other runtime parameters.
 */
export interface RunConfig {
	answeringModel?: string;
	judgeModel?: string;
	topK?: number;
	[k: string]: unknown;
}

/**
 * Evaluation result from a benchmark pack.
 */
export interface PackEvaluationResult {
	answer: string;
	score: number;
	correct: boolean;
	judgeResponse?: string;
	reasoning?: string;
}

/**
 * Benchmark Pack Interface
 * 
 * A benchmark pack is the source of truth for:
 * - Answer prompt templates (paper-faithful)
 * - Judge prompt templates (when applicable)
 * - Scoring/judging logic
 * - Retrieval relevance definitions
 * 
 * YAML configs cannot override these semantics when a pack exists.
 */
export interface BenchmarkPack {
	/**
	 * Benchmark name (must match BenchmarkConfig.name)
	 */
	readonly benchmarkName: string;

	/**
	 * Versioned pack identifier (e.g., "longmemeval@paper-v1")
	 * Recorded in every run for reproducibility.
	 */
	readonly packId: PackId;

	/**
	 * Declares which semantics are pack-owned and therefore non-overridable.
	 * Used by sealed semantics enforcement to fail fast on YAML override attempts.
	 */
	readonly sealedSemantics: {
		prompts: boolean;
		scoring: boolean;
		relevance: boolean;
	};

	/**
	 * Build the canonical answer prompt (paper-faithful).
	 * Returns both the rendered text and a stable SHA-256 hash for drift detection.
	 * 
	 * @param input - Item, retrieved results, and run config
	 * @returns Prompt artifact with text and hash
	 */
	buildAnswerPrompt(input: {
		item: BenchmarkItem;
		retrieved: SearchResult[];
		run: RunConfig;
	}): PromptArtifact;

	/**
	 * Build the canonical judge prompt (when applicable).
	 * Returns both the rendered text and a stable SHA-256 hash for drift detection.
	 * 
	 * @param input - Item, generated answer, and run config
	 * @returns Prompt artifact with text and hash, or undefined if no judge is used
	 */
	buildJudgePrompt?(input: {
		item: BenchmarkItem;
		answer: string;
		run: RunConfig;
	}): PromptArtifact | undefined;

	/**
	 * Evaluate end-to-end correctness.
	 * Either performs direct scoring (e.g., F1) or orchestrates LLM judge calls.
	 * 
	 * @param input - Item, retrieved results, and run config
	 * @returns Evaluation result with answer, score, correctness, and optional judge response
	 */
	evaluate(input: {
		item: BenchmarkItem;
		retrieved: SearchResult[];
		run: RunConfig;
	}): Promise<PackEvaluationResult>;

	/**
	 * Determine if a retrieved result is relevant for retrieval metrics.
	 * Uses dataset-native labels (e.g., LoCoMo qa.evidence IDs, LongMemEval corpus IDs).
	 * 
	 * @param input - Item and retrieved result
	 * @returns true if the result is relevant according to dataset labels
	 */
	isRelevant(input: {
		item: BenchmarkItem;
		result: SearchResult;
	}): boolean;
}

