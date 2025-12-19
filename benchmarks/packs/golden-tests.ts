/**
 * Golden Tests for Benchmark Packs
 * 
 * Validates that packs produce expected prompts and scoring outputs on fixed test slices.
 * This prevents drift from upstream benchmark semantics.
 */

import type { BenchmarkPack } from "./interface.ts";
import type { BenchmarkItem, SearchResult } from "../../core/config.ts";
import { getPackRegistry } from "./index.ts";

/**
 * Golden test result
 */
export interface GoldenTestResult {
	packId: string;
	passed: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Run golden tests for a pack.
 * 
 * @param pack - The pack to test
 * @param testItems - Fixed set of test items with expected outputs
 * @returns Test result
 */
export async function runGoldenTests(
	pack: BenchmarkPack,
	testItems: Array<{
		item: BenchmarkItem;
		retrieved: SearchResult[];
		expectedAnswerPromptHash?: string;
		expectedJudgePromptHash?: string;
		expectedScore?: number;
		expectedCorrect?: boolean;
	}>,
): Promise<GoldenTestResult> {
	const errors: string[] = [];
	const warnings: string[] = [];

	for (const [i, test] of testItems.entries()) {
		const runConfig = {};

		// Test answer prompt
		try {
			const answerPrompt = pack.buildAnswerPrompt({
				item: test.item,
				retrieved: test.retrieved,
				run: runConfig,
			});

			if (test.expectedAnswerPromptHash) {
				if (answerPrompt.sha256 !== test.expectedAnswerPromptHash) {
					errors.push(
						`Item ${i} (${test.item.id}): Answer prompt hash mismatch. ` +
						`Expected: ${test.expectedAnswerPromptHash}, Got: ${answerPrompt.sha256}`,
					);
				}
			} else {
				warnings.push(
					`Item ${i} (${test.item.id}): No expected answer prompt hash provided`,
				);
			}
		} catch (error) {
			errors.push(
				`Item ${i} (${test.item.id}): Failed to build answer prompt: ${error}`,
			);
		}

		// Test judge prompt (if applicable)
		if (pack.buildJudgePrompt) {
			try {
				// Generate a mock answer for judge prompt testing
				const mockAnswer = "Mock answer for testing";
				const judgePrompt = pack.buildJudgePrompt({
					item: test.item,
					answer: mockAnswer,
					run: runConfig,
				});

				if (judgePrompt && test.expectedJudgePromptHash) {
					if (judgePrompt.sha256 !== test.expectedJudgePromptHash) {
						errors.push(
							`Item ${i} (${test.item.id}): Judge prompt hash mismatch. ` +
							`Expected: ${test.expectedJudgePromptHash}, Got: ${judgePrompt.sha256}`,
						);
					}
				}
			} catch (error) {
				errors.push(
					`Item ${i} (${test.item.id}): Failed to build judge prompt: ${error}`,
				);
			}
		}

		// Test evaluation (if expected outputs provided)
		if (test.expectedScore !== undefined || test.expectedCorrect !== undefined) {
			try {
				const result = await pack.evaluate({
					item: test.item,
					retrieved: test.retrieved,
					run: runConfig,
				});

				if (test.expectedScore !== undefined) {
					const tolerance = 0.01; // Allow small floating point differences
					if (Math.abs(result.score - test.expectedScore) > tolerance) {
						errors.push(
							`Item ${i} (${test.item.id}): Score mismatch. ` +
							`Expected: ${test.expectedScore}, Got: ${result.score}`,
						);
					}
				}

				if (test.expectedCorrect !== undefined) {
					if (result.correct !== test.expectedCorrect) {
						errors.push(
							`Item ${i} (${test.item.id}): Correctness mismatch. ` +
							`Expected: ${test.expectedCorrect}, Got: ${result.correct}`,
						);
					}
				}
			} catch (error) {
				errors.push(
					`Item ${i} (${test.item.id}): Failed to evaluate: ${error}`,
				);
			}
		}
	}

	return {
		packId: pack.packId,
		passed: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * Run golden tests for all registered packs.
 * 
 * @param testData - Map of pack IDs to test items
 * @returns Map of pack IDs to test results
 */
export async function runAllGoldenTests(
	testData: Map<
		string,
		Array<{
			item: BenchmarkItem;
			retrieved: SearchResult[];
			expectedAnswerPromptHash?: string;
			expectedJudgePromptHash?: string;
			expectedScore?: number;
			expectedCorrect?: boolean;
		}>
	>,
): Promise<Map<string, GoldenTestResult>> {
	const registry = getPackRegistry();
	const results = new Map<string, GoldenTestResult>();

	for (const pack of registry.list()) {
		const testItems = testData.get(pack.packId);
		if (testItems) {
			const result = await runGoldenTests(pack, testItems);
			results.set(pack.packId, result);
		} else {
			results.set(pack.packId, {
				packId: pack.packId,
				passed: false,
				errors: [`No test data provided for pack ${pack.packId}`],
				warnings: [],
			});
		}
	}

	return results;
}

