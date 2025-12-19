/**
 * LongMemEval Benchmark Pack
 * 
 * Paper-faithful implementation matching LongMemEval/src/generation/run_generation.py
 * and LongMemEval/src/evaluation/evaluate_qa.py
 * 
 * Pack ID: longmemeval@paper-v1
 */

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { BenchmarkPack, PackId, PromptArtifact, RunConfig, PackEvaluationResult } from "./interface.ts";
import type { BenchmarkItem, SearchResult } from "../../core/config.ts";
import { createPromptArtifact } from "./utils.ts";

const PACK_ID: PackId = "longmemeval@paper-v1";

/**
 * Get model provider for a model string (matches llm-judge.ts logic)
 */
function getModelProvider(modelString: string): Parameters<typeof generateText>[0]["model"] {
	const [provider, ...modelParts] = modelString.split("/");
	const model = modelParts.join("/") || modelString;

	switch (provider) {
		case "anthropic":
			return anthropic(model);
		case "openai":
			return openai(model);
		case "openrouter": {
			const openrouter = createOpenRouter({
				apiKey: process.env.OPENROUTER_API_KEY,
			});
			return openrouter.chat(model) as unknown as Parameters<typeof generateText>[0]["model"];
		}
		default:
			if (modelString.includes("gpt")) {
				return openai(modelString);
			}
			if (modelString.includes("claude")) {
				return anthropic(modelString);
			}
			return openai(modelString);
	}
}

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
 * Format LongMemEval history chats for answer prompt.
 * Matches LongMemEval/src/generation/run_generation.py prepare_prompt()
 */
function formatHistoryChats(retrieved: SearchResult[], questionDate?: string): string {
	const chunks: string[] = [];
	
	for (const result of retrieved) {
		const content = result.content;
		const date = result.metadata?.date as string | undefined;
		const sessionDate = date || questionDate;
		
		if (sessionDate) {
			chunks.push(`[${sessionDate}]\n${content}`);
		} else {
			chunks.push(content);
		}
	}
	
	return chunks.join("\n\n");
}

/**
 * Build answer prompt matching LongMemEval paper format.
 * Matches LongMemEval/src/generation/run_generation.py prepare_prompt()
 */
function buildLongMemEvalAnswerPrompt(
	item: BenchmarkItem,
	retrieved: SearchResult[],
	run: RunConfig,
): string {
	const questionDate = (item.metadata?.questionDate as string | undefined) || 
		(item.metadata?.question_date as string | undefined);
	const historyChats = formatHistoryChats(retrieved, questionDate);
	
	// Default prompt template from LongMemEval (non-CoT, no user facts)
	// Matches line 57 in run_generation.py
	const template = `I will give you several history chats between you and a user. Please answer the question based on the relevant chat history.

History Chats:

${historyChats}

Current Date: ${questionDate || "N/A"}
Question: ${item.question}
Answer:`;

	return template;
}

/**
 * Get judge prompt for a question type.
 * Matches LongMemEval/src/evaluation/evaluate_qa.py get_anscheck_prompt()
 */
