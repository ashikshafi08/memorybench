/**
 * LLM-based evaluation using judge prompts.
 * Supports configurable answering models and judge prompts.
 */

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import type { BenchmarkConfig, BenchmarkItem, SearchResult } from "../../core/config.ts";

export interface EvaluationResult {
	answer: string;
	judgeResponse: string;
	correct: boolean;
	score: number;
	reasoning?: string;
}

export interface EvaluatorOptions {
	answerPromptOverride?: string;
	judgePromptOverride?: string;
	answeringModel?: string;
	judgeModel?: string;
}

/**
 * Get the model provider for a given model string.
 * Returns a model compatible with the AI SDK's generateText function.
 */
function getModelProvider(modelString: string): Parameters<typeof generateText>[0]["model"] {
	const [provider, ...modelParts] = modelString.split("/");
	const model = modelParts.join("/") || modelString;

	switch (provider) {
		case "anthropic":
			return anthropic(model);
		case "google":
			return google(model);
		case "openai":
			return openai(model);
		case "openrouter": {
			const openrouter = createOpenRouter({
				apiKey: process.env.OPENROUTER_API_KEY,
			});
			// Cast to any to handle OpenRouter's model type compatibility
			return openrouter.chat(model) as unknown as Parameters<typeof generateText>[0]["model"];
		}
		case "claude":
			return anthropic(model);
		default:
			// Default to anthropic for common model names
			if (modelString.includes("claude")) {
				return anthropic(modelString);
			}
			if (modelString.includes("gpt")) {
				return openai(modelString);
			}
			return anthropic(model);
	}
}

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
		"openrouter/openai/gpt-4o-mini";
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
		.map((r, i) => `[${i + 1}] ${r.content}`)
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
		"openrouter/openai/gpt-4o-mini";
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
 */
export async function evaluate(
	item: BenchmarkItem,
	searchResults: SearchResult[],
	benchmarkConfig: BenchmarkConfig,
	options?: EvaluatorOptions,
): Promise<EvaluationResult> {
	const method = benchmarkConfig.evaluation?.method ?? "exact-match";

	switch (method) {
		case "llm-judge":
			return evaluateWithLLMJudge(item, searchResults, benchmarkConfig, options);

		case "exact-match":
			return evaluateExactMatch(item, searchResults);

		case "semantic-similarity":
			// TODO: Implement semantic similarity
			return evaluateExactMatch(item, searchResults);

		case "custom":
			// TODO: Load and run custom evaluator
			return evaluateExactMatch(item, searchResults);

		default:
			return evaluateExactMatch(item, searchResults);
	}
}

