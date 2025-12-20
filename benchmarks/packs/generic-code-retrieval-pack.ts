/**
 * Generic Code Retrieval Pack
 *
 * Consolidated factory for all code retrieval benchmark packs.
 * Instead of 4 separate files (~650 lines), we use a config-driven
 * approach with shared infrastructure (~200 lines).
 *
 * Supported datasets:
 *   - repoeval:      Line-range overlap (file + lines)
 *   - repobench-r:   Jaccard similarity (content-based)
 *   - crosscodeeval: Dependency file coverage
 *   - swebench-lite: Modified file recall
 */

import { createHash } from "node:crypto";
import type {
	BenchmarkPack,
	PackId,
	PromptArtifact,
	PackEvaluationResult,
	RunConfig,
} from "./interface.ts";
import type { BenchmarkItem, SearchResult } from "../../core/config.ts";
import {
	isLocationRelevant,
	jaccardSimilarity,
	isJaccardMatch,
	fileMatches,
	crossFileCoverage,
	isCrossCodeRelevant,
	type LineSpan,
	type ChunkLocation,
} from "./relevance.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Ground truth types for different datasets.
 */
type GroundTruthData =
	| { type: "location"; file: string; startLine: number; endLine: number }
	| { type: "snippets"; goldSnippets: string[] }
	| { type: "files"; files: string[] };

/**
 * Configuration for a code retrieval dataset.
 */
interface DatasetConfig {
	benchmarkName: string;
	packId: PackId;

	/** Extract ground truth from item metadata */
	getGroundTruth: (item: BenchmarkItem) => GroundTruthData | null;

	/** Error message when no ground truth found */
	noGTMessage: string;

	/** Check if a search result is relevant to the ground truth */
	checkRelevance: (result: SearchResult, gt: GroundTruthData) => boolean;

	/** Compute score from top results and ground truth */
	computeScore: (
		topResults: SearchResult[],
		gt: GroundTruthData,
		checkRelevance: (result: SearchResult, gt: GroundTruthData) => boolean,
	) => { score: number; correct: boolean; answer: string; reasoning: string };
}

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Compute SHA-256 hash of a string.
 */
function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * Extract chunk location from search result metadata.
 */
function getChunkLocation(result: SearchResult): ChunkLocation | null {
	const meta = result.metadata;
	if (!meta) return null;

	const filepath = meta.filepath as string | undefined;
	if (!filepath) return null;

	return {
		filepath,
		startLine: meta.startLine as number | undefined,
		endLine: meta.endLine as number | undefined,
	};
}

/**
 * Get file path from search result metadata.
 */
function getChunkFilepath(result: SearchResult): string | null {
	const filepath = result.metadata?.filepath as string | undefined;
	return filepath || null;
}

// ============================================================================
// Score Computation Strategies
// ============================================================================

/** Default Jaccard threshold for RepoBench-R */
const DEFAULT_JACCARD_THRESHOLD = 0.7;

/**
 * Binary hit@k scoring: 1 if any relevant chunk in top-k, else 0.
 * Used by RepoEval.
 */
function binaryHitAtKScore(
	topResults: SearchResult[],
	gt: GroundTruthData,
	checkRelevance: (result: SearchResult, gt: GroundTruthData) => boolean,
): { score: number; correct: boolean; answer: string; reasoning: string } {
	const topK = topResults.length;
	const relevantChunks = topResults.filter((r) => checkRelevance(r, gt));
	const hasRelevant = relevantChunks.length > 0;

	const gtInfo = gt.type === "location"
		? `${gt.file}:${gt.startLine}-${gt.endLine}`
		: `${gt.type}`;

	return {
		score: hasRelevant ? 1 : 0,
		correct: hasRelevant,
		answer: hasRelevant
			? `Found ${relevantChunks.length} relevant chunk(s) in top-${topK}`
			: `No relevant chunks in top-${topK}`,
		reasoning: [
			`Ground truth: ${gtInfo}`,
			`Retrieved ${topResults.length} chunks`,
			`Relevant chunks: ${relevantChunks.length}`,
			hasRelevant
				? `First relevant at rank ${topResults.findIndex((r) => relevantChunks.includes(r)) + 1}`
				: "No overlap with ground truth",
		].join("\n"),
	};
}

/**
 * Jaccard-based hit@k scoring for RepoBench-R.
 */