function getJudgePrompt(
	questionType: string,
	question: string,
	correctAnswer: string,
	response: string,
	abstention: boolean,
): string {
	if (abstention) {
		return `I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.

Question: ${question}

Explanation: ${correctAnswer}

Model Response: ${response}

Does the model correctly identify the question as unanswerable? Answer yes or no only.`;
	}

	switch (questionType) {
		case "single-session-user":
		case "single-session-assistant":
		case "multi-session":
			return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.

Question: ${question}

Correct Answer: ${correctAnswer}

Model Response: ${response}

Is the model response correct? Answer yes or no only.`;

		case "temporal-reasoning":
			return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no. In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model's response is still correct.

Question: ${question}

Correct Answer: ${correctAnswer}

Model Response: ${response}

Is the model response correct? Answer yes or no only.`;

		case "knowledge-update":
			return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response contains some previous information along with an updated answer, the response should be considered as correct as long as the updated answer is the required answer.

Question: ${question}

Correct Answer: ${correctAnswer}

Model Response: ${response}

Is the model response correct? Answer yes or no only.`;

		case "single-session-preference":
			return `I will give you a question, a rubric for desired personalized response, and a response from a model. Please answer yes if the response satisfies the desired response. Otherwise, answer no. The model does not need to reflect all the points in the rubric. The response is correct as long as it recalls and utilizes the user's personal information correctly.

Question: ${question}

Rubric: ${correctAnswer}

Model Response: ${response}

Is the model response correct? Answer yes or no only.`;

		default:
			// Fallback to default prompt
			return `I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.

Question: ${question}

Correct Answer: ${correctAnswer}

Model Response: ${response}

Is the model response correct? Answer yes or no only.`;
	}
}

/**
 * LongMemEval Benchmark Pack
 */
export const longMemEvalPack: BenchmarkPack = {
	benchmarkName: "longmemeval",
	packId: PACK_ID,
	sealedSemantics: {
		prompts: true,
		scoring: true,
		relevance: true,
	},

	buildAnswerPrompt({ item, retrieved, run }): PromptArtifact {
		const prompt = buildLongMemEvalAnswerPrompt(item, retrieved, run);
		return createPromptArtifact(prompt);
	},

	buildJudgePrompt({ item, answer, run }): PromptArtifact | undefined {
		const questionType = (item.metadata?.questionType as string | undefined) ||
			(item.questionType as string | undefined) ||
			"default";
		const questionId = item.id;
		const isAbstention = questionId.includes("_abs");
		
		const prompt = getJudgePrompt(
			questionType,
			item.question,
			item.answer,
			answer,
			isAbstention,
		);
		
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
		
		// Build judge prompt
		const judgePromptArtifact = this.buildJudgePrompt?.({ item, answer: trimmedAnswer, run });
		if (!judgePromptArtifact) {
			throw new Error("LongMemEval pack requires judge prompt");
		}
		
		// Get judge model
		const judgeModel = run.judgeModel || "openrouter/openai/gpt-5-nano";
		const judgeModelProvider = getModelProvider(judgeModel);
		
		// Judge answer
		const { text: judgeResponse } = await generateText({
			model: judgeModelProvider,
			prompt: judgePromptArtifact.text,
			temperature: 0,
		});
		
		const label = judgeResponse.toLowerCase().includes("yes");
		const score = label ? 1 : 0;
		
		return {
			answer: trimmedAnswer,
			score,
			correct: label,
			judgeResponse: JSON.stringify({
				model: judgeModel,
				label,
				response: judgeResponse.trim(),
			}, null, 2),
		};
	},

	isRelevant({ item, result }): boolean {
		// LongMemEval retrieval evaluation (paper code) marks any corpus_id containing
		// "answer" as relevant and excludes abstention (_abs) instances.
		//
		// See:
		// - LongMemEval/src/retrieval/run_retrieval.py (correct_docs = [doc_id for doc_id in corpus_ids if "answer" in doc_id])
		// - LongMemEval/src/evaluation/print_retrieval_metrics.py (filters out _abs)

		// Skip abstention/unanswerable instances for retrieval relevance.
		if (String(item.id).includes("_abs") || item.metadata?.isAbstention === true) {
			return false;
		}

		// Prefer explicit corpusId metadata (Tier 1).
		let corpusId: string | undefined =
			typeof result.metadata?.corpusId === "string" ? result.metadata.corpusId : undefined;
		if (!corpusId) {
			// Try to recover from a CTXID prefix embedded in content (Tier 2).
			// Format: [CTXID:<id>] ...
			const m = /^\[CTXID:([^\]]+)\]\s*/.exec(result.content);
			if (m?.[1]) {
				corpusId = m[1];
			}
		}
		if (!corpusId) {
			// Last resort: attempt to use the result id.
			corpusId = result.id;
		}

		// Dataset-native relevance: any id containing "answer" is relevant.
		// (We defensively exclude "noans" even if it contains "ans".)
		const lower = corpusId.toLowerCase();
		if (lower.includes("noans")) return false;
		if (lower.includes("answer")) return true;

		// If the loader provided explicit answerCorpusIds, use them as a stricter check.
		const answerCorpusIds = item.metadata?.answerCorpusIds;
		if (Array.isArray(answerCorpusIds)) {
			const set = new Set(answerCorpusIds.map((x) => String(x)));
			if (set.has(corpusId)) return true;
			// Also allow matching turn-level ids by stripping one trailing _<int>.
			const stripped = corpusId.replace(/_(\d+)$/, "");
			if (stripped !== corpusId && set.has(stripped)) return true;
		}

		return false;
	},
};

