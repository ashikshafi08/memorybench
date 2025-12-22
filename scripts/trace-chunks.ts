/**
 * Trace what chunks are created from the target file
 */

import { getDataset } from "../benchmarks/loaders/download/dataset-registry.ts";
import { getChunker } from "../providers/adapters/chunker-registry.ts";

async function main() {
	const dataset = getDataset("repoeval")!;
	const tasks = await dataset.loadTasks({ limit: 1 });
	const item = await dataset.toBenchmarkItem(tasks[0]!, {
		taskType: "function",
		hardNegatives: { enabled: true, strategy: "cross-repo", count: 500, maxFilesPerRepo: 100 },
	});
	
	const gt = item.metadata?.groundTruth as { file: string; startLine: number; endLine: number };
	const targetFile = item.metadata?.targetFile as string;
	
	console.log("=== TARGET FILE INFO ===");
	console.log("Target file:", targetFile);
	console.log("Ground truth lines:", gt.startLine, "-", gt.endLine);
	
	// Find the target file context
	const targetContext = item.contexts.find(ctx => 
		(ctx.metadata?.filepath as string) === targetFile
	);
	
	if (!targetContext) {
		console.log("Target file not found in contexts!");
		return;
	}
	
	console.log("\nTarget file content length:", targetContext.content.length, "chars");
	console.log("Target file lines:", targetContext.content.split("\n").length);
	
	// Simulate chunking with code-chunk-ast
	const astChunker = getChunker("code-chunk-ast")!;
	const chunks = await astChunker.chunkFn(targetContext.content, targetFile, {});
	
	console.log("\n=== CHUNKS FROM TARGET FILE (code-chunk-ast) ===");
	console.log("Total chunks:", chunks.length);
	
	// Show chunks with their line ranges
	let relevantChunks = 0;
	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i]!;
		const startLine = chunk.startLine ?? 1;
		const endLine = chunk.endLine ?? 9999;
		const overlaps = endLine >= gt.startLine && startLine <= gt.endLine;
		if (overlaps) relevantChunks++;
		
		const marker = overlaps ? "✅" : "  ";
		console.log(`${marker} Chunk ${i}: lines ${startLine}-${endLine} (${chunk.content.length} chars)`);
	}
	
	console.log("\n=== SUMMARY ===");
	console.log("Target file:", targetFile);
	console.log("Ground truth lines:", gt.startLine, "-", gt.endLine);
	console.log("Total chunks from target file:", chunks.length);
	console.log("Chunks overlapping ground truth:", relevantChunks);
	console.log("\nAt least one relevant chunk?", relevantChunks > 0 ? "YES → RECALL IS EXPECTED TO BE HIGH" : "NO");
}

main().catch(console.error);
