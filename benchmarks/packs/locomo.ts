/**
 * LoCoMo Benchmark Pack
 *
 * Paper-faithful implementation matching locomo/task_eval/evaluation.py
 * and locomo/task_eval/gpt_utils.py
 *
 * Pack ID: locomo@paper-v1
 */

import { generateText } from "ai";
import type { BenchmarkPack, PackId, PromptArtifact, RunConfig, PackEvaluationResult } from "./interface.ts";
import type { BenchmarkItem, SearchResult } from "../../core/config.ts";
import { createPromptArtifact } from "./utils.ts";
import { getModelProvider } from "../../core/llm/index.ts";
import {
	porterStem,
	normalizeLocomoAnswer,
	locomoTokens,
	locomoF1Score,
	locomoMultiAnswerF1,
	stripLocomoDialogIdPrefix,
} from "../evaluators/llm-judge.ts";

const PACK_ID: PackId = "locomo@paper-v1";

/**
 * Interpolate template variables in a prompt.
 */
function interpolatePrompt(template: string, variables: Record<string, unknown>): string {
	return template.replace(/\$\{(\w+)\}/g, (_, key) => {
		const value = variables[key];
		return value !== undefined ? String(value) : "";
	});
}

/**
 * Build LoCoMo answer prompt.
 * Matches locomo/task_eval/gpt_utils.py QA_PROMPT and QA_PROMPT_CAT_5
 */
function buildLocomoAnswerPrompt(
	item: BenchmarkItem,
	retrieved: SearchResult[],
	run: RunConfig,
): string {
	const categoryId = item.metadata?.categoryId as number | undefined;
	const questionType = item.questionType || String(categoryId);
	
	// Build retrieved context (strip dialog ID prefixes)
	const retrievedContext = retrieved
		.map((r) => stripLocomoDialogIdPrefix(r.content))
		.join("\n");
	
	// Category 5 (Adversarial) uses different prompt
	if (categoryId === 5) {
		const template = `${retrievedContext}

Based on the above context, answer the following question.

Question: ${item.question} Short answer:`;
		return template;
	}
	
	// Default QA prompt for categories 1-4
	// Note: LoCoMo requires temporal reasoning - relative dates like "yesterday" must be 
	// converted to absolute dates based on the message timestamp.
	const template = `${retrievedContext}

Based on the above context, answer the following question. If the answer involves a relative time expression (like "yesterday", "last week", "last year"), convert it to an absolute date using the timestamp shown in the context. Give a short, direct answer.

Question: ${item.question} Short answer:`;
	
	return template;
}

/**
 * LoCoMo Benchmark Pack
 */
