/**
 * Hard Negatives Generation Module
 *
 * Generates hard negatives to increase benchmark difficulty.
 * 
 * Strategy comparison (from research):
 * - cross-repo: Random files from other repos → EASY (embedding model trivially distinguishes)
 * - same-repo: Other files from SAME repo → MEDIUM (same vocabulary/style)
 * - bm25: Files with high lexical overlap → HARD (requires semantic understanding)
 * - embedding: Files with high cosine similarity → HARDEST (most challenging)
 *
 * Same embedding model is used for all chunkers, so only chunking quality varies.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PreparedData } from "../../core/config.ts";
import { findFilesWithExtensions } from "./download/download-utils.ts";
import { getRepoListForTaskType } from "./download/yaml-config.ts";

export interface HardNegativesConfig {
	enabled: boolean;
	strategy: "cross-repo" | "same-repo" | "bm25" | "embedding";
	count: number;
	maxFilesPerRepo: number;
}

export interface HardNegativesContext {
	currentRepo: string;
	reposDir: string;
	config: HardNegativesConfig;
	taskType: string;
	query?: string;           // Needed for BM25/embedding strategies
	targetFile?: string;      // File to exclude from negatives
	existingContexts?: PreparedData[];  // Already loaded contexts
}

/**
 * Generate hard negatives based on strategy.
 */
export async function generateHardNegatives(
	ctx: HardNegativesContext,
): Promise<PreparedData[]> {
	if (!ctx.config.enabled) return [];

	switch (ctx.config.strategy) {
		case "cross-repo":
			return crossRepoNegatives(ctx);
		case "same-repo":
			return sameRepoNegatives(ctx);
		case "bm25":
			return bm25Negatives(ctx);
		case "embedding":
			return embeddingNegatives(ctx);
		default:
			return crossRepoNegatives(ctx);
	}
}

/**
 * Generate cross-repository hard negatives (EASY - baseline).
 * Adds random files from OTHER repositories as distractors.
 */
async function crossRepoNegatives(
	ctx: HardNegativesContext,
): Promise<PreparedData[]> {
	const negatives: PreparedData[] = [];
	const allRepos = getRepoListForTaskType("repoeval", ctx.taskType);
	const otherRepos = allRepos.filter((r) => r !== ctx.currentRepo);

	for (const otherRepo of otherRepos) {
		const otherRepoDir = join(ctx.reposDir, otherRepo);
		if (!existsSync(otherRepoDir)) continue;

		const pyFiles = findFilesWithExtensions(otherRepoDir, new Set([".py"]));
		const sampled = shuffle(pyFiles).slice(0, ctx.config.maxFilesPerRepo);

		for (const filepath of sampled) {
			if (negatives.length >= ctx.config.count) break;

			try {
				const content = await readFile(filepath, "utf-8");
				const relPath = filepath.replace(`${otherRepoDir}/`, "");
				negatives.push({
					id: `${otherRepo}:${relPath}:hard-negative`,
					content,
					metadata: {
						filepath: relPath,
						repo: otherRepo,
						absolutePath: filepath,
						isHardNegative: true,
						sourceRepo: otherRepo,
						negativeType: "cross-repo",
					},
				});
			} catch {
				/* skip unreadable files */
			}
		}

		if (negatives.length >= ctx.config.count) break;
	}

	return negatives;
}

/**
 * Generate same-repository hard negatives (MEDIUM difficulty).
 * 
 * Uses OTHER files from the SAME repo that are NOT the target file.
 * This is harder because they share vocabulary, imports, and coding style.
 */
async function sameRepoNegatives(
	ctx: HardNegativesContext,
): Promise<PreparedData[]> {
	// If we already have existingContexts, we can just mark non-target ones as hard negatives
	// Otherwise, we need to load files from the repo
	
	const negatives: PreparedData[] = [];
	const repoDir = join(ctx.reposDir, ctx.currentRepo);
	
	if (!existsSync(repoDir)) return [];
	
	const pyFiles = findFilesWithExtensions(repoDir, new Set([".py"]));
	
	// Filter out the target file if specified
	// Compare relative paths (from repo root) to handle absolute vs relative path differences
	const candidateFiles = ctx.targetFile 
		? pyFiles.filter(filepath => {
				const relPath = filepath.replace(`${repoDir}/`, "").replace(/\\/g, "/");
				return relPath !== ctx.targetFile;
			})
		: pyFiles;
	
	// Shuffle and take up to count
	const sampled = shuffle(candidateFiles).slice(0, ctx.config.count);
	
	for (const filepath of sampled) {
		try {
			const content = await readFile(filepath, "utf-8");
			const relPath = filepath.replace(`${repoDir}/`, "");
			negatives.push({
				id: `${ctx.currentRepo}:${relPath}:same-repo-negative`,
				content,
				metadata: {
					filepath: relPath,
					repo: ctx.currentRepo,
					absolutePath: filepath,
					isHardNegative: true,
					negativeType: "same-repo",
				},
			});
		} catch {
			/* skip unreadable files */
		}
	}
	
	return negatives;
}

