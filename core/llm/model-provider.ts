/**
 * Centralized LLM Model Provider Factory
 *
 * Provides a unified interface for creating AI SDK model providers.
 * Supports: anthropic, openai, google, openrouter
 *
 * Usage:
 * ```typescript
 * import { getModelProvider } from "../core/llm/index.ts";
 *
 * const model = getModelProvider("openrouter/openai/gpt-4");
 * const { text } = await generateText({ model, prompt: "Hello" });
 * ```
 */

import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { generateText } from "ai";

/**
 * Type alias for AI SDK model providers.
 */
export type ModelProvider = Parameters<typeof generateText>[0]["model"];

/**
 * Get the model provider for a given model string.
 * Returns a model compatible with the AI SDK's generateText function.
 *
 * @param modelString - Model identifier in format "provider/model" or just "model"
 *   Examples:
 *   - "anthropic/claude-3-sonnet-20240229"
 *   - "openai/gpt-4"
 *   - "openrouter/openai/gpt-4"
 *   - "claude-3-sonnet-20240229" (inferred as anthropic)
 *   - "gpt-4" (inferred as openai)
 *
 * @returns AI SDK compatible model provider
 */
export function getModelProvider(modelString: string): ModelProvider {
	const [provider, ...modelParts] = modelString.split("/");
	const model = modelParts.join("/") || modelString;

	switch (provider) {
		case "anthropic":
		case "claude":
			return anthropic(model);

		case "google":
			return google(model);

		case "openai":
			return openai(model);

		case "openrouter": {
			const openrouter = createOpenRouter({
				apiKey: process.env.OPENROUTER_API_KEY,
			});
			// Use .chat() for chat models as per AI SDK OpenRouter docs
			return openrouter.chat(model) as unknown as ModelProvider;
		}

		default: {
			const hasSlash = modelString.includes("/");

			if (hasSlash) {
				// User explicitly specified a provider - must be supported
				const supportedProviders = ["anthropic", "claude", "google", "openai", "openrouter"];
				throw new Error(
					`Unknown model provider: "${provider}"\n\n` +
					`Supported providers: ${supportedProviders.join(", ")}\n\n` +
					`Usage examples:\n` +
					`  - anthropic/claude-3-sonnet-20240229\n` +
					`  - openai/gpt-4\n` +
					`  - openrouter/openai/gpt-4\n` +
					`  - google/gemini-pro\n\n` +
					`Or use a bare model name for automatic inference:\n` +
					`  - claude-3-opus (inferred as anthropic)\n` +
					`  - gpt-4 (inferred as openai)`
				);
			}

			// Bare model name - try to infer provider
			if (modelString.includes("claude")) {
				return anthropic(modelString);
			}
			if (modelString.includes("gpt")) {
				return openai(modelString);
			}
			if (modelString.includes("gemini")) {
				return google(modelString);
			}

			// Can't infer provider - throw with guidance
			const supportedProviders = ["anthropic", "claude", "google", "openai", "openrouter"];
			throw new Error(
				`Cannot infer provider for model: "${modelString}"\n\n` +
				`Please specify a provider using the format: provider/model\n` +
				`Supported providers: ${supportedProviders.join(", ")}\n\n` +
				`Examples:\n` +
				`  - anthropic/claude-3-sonnet-20240229\n` +
				`  - openai/gpt-4\n` +
				`  - openrouter/openai/gpt-4`
			);
		}
	}
}
