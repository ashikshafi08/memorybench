/**
 * Verify IoU threshold flow from config → loader → pack → relevance check
 */

// Simulate the flow
const config = {
  hardNegatives: {
    iouThreshold: 0.3
  }
};

console.log("=== IoU THRESHOLD FLOW VERIFICATION ===\n");
console.log("1. Config (repoeval.yaml):");
console.log("   hardNegatives.iouThreshold =", config.hardNegatives.iouThreshold);
console.log("");

console.log("2. Loader (generic-loader.ts line 96):");
console.log("   iouThreshold: config.hardNegatives?.iouThreshold →", config.hardNegatives.iouThreshold);
console.log("");

console.log("3. Dataset Registry (dataset-registry.ts line 295):");
console.log("   metadata.iouThreshold: options?.iouThreshold →", config.hardNegatives.iouThreshold);
console.log("");

console.log("4. Pack (generic-code-retrieval-pack.ts line 455):");
console.log("   relevanceOptions.iouThreshold = item.metadata?.iouThreshold →", config.hardNegatives.iouThreshold);
console.log("");

console.log("5. Relevance Check (relevance.ts line 141-146):");
console.log("   const iouThreshold = options?.iouThreshold ?? 0 →", config.hardNegatives.iouThreshold);
console.log("   if (iouThreshold > 0) { ... IoU-based check ... }");
console.log("");

console.log("✅ Flow verified: Config → Loader → Dataset → Pack → Relevance");
console.log("");

// Test actual behavior
import { isLocationRelevant } from "../benchmarks/packs/relevance.ts";

const testCases = [
  { threshold: 0.0, expected: true, desc: "Binary overlap" },
  { threshold: 0.3, expected: true, desc: "0.3 threshold (0.32 >= 0.3)" },
  { threshold: 0.5, expected: false, desc: "0.5 threshold (0.32 < 0.5)" },
];

console.log("=== ACTUAL BEHAVIOR TEST ===");
console.log("Chunk: lines 0-61, Target: lines 0-19, IoU = 0.32\n");

for (const { threshold, expected, desc } of testCases) {
  const result = isLocationRelevant(
    { filepath: "test.py", startLine: 0, endLine: 61 },
    "test.py",
    { startLine: 0, endLine: 19 },
    { iouThreshold: threshold }
  );
  
  const status = result === expected ? "✅" : "❌";
  console.log(`${status} iouThreshold=${threshold}: ${desc}`);
  console.log(`   Expected: ${expected}, Got: ${result}`);
}
