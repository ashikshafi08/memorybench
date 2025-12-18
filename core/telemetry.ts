/**
 * Telemetry types for capturing per-item latency and cost data.
 * These fields are added to EvalResult.metadata to enable future
 * latency/cost metrics without schema changes.
 */

/**
 * Telemetry data captured during evaluation of a single item.
 * All fields are optional to maintain backward compatibility.
 */
export interface ItemTelemetry {
	/**
	 * Time taken to search for relevant context (milliseconds).
	 */
	searchLatencyMs?: number;

	/**
	 * Time taken to generate the answer (LLM call, milliseconds).
	 * Only populated when using llm-judge evaluation method.
	 */
	answerLatencyMs?: number;

	/**
	 * Time taken for the judge LLM to evaluate the answer (milliseconds).
	 * Only populated when using llm-judge evaluation method.
	 */
	judgeLatencyMs?: number;

	/**
	 * Total evaluation time for this item (milliseconds).
	 */
	totalLatencyMs?: number;

	/**
	 * Number of tokens used for search/retrieval.
	 * For embeddings-based search, this might be the input tokens.
	 */
	searchTokens?: number;

	/**
	 * Number of tokens in the answer generation prompt (input).
	 */
	answerInputTokens?: number;

	/**
	 * Number of tokens in the generated answer (output).
	 */
	answerOutputTokens?: number;

	/**
	 * Number of tokens in the judge prompt (input).
	 */
	judgeInputTokens?: number;

	/**
	 * Number of tokens in the judge response (output).
	 */
	judgeOutputTokens?: number;

	/**
	 * Estimated cost for this item's evaluation (USD).
	 * Calculated based on token usage and model pricing.
	 */
	estimatedCostUsd?: number;
}

/**
 * Merge telemetry data into EvalResult metadata.
 * This is a helper to ensure telemetry fields are properly namespaced.
 */
export function addTelemetryToMetadata(
	metadata: Record<string, unknown>,
	telemetry: ItemTelemetry,
): Record<string, unknown> {
	return {
		...metadata,
		telemetry,
	};
}

/**
 * Extract telemetry from EvalResult metadata.
 */
export function extractTelemetry(
	metadata: Record<string, unknown>,
): ItemTelemetry | undefined {
	return metadata.telemetry as ItemTelemetry | undefined;
}

/**
 * Utility to measure execution time of an async function.
 */
export async function measureLatency<T>(
	fn: () => Promise<T>,
): Promise<{ result: T; latencyMs: number }> {
	const start = performance.now();
	const result = await fn();
	const latencyMs = performance.now() - start;
	return { result, latencyMs };
}
