/**
 * LLM-based evaluation using judge prompts.
 * Supports configurable answering models and judge prompts.
 */

import { generateText } from "ai";
import type { BenchmarkConfig, BenchmarkItem, SearchResult } from "../../core/config.ts";
import { getModelProvider } from "../../core/llm/index.ts";
import {
	registerEvaluator,
	getEvaluator,
	getEvaluatorNames,
	UnknownEvaluatorError,
	type EvaluationResult,
	type EvaluatorOptions,
} from "./evaluator-registry.ts";

// Re-export types from evaluator-registry for backward compatibility
export type { EvaluationResult, EvaluatorOptions } from "./evaluator-registry.ts";


/**
 * Interpolate template variables in a prompt.
 */
function interpolatePrompt(
	template: string,
	variables: Record<string, unknown>,
): string {
	return template.replace(/\$\{(\w+)\}/g, (_, key) => {
		const value = variables[key];
		return value !== undefined ? String(value) : "";
	});
}

/**
 * LoCoMo uses a Porter stemmer + SQuAD-style normalization for token-F1.
 * We implement the original Porter stemming algorithm (1980), matching the
 * behavior expected by LoCoMo's evaluation script.
 */
function porterStem(word: string): string {
	// Classic Porter stemming algorithm (1980).
	// Adapted from the canonical widely-used JS implementation.
	let w = word.toLowerCase();
	if (w.length < 3) return w;

	const step2list: Record<string, string> = {
		ational: "ate",
		tional: "tion",
		enci: "ence",
		anci: "ance",
		izer: "ize",
		abli: "able",
		alli: "al",
		entli: "ent",
		eli: "e",
		ousli: "ous",
		ization: "ize",
		ation: "ate",
		ator: "ate",
		alism: "al",
		iveness: "ive",
		fulness: "ful",
		ousness: "ous",
		aliti: "al",
		iviti: "ive",
		biliti: "ble",
		logi: "log",
	};

	const step3list: Record<string, string> = {
		icate: "ic",
		ative: "",
		alize: "al",
		iciti: "ic",
		ical: "ic",
		ful: "",
		ness: "",
	};

	const c = "[^aeiou]"; // consonant
	const v = "[aeiouy]"; // vowel
	const C = `${c}[^aeiouy]*`;
	const V = `${v}[aeiou]*`;

	const mgr0 = new RegExp(`^(${C})?${V}${C}`); // m > 0
	const meq1 = new RegExp(`^(${C})?${V}${C}(${V})?$`); // m == 1
	const mgr1 = new RegExp(`^(${C})?${V}${C}${V}${C}`); // m > 1
	const s_v = new RegExp(`^(${C})?${v}`); // vowel in stem

	const re1a = /^(.+?)(ss|i)es$/;
	const re1a2 = /^(.+?)([^s])s$/;
	const re1b = /^(.+?)eed$/;
	const re1b2 = /^(.+?)(ed|ing)$/;
	const re1c = /^(.+?)y$/;

	const re2 =
		/^(.+?)(ational|tional|enci|anci|izer|abli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
	const re3 = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
	const re4 =
		/^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ion|ou|ism|ate|iti|ous|ive|ize)$/;
	const re5 = /^(.+?)e$/;
	const re5_2 = /^(.+?)ll$/;

	// Special case for initial y
	const firstch = w.charAt(0);
	if (firstch === "y") w = `Y${w.slice(1)}`;

	// Step 1a
	if (re1a.test(w)) w = w.replace(re1a, "$1$2");
	else if (re1a2.test(w)) w = w.replace(re1a2, "$1$2");

	// Step 1b
	if (re1b.test(w)) {
		const fp = re1b.exec(w);
		const stem = fp?.[1] ?? "";
		if (stem && mgr0.test(stem)) w = w.replace(re1b, "$1ee");
	} else if (re1b2.test(w)) {
		const fp = re1b2.exec(w);
		{
			const stem = fp?.[1] ?? "";
			if (stem && s_v.test(stem)) {
				w = stem;
				if (/(at|bl|iz)$/.test(w)) w += "e";
				else if (/(bb|dd|ff|gg|mm|nn|pp|rr|tt)$/.test(w)) w = w.replace(/.$/, "");
				else if (meq1.test(w) && /[^aeiou][aeiouy][^aeiouwxy]$/.test(w)) w += "e";
			}
		}
	}

	// Step 1c
	if (re1c.test(w)) {
		const fp = re1c.exec(w);
		const stem = fp?.[1] ?? "";
		if (stem && s_v.test(stem)) w = `${stem}i`;
	}

	// Step 2
	if (re2.test(w)) {
		const fp = re2.exec(w);
		{
			const stem = fp?.[1] ?? "";
			const suffix = fp?.[2] ?? "";
			if (stem && suffix && mgr0.test(stem)) {
				const repl = step2list[suffix];
				if (repl !== undefined) w = stem + repl;
			}
		}
	}

	// Step 3
	if (re3.test(w)) {
		const fp = re3.exec(w);
		{
			const stem = fp?.[1] ?? "";
			const suffix = fp?.[2] ?? "";
			if (stem && suffix && mgr0.test(stem)) {
				const repl = step3list[suffix];
				if (repl !== undefined) w = stem + repl;
			}
		}
	}

	// Step 4
	if (re4.test(w)) {
		const fp = re4.exec(w);
		{
			const stem = fp?.[1] ?? "";
			const suffix = fp?.[2] ?? "";
			if (stem && suffix && mgr1.test(stem)) {
				if (suffix === "ion") {
					if (/[st]$/.test(stem)) w = stem;
				} else {
					w = stem;
				}
			}
		}
	}

	// Step 5a
	if (re5.test(w)) {
		const fp = re5.exec(w);
		const stem = fp?.[1] ?? "";
		if (
			stem &&
			(mgr1.test(stem) ||
				(meq1.test(stem) && !/[^aeiou][aeiouy][^aeiouwxy]$/.test(stem)))
		) {
			w = stem;
		}
	}

	// Step 5b
	if (re5_2.test(w)) {
		const fp = re5_2.exec(w);
		const stem = fp?.[1] ?? "";
		if (stem && mgr1.test(stem)) w = w.replace(/.$/, "");
	}

	// Restore initial y
	if (firstch === "y") w = `y${w.slice(1)}`;
	return w.toLowerCase();
}

