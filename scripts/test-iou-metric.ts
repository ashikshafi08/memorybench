/**
 * Test the IoU metric
 */

import { IoUAt5Metric, IoUAt10Metric } from "../core/metrics/builtin/iou.ts";
import type { EvalResult, SearchResult } from "../core/config.ts";

// Create mock eval result with chunks
function createMockResult(
	groundTruth: { file: string; startLine: number; endLine: number },
	chunks: Array<{ filepath: string; startLine: number; endLine: number; score: number }>
): EvalResult {
	const retrievedContext: SearchResult[] = chunks.map((c, i) => ({
		id: `chunk-${i}`,
		content: `Chunk content ${i}`,
		score: c.score,
		metadata: {
			filepath: c.filepath,
			startLine: c.startLine,
			endLine: c.endLine,
		},
	}));

	return {
		itemId: "test-1",
		benchmark: "repoeval",
		provider: "test-provider",
		question: "test query",
		expected: "expected answer",
		actual: "actual answer",
		score: 0.5,
		correct: true,
		reasoning: "test",
		retrievedContext,
		metadata: { groundTruth },
	};
}

// Test scenarios
const gt = { file: "utils/helper.py", startLine: 0, endLine: 19 };

console.log("=== IoU METRIC TEST ===\n");
console.log("Ground truth:", gt);
console.log();

// Scenario 1: Perfect alignment
const perfectChunks = [
	{ filepath: "utils/helper.py", startLine: 0, endLine: 19, score: 0.9 },
];
const perfectResult = createMockResult(gt, perfectChunks);

// Scenario 2: Large imprecise chunk
const largeChunks = [
	{ filepath: "utils/helper.py", startLine: 0, endLine: 61, score: 0.9 },
];
const largeResult = createMockResult(gt, largeChunks);

// Scenario 3: Medium aligned chunk
const mediumChunks = [
	{ filepath: "utils/helper.py", startLine: 0, endLine: 25, score: 0.9 },
];
const mediumResult = createMockResult(gt, mediumChunks);

// Scenario 4: Wrong file chunks
const wrongFileChunks = [
	{ filepath: "other/file.py", startLine: 0, endLine: 19, score: 0.9 },
];
const wrongFileResult = createMockResult(gt, wrongFileChunks);

// Compute metrics
const iou5 = new IoUAt5Metric();
const iou10 = new IoUAt10Metric();

const scenarios = [
	{ name: "Perfect chunk (0-19)", result: perfectResult, expectedIoU: 1.0 },
	{ name: "Large chunk (0-61)", result: largeResult, expectedIoU: 0.32 },
	{ name: "Medium chunk (0-25)", result: mediumResult, expectedIoU: 0.77 },
	{ name: "Wrong file", result: wrongFileResult, expectedIoU: 0.0 },
];

console.log("Scenario Results:");
console.log("-".repeat(60));

for (const scenario of scenarios) {
	const metric = iou5.compute([scenario.result]);
	const pass = Math.abs(metric.value - scenario.expectedIoU) < 0.05;
	console.log(`${pass ? "✅" : "❌"} ${scenario.name}`);
	console.log(`   Expected IoU: ${scenario.expectedIoU.toFixed(2)}, Got: ${metric.value.toFixed(2)}`);
	console.log(`   Details: ${JSON.stringify(metric.details)}`);
}

console.log("\n=== SUMMARY ===");
console.log("IoU metric now available as: iou_at_1, iou_at_3, iou_at_5, iou_at_10");
console.log("Add to your YAML config: metrics: [iou_at_5, iou_at_10, ...]");