export const locomoPack: BenchmarkPack = {
	benchmarkName: "locomo",
	packId: PACK_ID,
	sealedSemantics: {
		prompts: true,
		scoring: true,
		relevance: true,
	},

	buildAnswerPrompt({ item, retrieved, run }): PromptArtifact {
		const prompt = buildLocomoAnswerPrompt(item, retrieved, run);
		return createPromptArtifact(prompt);
	},

	async evaluate({ item, retrieved, run }): Promise<PackEvaluationResult> {
		// Build answer prompt
		const answerPromptArtifact = this.buildAnswerPrompt({ item, retrieved, run });
		
		// Get answering model
		const answeringModel = run.answeringModel || "openrouter/openai/gpt-5-nano";
		const model = getModelProvider(answeringModel);
		
		// Generate answer
		const { text: answer } = await generateText({
			model,
			prompt: answerPromptArtifact.text,
			temperature: 0,
		});
		
		const trimmedAnswer = answer.trim();
		
		// Category-aware scoring (LoCoMo evaluation.py)
		const categoryId = item.metadata?.categoryId as number | undefined;
		
		let score = 0;
		if (categoryId !== undefined && !Number.isNaN(categoryId)) {
			if (categoryId === 3) {
				// Category 3: use first segment before ';'
				const gt = (item.answer ?? "").split(";")[0]?.trim() ?? "";
				score = locomoF1Score(trimmedAnswer, gt);
			} else if ([2, 4].includes(categoryId)) {
				score = locomoF1Score(trimmedAnswer, item.answer ?? "");
			} else if (categoryId === 1) {
				// Multi-answer F1 for category 1
				score = locomoMultiAnswerF1(trimmedAnswer, item.answer ?? "");
			} else if (categoryId === 5) {
				// Adversarial: check for abstention phrases
				const lower = trimmedAnswer.toLowerCase();
				score = (lower.includes("no information available") || lower.includes("not mentioned")) ? 1 : 0;
			} else {
				score = locomoF1Score(trimmedAnswer, item.answer ?? "");
			}
		} else {
			// Fallback: token-F1 without category info
			score = locomoF1Score(trimmedAnswer, item.answer ?? "");
		}
		
		const correct = score >= 0.5;
		
		return {
			answer: trimmedAnswer,
			score,
			correct,
			judgeResponse: JSON.stringify({
				method: "locomo-qa",
				categoryId: categoryId !== undefined ? categoryId : undefined,
				score,
			}, null, 2),
		};
	},

	isRelevant({ item, result }): boolean {
		// LoCoMo relevance is determined by qa.evidence dialog IDs
		// Check if result's ID or metadata matches evidence IDs from item.metadata.evidence
		const evidence = item.metadata?.evidence;
		if (!evidence) {
			// No evidence labels available, cannot determine relevance
			return false;
		}
		
		// Evidence can be a single ID or array of IDs (dia_id format like "D1:3")
		const evidenceIds = Array.isArray(evidence) ? evidence : [evidence];
		const evidenceIdSet = new Set(evidenceIds.map((id) => String(id).trim()).filter(Boolean));

		// Collect dialog IDs for this retrieved result (exact matching; no substring heuristics).
		const resultDialogIds = new Set<string>();

		// Tier 1: provider preserved metadata
		const metaDialogIds = result.metadata?.dialogIds;
		if (Array.isArray(metaDialogIds)) {
			for (const id of metaDialogIds) {
				if (typeof id === "string" && id.trim()) resultDialogIds.add(id.trim());
			}
		}
		const singleMetaId = result.metadata?.dialogId ?? result.metadata?.dia_id;
		if (typeof singleMetaId === "string" && singleMetaId.trim()) {
			resultDialogIds.add(singleMetaId.trim());
		}

		// Tier 2: CTXID prefix embedded in content
		// Format: [CTXID:D1:3,D1:4] ...
		const ctxid = /^\[CTXID:([^\]]+)\]\s*/.exec(result.content)?.[1];
		if (ctxid) {
			for (const id of ctxid.split(",").map((s) => s.trim()).filter(Boolean)) {
				resultDialogIds.add(id);
			}
		}

		// Last resort: parse dialog IDs from result.id (stable IDs may embed dia_id)
		const idMatches = result.id.match(/D\d+:\d+/g);
		if (idMatches) {
			for (const id of idMatches) resultDialogIds.add(id);
		}

		// Also attempt to parse from content if the provider returns dia_id prefixes
		const contentMatches = result.content.match(/D\d+:\d+/g);
		if (contentMatches) {
			for (const id of contentMatches) resultDialogIds.add(id);
		}

		for (const evidenceId of evidenceIdSet) {
			if (resultDialogIds.has(evidenceId)) {
				return true;
			}
		}

		// Fallback for external providers that re-chunk content and lose dialog IDs:
		// Check if the answer text (or key answer words) appears in the retrieved content.
		// This is a heuristic but better than always returning false.
		if (item.answer && result.content) {
			const answerLower = item.answer.toLowerCase().trim();
			const contentLower = result.content.toLowerCase();
			
			// For short answers (< 20 chars), check exact substring match
			if (answerLower.length < 20) {
				if (contentLower.includes(answerLower)) return true;
			} else {
				// For longer answers, check if key words (3+ chars) appear
				const answerWords = answerLower.split(/\s+/).filter(w => w.length >= 3);
				if (answerWords.length > 0) {
					const matches = answerWords.filter(w => contentLower.includes(w));
					// If >50% of key words match, consider relevant
					if (matches.length / answerWords.length > 0.5) return true;
				}
			}
		}

		return false;
	},
};