function jaccardHitAtKScore(
	topResults: SearchResult[],
	gt: GroundTruthData,
	checkRelevance: (result: SearchResult, gt: GroundTruthData) => boolean,
): { score: number; correct: boolean; answer: string; reasoning: string } {
	if (gt.type !== "snippets") {
		return { score: 0, correct: false, answer: "[wrong gt type]", reasoning: "Expected snippets" };
	}

	const topK = topResults.length;
	const relevantChunks: Array<{ result: SearchResult; jaccardScore: number }> = [];

	for (const result of topResults) {
		for (const snippet of gt.goldSnippets) {
			const score = jaccardSimilarity(result.content, snippet);
			if (score >= DEFAULT_JACCARD_THRESHOLD) {
				relevantChunks.push({ result, jaccardScore: score });
				break;
			}
		}
	}

	const hasRelevant = relevantChunks.length > 0;

	return {
		score: hasRelevant ? 1 : 0,
		correct: hasRelevant,
		answer: hasRelevant
			? `Found ${relevantChunks.length} matching chunk(s) in top-${topK}`
			: `No matching chunks in top-${topK}`,
		reasoning: [
			`Gold snippets: ${gt.goldSnippets.length}`,
			`Retrieved ${topResults.length} chunks`,
			`Jaccard threshold: ${DEFAULT_JACCARD_THRESHOLD}`,
			`Matching chunks: ${relevantChunks.length}`,
			hasRelevant
				? `Best match: Jaccard=${relevantChunks[0]!.jaccardScore.toFixed(3)}`
				: "No chunks exceeded Jaccard threshold",
		].join("\n"),
	};
}

/**
 * Coverage-based scoring for CrossCodeEval.
 */
function coverageScore(
	topResults: SearchResult[],
	gt: GroundTruthData,
	_checkRelevance: (result: SearchResult, gt: GroundTruthData) => boolean,
): { score: number; correct: boolean; answer: string; reasoning: string } {
	if (gt.type !== "files") {
		return { score: 0, correct: false, answer: "[wrong gt type]", reasoning: "Expected files" };
	}

	const topK = topResults.length;
	const retrievedFiles: string[] = [];
	for (const result of topResults) {
		const filepath = getChunkFilepath(result);
		if (filepath && !retrievedFiles.includes(filepath)) {
			retrievedFiles.push(filepath);
		}
	}

	const coverage = crossFileCoverage(retrievedFiles, gt.files);
	const hasRelevant = coverage > 0;
	const coveredCount = Math.round(coverage * gt.files.length);

	return {
		score: coverage,
		correct: hasRelevant,
		answer: hasRelevant
			? `Retrieved ${coveredCount}/${gt.files.length} dependency files in top-${topK}`
			: `No dependency files in top-${topK}`,
		reasoning: [
			`Dependency files (${gt.files.length}): ${gt.files.slice(0, 5).join(", ")}${gt.files.length > 5 ? "..." : ""}`,
			`Retrieved files (unique): ${retrievedFiles.length}`,
			`Covered dependencies: ${coveredCount}`,
			`Coverage@${topK}: ${(coverage * 100).toFixed(1)}%`,
		].join("\n"),
	};
}

/**
 * Recall-based scoring for SWE-bench Lite.
 */
function recallScore(
	topResults: SearchResult[],
	gt: GroundTruthData,
	_checkRelevance: (result: SearchResult, gt: GroundTruthData) => boolean,
): { score: number; correct: boolean; answer: string; reasoning: string } {
	if (gt.type !== "files") {
		return { score: 0, correct: false, answer: "[wrong gt type]", reasoning: "Expected files" };
	}

	const topK = topResults.length;
	const retrievedFiles = new Set<string>();
	const coveredModifiedFiles = new Set<string>();

	for (const result of topResults) {
		const chunkFile = getChunkFilepath(result);
		if (!chunkFile) continue;

		retrievedFiles.add(chunkFile);

		for (const modifiedFile of gt.files) {
			if (fileMatches(chunkFile, [modifiedFile])) {
				coveredModifiedFiles.add(modifiedFile);
			}
		}
	}

	const fileRecall = coveredModifiedFiles.size / gt.files.length;
	const hasRelevant = coveredModifiedFiles.size > 0;

	return {
		score: fileRecall,
		correct: hasRelevant,
		answer: hasRelevant
			? `Retrieved ${coveredModifiedFiles.size}/${gt.files.length} modified files in top-${topK}`
			: `No modified files in top-${topK}`,
		reasoning: [
			`Modified files (${gt.files.length}): ${gt.files.join(", ")}`,
			`Retrieved files (unique): ${retrievedFiles.size}`,
			`Covered modified files: ${coveredModifiedFiles.size}`,
			`File recall@${topK}: ${(fileRecall * 100).toFixed(1)}%`,
		].join("\n"),
	};
}

// ============================================================================
// Dataset Configurations
// ============================================================================

