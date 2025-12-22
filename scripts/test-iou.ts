/**
 * Test IoU threshold implementation
 */

import { isLocationRelevant, lineRangeIoU } from "../benchmarks/packs/relevance.ts";

console.log("=== IoU THRESHOLD TEST ===\n");

const gt = {
	file: "trlx/pipeline/__init__.py",
	startLine: 0,
	endLine: 19,  // 20 lines
};

console.log("Ground truth:", gt.file, `lines ${gt.startLine}-${gt.endLine} (${gt.endLine - gt.startLine + 1} lines)`);
console.log();

// Test cases with different chunk sizes
const chunks = [
	{ startLine: 0, endLine: 61, desc: "Large chunk (lines 0-61)" },    // IoU = 20/62 = 0.32
	{ startLine: 0, endLine: 25, desc: "Medium chunk (lines 0-25)" },   // IoU = 20/26 = 0.77
	{ startLine: 0, endLine: 19, desc: "Exact match (lines 0-19)" },    // IoU = 20/20 = 1.0
	{ startLine: 5, endLine: 25, desc: "Offset chunk (lines 5-25)" },   // IoU = 15/26 = 0.58
	{ startLine: 15, endLine: 25, desc: "Partial (lines 15-25)" },      // IoU = 5/26 = 0.19
	{ startLine: 50, endLine: 100, desc: "No overlap (lines 50-100)" }, // IoU = 0
];

const thresholds = [0, 0.3, 0.5, 0.7];

console.log("Chunk Sizes and IoU Scores:");
console.log("-".repeat(80));

for (const chunk of chunks) {
	const iou = lineRangeIoU(
		{ startLine: chunk.startLine, endLine: chunk.endLine },
		{ startLine: gt.startLine, endLine: gt.endLine }
	);
	
	const relevance = thresholds.map(t => {
		const isRel = isLocationRelevant(
			{ filepath: gt.file, startLine: chunk.startLine, endLine: chunk.endLine },
			gt.file,
			{ startLine: gt.startLine, endLine: gt.endLine },
			{ iouThreshold: t }
		);
		return isRel ? "✅" : "❌";
	});
	
	console.log(`${chunk.desc}`);
	console.log(`  IoU = ${iou.toFixed(2)} | Thresholds: ${thresholds.map((t, i) => `${t}=${relevance[i]}`).join(", ")}`);
}

console.log();
console.log("=== EXPECTED IMPACT ON RECALL ===");
console.log("With large chunks (0-61) and target (0-19):");
console.log("  - IoU threshold 0.0 → Relevant ✅ (any overlap)");
console.log("  - IoU threshold 0.5 → NOT Relevant ❌ (0.32 < 0.5)");
console.log();
console.log("This means with iouThreshold: 0.5, ONLY well-aligned chunks count as relevant!");
console.log("Chunkers that create large, imprecise chunks will have LOWER recall.");