function normalizeLocomoAnswer(s: string): string {
	// Matches LoCoMo evaluation.py normalize_answer()
	const withoutCommas = s.replace(/,/g, "");
	const lowered = withoutCommas.toLowerCase();
	// Remove punctuation (Python string.punctuation)
	const withoutPunc = lowered.replace(/[!"#$%&'()*+\-./:;<=>?@[\]^_`{|}~]/g, "");
	// Remove articles (a|an|the|and)
	const withoutArticles = withoutPunc.replace(/\b(a|an|the|and)\b/g, " ");
	// Collapse whitespace
	return withoutArticles.trim().split(/\s+/).join(" ");
}

function locomoTokens(text: string): string[] {
	const norm = normalizeLocomoAnswer(text);
	if (!norm) return [];
	return norm.split(" ").map((t) => porterStem(t));
}

function locomoF1Score(prediction: string, groundTruth: string): number {
	const predTokens = locomoTokens(prediction);
	const gtTokens = locomoTokens(groundTruth);
	if (predTokens.length === 0 || gtTokens.length === 0) {
		return 0;
	}

	const predCounts = new Map<string, number>();
	for (const t of predTokens) predCounts.set(t, (predCounts.get(t) ?? 0) + 1);
	const gtCounts = new Map<string, number>();
	for (const t of gtTokens) gtCounts.set(t, (gtCounts.get(t) ?? 0) + 1);

	let numSame = 0;
	for (const [t, pc] of predCounts.entries()) {
		const gc = gtCounts.get(t);
		if (gc) numSame += Math.min(pc, gc);
	}
	if (numSame === 0) return 0;

	const precision = numSame / predTokens.length;
	const recall = numSame / gtTokens.length;
	return (2 * precision * recall) / (precision + recall);
}

function locomoMultiAnswerF1(prediction: string, groundTruth: string): number {
	const predictions = prediction.split(",").map((p) => p.trim()).filter(Boolean);
	const groundTruths = groundTruth.split(",").map((g) => g.trim()).filter(Boolean);
	if (groundTruths.length === 0) return 0;
	if (predictions.length === 0) return 0;

	let sum = 0;
	for (const gt of groundTruths) {
		let best = 0;
		for (const pred of predictions) {
			const score = locomoF1Score(pred, gt);
			if (score > best) best = score;
		}
		sum += best;
	}
	return sum / groundTruths.length;
}

function stripLocomoDialogIdPrefix(line: string): string {
	// Common patterns we may store to preserve evidence IDs in content.
	// Example: "D1:3 | 1:56 pm on 8 May, 2023: Caroline said, \"...\""
	return line.replace(/^D\d+:\d+\s*\|\s*/i, "");
}

async function evaluateLocomoQA(
	item: BenchmarkItem,
	searchResults: SearchResult[],
	benchmarkConfig: BenchmarkConfig,
	options?: EvaluatorOptions,
): Promise<EvaluationResult> {
	const evaluationConfig = benchmarkConfig.evaluation;
	const answeringModelConfig = evaluationConfig?.answeringModel;
	const answerPromptConfig = evaluationConfig?.answerPrompt;

	// Resolve model
	const modelString =
		options?.answeringModel ??
		answeringModelConfig?.model ??
		"openrouter/openai/gpt-5-nano";
	const model = getModelProvider(modelString);

	// Choose prompt template (supports category-specific overrides via questionType)
	let promptTemplate: string =
		options?.answerPromptOverride ?? answerPromptConfig?.default ?? "";
	if (!promptTemplate) {
		// Fall back to LoCoMo QA prompt (from locomo/task_eval/gpt_utils.py)
		promptTemplate = `\${retrievedContext}

Based on the above context, write an answer in the form of a short phrase for the following question. Answer with exact words from the context whenever possible.

Question: \${question} Short answer:`;
	}

	if (!options?.answerPromptOverride && answerPromptConfig?.byQuestionType) {
		const questionType = item.questionType ?? item.metadata?.questionType;
		if (questionType) {
			const typePrompt = (answerPromptConfig.byQuestionType as Record<string, string>)[questionType as string];
			if (typePrompt) {
				promptTemplate = typePrompt;
			}
		}
	}

	// Build context string similar to LoCoMo RAG evaluation
	const retrievedContext = searchResults
		.map((r) => stripLocomoDialogIdPrefix(r.content))
		.join("\n");

	const prompt = interpolatePrompt(promptTemplate, {
		question: item.question,
		retrievedContext,
	});

	const { text } = await generateText({
		model,
		prompt,
		temperature: answeringModelConfig?.temperature ?? 0,
	});

	const answer = text.trim();

	// Category-aware scoring (LoCoMo evaluation.py)
	const rawCategory =
		(item.metadata?.categoryId as number | string | undefined) ??
		(item.metadata?.category as number | string | undefined);
	const categoryId = rawCategory !== undefined ? Number(rawCategory) : NaN;

	let score = 0;
	if (!Number.isNaN(categoryId)) {
		// LoCoMo category-specific rules
		if (categoryId === 3) {
			// For category 3, LoCoMo uses the first segment before ';'
			const gt = (item.answer ?? "").split(";")[0]?.trim() ?? "";
			score = locomoF1Score(answer, gt);
		} else if ([2, 4].includes(categoryId)) {
			score = locomoF1Score(answer, item.answer ?? "");
		} else if (categoryId === 1) {
			score = locomoMultiAnswerF1(answer, item.answer ?? "");
		} else if (categoryId === 5) {
			const lower = answer.toLowerCase();
			score =
				lower.includes("no information available") || lower.includes("not mentioned")
					? 1
					: 0;
		} else {
			score = locomoF1Score(answer, item.answer ?? "");
		}
	} else {
		// Fallback: token-F1 without LoCoMo category info
		score = locomoF1Score(answer, item.answer ?? "");
	}

	// LoCoMo reports mean F1 as "accuracy"; keep a boolean for convenience.
	const correct = score >= 0.5;

	return {
		answer,
		judgeResponse: JSON.stringify(
			{
				method: "locomo-qa",
				categoryId: Number.isNaN(categoryId) ? undefined : categoryId,
				score,
			},
			null,
			2,
		),
		correct,
		score,
		reasoning: undefined,
	};
}

/**
 * Generate an answer using the answering model and retrieved context.
 */
export async function generateAnswer(
	item: BenchmarkItem,
	searchResults: SearchResult[],
	benchmarkConfig: BenchmarkConfig,
	options?: EvaluatorOptions,
): Promise<string> {
	const evaluationConfig = benchmarkConfig.evaluation;
	const answeringModelConfig = evaluationConfig?.answeringModel;
	const answerPromptConfig = evaluationConfig?.answerPrompt;

	// Get the model
	const modelString =
		options?.answeringModel ??
		answeringModelConfig?.model ??
		"openrouter/openai/gpt-5-nano";
	const model = getModelProvider(modelString);

	// Get the prompt template
	let promptTemplate: string =
		options?.answerPromptOverride ?? answerPromptConfig?.default ?? "";

	if (!promptTemplate) {
		// Default answer prompt
		promptTemplate = `You are a question-answering system. Based on the retrieved context below, answer the question.

Question: \${question}

Retrieved Context:
\${retrievedContext}

Instructions:
- Identify which parts of the context are relevant to answering the question
- If the context contains enough information, provide a clear, concise answer
- If the context does not contain enough information, respond with "I don't know"
- Base your answer ONLY on the provided context

Answer:`;
	}

	// Handle question-type specific prompts
	if (!options?.answerPromptOverride && answerPromptConfig?.byQuestionType) {
		const questionType = item.questionType ?? item.metadata?.questionType;
		if (questionType) {
			const typePrompt = (answerPromptConfig.byQuestionType as Record<string, string>)[questionType as string];
			if (typePrompt) {
				promptTemplate = typePrompt;
			}
		}
	}

	// Build retrieved context string
	const retrievedContext = searchResults
		.map((r) => r.content)
		.join("\n\n");

	// Interpolate variables
	const prompt = interpolatePrompt(promptTemplate, {
		question: item.question,
		questionDate: item.metadata?.questionDate ?? "",
		retrievedContext,
		expected: item.answer,
	});

	// Generate answer
	const { text } = await generateText({
		model,
		prompt,
		temperature: answeringModelConfig?.temperature ?? 0,
	});

	return text;
}

/**
 * Judge whether an answer is correct using the LLM judge.
 */
export async function judgeAnswer(
	item: BenchmarkItem,
	generatedAnswer: string,
	benchmarkConfig: BenchmarkConfig,
	options?: EvaluatorOptions,
): Promise<{ correct: boolean; score: number; reasoning: string }> {
	const evaluationConfig = benchmarkConfig.evaluation;
	const judgeConfig = evaluationConfig?.judge;
	const judgePromptsConfig = evaluationConfig?.judgePrompts;

	// Get the model
	const modelString =
		options?.judgeModel ??
		judgeConfig?.model ??
		"openrouter/openai/gpt-5-nano";
	const model = getModelProvider(modelString);

	// Get the prompt template
	let promptTemplate: string =
		options?.judgePromptOverride ?? judgePromptsConfig?.default ?? "";

	if (!promptTemplate) {
		// Default judge prompt
		promptTemplate = `I will give you a question, a correct answer, and a response from a model.
Please answer yes if the response contains the correct answer. Otherwise, answer no.
If the response is equivalent to the correct answer or contains all the intermediate
steps to get the correct answer, you should also answer yes.
If the response only contains a subset of the information required, answer no.

Question: \${question}
Correct Answer: \${expected}
Model Response: \${actual}

Does the model response contain the correct answer? Answer with "yes" or "no" followed by a brief explanation.`;
	}

	// Handle question-type specific prompts
	if (!options?.judgePromptOverride && judgePromptsConfig?.byQuestionType) {
		const questionType = item.questionType ?? item.metadata?.questionType;
		if (questionType) {
			const typePrompt = (judgePromptsConfig.byQuestionType as Record<string, string>)[questionType as string];
			if (typePrompt) {
				promptTemplate = typePrompt;
			}
		}
	}

	// Interpolate variables
	const prompt = interpolatePrompt(promptTemplate, {
		question: item.question,
		expected: item.answer,
		actual: generatedAnswer,
		questionDate: item.metadata?.questionDate ?? "",
	});

	// Judge the answer
	const { text } = await generateText({
		model,
		prompt,
		temperature: judgeConfig?.temperature ?? 0,
	});

	// Parse the response
	const lowerText = text.toLowerCase().trim();
	const correct = lowerText.startsWith("yes");
	const score = correct ? 1 : 0;

	return {
		correct,
		score,
		reasoning: text,
	};
}

/**
 * Evaluate an item using LLM judge.
 */
export async function evaluateWithLLMJudge(
	item: BenchmarkItem,
	searchResults: SearchResult[],
	benchmarkConfig: BenchmarkConfig,
	options?: EvaluatorOptions,
): Promise<EvaluationResult> {
	// Generate answer
	const answer = await generateAnswer(
		item,
		searchResults,
		benchmarkConfig,
		options,
	);

	// Judge the answer
	const judgment = await judgeAnswer(item, answer, benchmarkConfig, options);

	return {
		answer,
		judgeResponse: judgment.reasoning,
		correct: judgment.correct,
		score: judgment.score,
		reasoning: judgment.reasoning,
	};
}

/**
 * Judge whether a retrieved chunk is relevant to answering a question.
 * Uses LLM to evaluate semantic relevance when corpus ID matching fails.
 */
export async function judgeRelevance(
	question: string,
	chunk: string,
	options?: {
		model?: string;
		groundTruthAnswer?: string;
	},
): Promise<{ relevant: boolean; confidence: number; reasoning: string }> {
	const modelString = options?.model ?? "openrouter/openai/gpt-4o-mini";
	const model = getModelProvider(modelString);

	// Build prompt that considers both the question and optionally the expected answer
	const answerContext = options?.groundTruthAnswer
		? `\nExpected Answer: ${options.groundTruthAnswer}`
		: "";

	const prompt = `You are evaluating whether a retrieved text chunk is relevant to answering a question.

Question: ${question}${answerContext}

Retrieved Chunk:
"""
${chunk.slice(0, 2000)}
"""

Is this chunk relevant to answering the question? A chunk is relevant if it:
1. Contains information that helps answer the question
2. Contains context needed to understand the answer
3. Contains the answer itself or key parts of it

Respond with ONLY "yes" or "no" followed by a brief explanation (1 sentence).`;

	const { text } = await generateText({
		model,
		prompt,
		temperature: 0,
	});

	const lowerText = text.toLowerCase().trim();
	const relevant = lowerText.startsWith("yes");

	return {
		relevant,
		confidence: relevant ? 0.8 : 0.2, // Simple confidence estimate
		reasoning: text.trim(),
	};
}

/**
 * Batch judge relevance for multiple chunks (more efficient).
 */
export async function judgeRelevanceBatch(
	question: string,
	chunks: Array<{ id: string; content: string }>,
	options?: {
		model?: string;
		groundTruthAnswer?: string;
		maxConcurrent?: number;
	},
): Promise<Map<string, boolean>> {
	const results = new Map<string, boolean>();
	const maxConcurrent = options?.maxConcurrent ?? 5;

	// Process in batches to avoid rate limits
	for (let i = 0; i < chunks.length; i += maxConcurrent) {
		const batch = chunks.slice(i, i + maxConcurrent);
		const promises = batch.map(async (chunk) => {
			try {
				const result = await judgeRelevance(question, chunk.content, {
					model: options?.model,
					groundTruthAnswer: options?.groundTruthAnswer,
				});
				return { id: chunk.id, relevant: result.relevant };
			} catch {
				// On error, default to not relevant
				return { id: chunk.id, relevant: false };
			}
		});

		const batchResults = await Promise.all(promises);
		for (const { id, relevant } of batchResults) {
			results.set(id, relevant);
		}
	}

	return results;
}

/**
 * Simple exact match evaluation (no LLM required).
 */
export function evaluateExactMatch(
	item: BenchmarkItem,
	searchResults: SearchResult[],
): EvaluationResult {
	const retrievedContext = searchResults.map((r) => r.content).join("\n\n");
	const normalizedExpected = item.answer.toLowerCase().trim();
	const normalizedRetrieved = retrievedContext.toLowerCase();

	const correct = normalizedRetrieved.includes(normalizedExpected);

	return {
		answer: retrievedContext.substring(0, 500),
		judgeResponse: correct
			? "Exact match found in retrieved context"
			: "Expected answer not found in retrieved context",
		correct,
		score: correct ? 1 : 0,
	};
}

/**
 * Evaluate based on the benchmark's configured method.
 * Uses the EvaluatorRegistry for pluggable evaluators.
 */
export async function evaluate(
	item: BenchmarkItem,
	searchResults: SearchResult[],
	benchmarkConfig: BenchmarkConfig,
	options?: EvaluatorOptions,
): Promise<EvaluationResult> {
	const method = benchmarkConfig.evaluation?.method ?? "exact-match";
	const customMethod = benchmarkConfig.evaluation?.customEvaluator;

	// First check for custom evaluator, then method
	const evaluatorName = customMethod || method;
	const evaluator = getEvaluator(evaluatorName);

	if (!evaluator) {
		throw new UnknownEvaluatorError(evaluatorName, getEvaluatorNames());
	}

	return evaluator.evaluateFn(item, searchResults, benchmarkConfig, options);
}

// ============================================================================
// Built-in Evaluator Registration
// ============================================================================

// Register built-in evaluators at module load
registerEvaluator({
	name: "llm-judge",
	description: "LLM-based evaluation with answer generation and judge",
	evaluateFn: evaluateWithLLMJudge,
});

registerEvaluator({
	name: "exact-match",
	aliases: ["exact"],
	description: "Simple exact match evaluation",
	evaluateFn: (item, searchResults) => Promise.resolve(evaluateExactMatch(item, searchResults)),
});

registerEvaluator({
	name: "semantic-similarity",
	aliases: ["semantic"],
	description: "Semantic similarity evaluation (falls back to exact-match)",
	// TODO: Implement actual semantic similarity
	evaluateFn: (item, searchResults) => Promise.resolve(evaluateExactMatch(item, searchResults)),
});

registerEvaluator({
	name: "locomo-qa",
	aliases: ["locomo"],
	description: "LoCoMo QA evaluation with category-specific F1 scoring",
	evaluateFn: evaluateLocomoQA,
});

// ---------------------------------------------------------------------------
// LoCoMo helpers (exported for paper-faithful packs + label-grounded metrics)
// ---------------------------------------------------------------------------

export {
	porterStem,
	normalizeLocomoAnswer,
	locomoTokens,
	locomoF1Score,
	locomoMultiAnswerF1,
	stripLocomoDialogIdPrefix,
};