/**
 * Generate BM25-mined hard negatives (HARD difficulty).
 * 
 * Finds files with high lexical overlap with the query.
 * These are files that contain similar terms but are NOT the answer.
 */
async function bm25Negatives(
	ctx: HardNegativesContext,
): Promise<PreparedData[]> {
	if (!ctx.query) {
		console.warn("[hard-negatives] BM25 strategy requires query, falling back to same-repo");
		return sameRepoNegatives(ctx);
	}
	
	const negatives: PreparedData[] = [];
	const allRepos = getRepoListForTaskType("repoeval", ctx.taskType);
	
	// Build a simple BM25-like scorer based on query terms
	const queryTerms = tokenize(ctx.query);
	const termIdf = new Map<string, number>();
	
	// Collect all candidate files across repos
	const candidates: Array<{ filepath: string; content: string; repo: string; score: number }> = [];
	
	for (const repo of allRepos) {
		const repoDir = join(ctx.reposDir, repo);
		if (!existsSync(repoDir)) continue;
		
		const pyFiles = findFilesWithExtensions(repoDir, new Set([".py"]));
		
		for (const filepath of pyFiles) {
			// Skip target file (compare relative paths for accuracy)
			if (ctx.targetFile && repo === ctx.currentRepo) {
				const relPath = filepath.replace(`${repoDir}/`, "").replace(/\\/g, "/");
				if (relPath === ctx.targetFile) {
					continue;
				}
			}
			
			try {
				const content = await readFile(filepath, "utf-8");
				const docTerms = tokenize(content);
				
				// Calculate BM25-like score (simplified)
				let score = 0;
				for (const term of queryTerms) {
					const tf = docTerms.filter(t => t === term).length;
					if (tf > 0) {
						// Simple TF-IDF approximation
						score += Math.log(1 + tf) * (queryTerms.filter(t => t === term).length);
					}
				}
				
				if (score > 0) {
					candidates.push({
						filepath,
						content,
						repo,
						score,
					});
				}
			} catch {
				/* skip */
			}
		}
	}
	
	// Sort by score descending and take top N (excluding the answer which would be at top)
	candidates.sort((a, b) => b.score - a.score);
	
	// Take top candidates as hard negatives (they have high lexical overlap but aren't the answer)
	const topCandidates = candidates.slice(0, ctx.config.count);
	
	for (const candidate of topCandidates) {
		const relPath = candidate.filepath.replace(`${join(ctx.reposDir, candidate.repo)}/`, "");
		negatives.push({
			id: `${candidate.repo}:${relPath}:bm25-negative`,
			content: candidate.content,
			metadata: {
				filepath: relPath,
				repo: candidate.repo,
				absolutePath: candidate.filepath,
				isHardNegative: true,
				negativeType: "bm25",
				bm25Score: candidate.score,
			},
		});
	}
	
	return negatives;
}

/**
 * Generate embedding-mined hard negatives (HARDEST difficulty).
 * 
 * Finds files with high cosine similarity to query embedding.
 * Requires pre-computed embeddings or live embedding.
 */
async function embeddingNegatives(
	ctx: HardNegativesContext,
): Promise<PreparedData[]> {
	// For now, fall back to BM25 as embedding requires infrastructure
	// TODO: Implement with pre-computed embeddings or live embedding API
	console.warn("[hard-negatives] Embedding strategy not yet implemented, falling back to BM25");
	return bm25Negatives(ctx);
}

/**
 * Simple tokenizer for BM25 scoring.
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9_]/g, " ")
		.split(/\s+/)
		.filter(t => t.length > 2);
}

/**
 * Fisher-Yates shuffle for random sampling.
 */
function shuffle<T>(array: T[]): T[] {
	const result = [...array];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = result[i]!;
		result[i] = result[j]!;
		result[j] = temp;
	}
	return result;
}

// Keep the old function signature for backwards compatibility
export async function generateCrossRepoNegatives(
	currentRepo: string,
	reposDir: string,
	config: HardNegativesConfig,
	taskType: string = "function",
): Promise<PreparedData[]> {
	return generateHardNegatives({
		currentRepo,
		reposDir,
		config,
		taskType,
	});
}
