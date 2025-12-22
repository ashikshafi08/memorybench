import { isLocationRelevant, lineRangeOverlaps } from "../benchmarks/packs/relevance.ts";

console.log("=== RELEVANCE CHECK TESTS ===\n");

const gt = {
	file: "trlx/pipeline/__init__.py",
	startLine: 0,
	endLine: 19,
};

console.log("Ground truth:", gt);
console.log();

const testCases = [
	{ filepath: gt.file, startLine: gt.startLine, endLine: gt.endLine, desc: "exact match" },
	{ filepath: gt.file, startLine: 0, endLine: 5, desc: "partial overlap (0-5 overlaps 0-19)" },
	{ filepath: gt.file, startLine: 15, endLine: 25, desc: "partial overlap (15-25 overlaps 0-19)" },
	{ filepath: gt.file, startLine: 50, endLine: 100, desc: "NO overlap (50-100 vs 0-19)" },
	{ filepath: gt.file, startLine: undefined, endLine: undefined, desc: "file match, no line info" },
	{ filepath: "other/file.py", startLine: gt.startLine, endLine: gt.endLine, desc: "wrong file, same lines" },
	{ filepath: "patchcore-inspection/src/test.py", startLine: 0, endLine: 50, desc: "hard negative file" },
];

for (const tc of testCases) {
	const isRelevant = isLocationRelevant(
		{ filepath: tc.filepath, startLine: tc.startLine, endLine: tc.endLine },
		gt.file,
		{ startLine: gt.startLine, endLine: gt.endLine }
	);
	console.log(`  ${isRelevant ? "✅" : "❌"} ${tc.desc}`);
	console.log(`     filepath: ${tc.filepath}, lines: ${tc.startLine}-${tc.endLine}`);
}

// Additional test: line range overlap
console.log("\n=== LINE RANGE OVERLAP TESTS ===\n");
const overlapTests = [
	{ chunk: { startLine: 0, endLine: 5 }, target: { startLine: 0, endLine: 19 }, expected: true },
	{ chunk: { startLine: 50, endLine: 100 }, target: { startLine: 0, endLine: 19 }, expected: false },
	{ chunk: { startLine: 10, endLine: 15 }, target: { startLine: 0, endLine: 19 }, expected: true },
	{ chunk: { startLine: 20, endLine: 30 }, target: { startLine: 0, endLine: 19 }, expected: false },
];

for (const test of overlapTests) {
	const result = lineRangeOverlaps(test.chunk, test.target);
	const pass = result === test.expected;
	console.log(`  ${pass ? "✅" : "❌"} chunk ${test.chunk.startLine}-${test.chunk.endLine} vs target ${test.target.startLine}-${test.target.endLine}: ${result}`);
}