const DATASET_CONFIGS: Record<string, DatasetConfig> = {
	repoeval: {
		benchmarkName: "repoeval",
		packId: "repoeval@chunking-v1" as PackId,
		noGTMessage: "No ground truth metadata found for this item",

		getGroundTruth: (item): GroundTruthData | null => {
			const gt = item.metadata?.groundTruth as { file?: string; startLine?: number; endLine?: number } | undefined;
			if (!gt || typeof gt.file !== "string") return null;
			return { type: "location", file: gt.file, startLine: gt.startLine ?? 1, endLine: gt.endLine ?? 1 };
		},

		checkRelevance: (result, gt): boolean => {
			if (gt.type !== "location") return false;
			const chunkLocation = getChunkLocation(result);
			if (!chunkLocation) return false;
			const targetSpan: LineSpan = { startLine: gt.startLine, endLine: gt.endLine };
			return isLocationRelevant(chunkLocation, gt.file, targetSpan);
		},

		computeScore: binaryHitAtKScore,
	},

	"repobench-r": {
		benchmarkName: "repobench-r",
		packId: "repobench-r@chunking-v1" as PackId,
		noGTMessage: "No gold snippets found in metadata",

		getGroundTruth: (item): GroundTruthData | null => {
			const snippets = item.metadata?.goldSnippets;
			if (!Array.isArray(snippets)) return null;
			const validSnippets = snippets.filter((s): s is string => typeof s === "string");
			if (validSnippets.length === 0) return null;
			return { type: "snippets", goldSnippets: validSnippets };
		},

		checkRelevance: (result, gt): boolean => {
			if (gt.type !== "snippets") return false;
			for (const snippet of gt.goldSnippets) {
				if (isJaccardMatch(result.content, snippet, DEFAULT_JACCARD_THRESHOLD)) {
					return true;
				}
			}
			return false;
		},

		computeScore: jaccardHitAtKScore,
	},

	crosscodeeval: {
		benchmarkName: "crosscodeeval",
		packId: "crosscodeeval@chunking-v1" as PackId,
		noGTMessage: "No dependency files found in metadata",

		getGroundTruth: (item): GroundTruthData | null => {
			const files = item.metadata?.dependencyFiles;
			if (!Array.isArray(files)) return null;
			const validFiles = files.filter((f): f is string => typeof f === "string");
			if (validFiles.length === 0) return null;
			return { type: "files", files: validFiles };
		},

		checkRelevance: (result, gt): boolean => {
			if (gt.type !== "files") return false;
			const chunkFile = getChunkFilepath(result);
			if (!chunkFile) return false;
			return isCrossCodeRelevant(chunkFile, gt.files);
		},

		computeScore: coverageScore,
	},

	"swebench-lite": {
		benchmarkName: "swebench-lite",
		packId: "swebench-lite@chunking-v1" as PackId,
		noGTMessage: "No modified files found in patch metadata",

		getGroundTruth: (item): GroundTruthData | null => {
			const files = item.metadata?.modifiedFiles;
			if (!Array.isArray(files)) return null;
			const validFiles = files.filter((f): f is string => typeof f === "string");
			if (validFiles.length === 0) return null;
			return { type: "files", files: validFiles };
		},

		checkRelevance: (result, gt): boolean => {
			if (gt.type !== "files") return false;
			const chunkFile = getChunkFilepath(result);
			if (!chunkFile) return false;
			return fileMatches(chunkFile, gt.files);
		},

		computeScore: recallScore,
	},
};

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a code retrieval benchmark pack from configuration.
 */
export function createCodeRetrievalPack(datasetName: string): BenchmarkPack {
	const config = DATASET_CONFIGS[datasetName];
	if (!config) {
		throw new Error(`Unknown dataset: ${datasetName}. Available: ${Object.keys(DATASET_CONFIGS).join(", ")}`);
	}

	return {
		benchmarkName: config.benchmarkName,
		packId: config.packId,

		sealedSemantics: {
			prompts: true,
			scoring: true,
			relevance: true,
		},

		buildAnswerPrompt(input): PromptArtifact {
			const text = input.item.question;
			return { text, sha256: sha256(text) };
		},

		buildJudgePrompt(): PromptArtifact | undefined {
			return undefined;
		},

		async evaluate(input: {
			item: BenchmarkItem;
			retrieved: SearchResult[];
			run: RunConfig;
		}): Promise<PackEvaluationResult> {
			const { item, retrieved, run } = input;
			const gt = config.getGroundTruth(item);

			if (!gt) {
				return {
					answer: "[no ground truth]",
					score: 0,
					correct: false,
					reasoning: config.noGTMessage,
				};
			}

			const topK = run.topK ?? 10;
			const topResults = retrieved.slice(0, topK);

			return config.computeScore(topResults, gt, config.checkRelevance);
		},

		isRelevant(input: {
			item: BenchmarkItem;
			result: SearchResult;
		}): boolean {
			const { item, result } = input;
			const gt = config.getGroundTruth(item);
			if (!gt) return false;
			return config.checkRelevance(result, gt);
		},
	};
}

// ============================================================================
// Pre-built Packs (backward compatibility)
// ============================================================================

export const repoEvalPack = createCodeRetrievalPack("repoeval");
export const repoBenchRPack = createCodeRetrievalPack("repobench-r");
export const crossCodeEvalPack = createCodeRetrievalPack("crosscodeeval");
export const sweBenchLitePack = createCodeRetrievalPack("swebench-lite");
