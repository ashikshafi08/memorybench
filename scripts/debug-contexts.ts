/**
 * Debug script to check what contexts are being generated for RepoEval
 */

import { getDataset } from "../benchmarks/loaders/download/dataset-registry.ts";

async function main() {
	const dataset = getDataset("repoeval");
	if (!dataset) {
		console.log("Dataset not found!");
		return;
	}
	
	// Check if available
	console.log("Dataset available:", dataset.isAvailable());
	
	// Load first few tasks
	const tasks = await dataset.loadTasks({ limit: 2 });
	console.log("\n=== Loaded", tasks.length, "tasks ===\n");
	
	if (tasks.length === 0) {
		console.log("No tasks loaded. Make sure data is downloaded.");
		return;
	}
	
	// Convert first task to benchmark item WITH hard negatives
	const hardNegativesConfig = {
		enabled: true,
		strategy: "cross-repo" as const,
		count: 500,
		maxFilesPerRepo: 100,
	};
	
	const item = await dataset.toBenchmarkItem(tasks[0]!, {
		taskType: "function",
		hardNegatives: hardNegativesConfig,
	});
	
	console.log("=== Benchmark Item ===");
	console.log("ID:", item.id);
	console.log("Question (first 200 chars):", item.question.slice(0, 200) + "...");
	console.log("Answer (first 100 chars):", item.answer.slice(0, 100) + "...");
	console.log("\n=== Ground Truth ===");
	console.log("  File:", item.metadata?.groundTruth?.file);
	console.log("  Start Line:", item.metadata?.groundTruth?.startLine);
	console.log("  End Line:", item.metadata?.groundTruth?.endLine);
	
	console.log("\n=== Contexts Summary ===");
	console.log("Total contexts:", item.contexts.length);
	
	// Group by repo
	const byRepo = new Map<string, number>();
	const hardNegs = new Map<string, number>();
	
	for (const ctx of item.contexts) {
		const repo = (ctx.metadata?.repo as string) || "unknown";
		byRepo.set(repo, (byRepo.get(repo) || 0) + 1);
		
		if (ctx.metadata?.isHardNegative) {
			hardNegs.set(repo, (hardNegs.get(repo) || 0) + 1);
		}
	}
	
	console.log("\nBy repo:");
	for (const [repo, count] of byRepo) {
		const hnCount = hardNegs.get(repo) || 0;
		console.log(`  ${repo}: ${count} files (${hnCount} hard negatives)`);
	}
	
	// Check target file
	const targetFile = item.metadata?.targetFile as string;
	const targetContexts = item.contexts.filter(ctx => 
		(ctx.metadata?.filepath as string)?.includes(targetFile.split("/").pop()!)
	);
	console.log("\nTarget file:", targetFile);
	console.log("Target file contexts:", targetContexts.length);
	
	// Total hard negatives
	const totalHardNegs = item.contexts.filter(ctx => ctx.metadata?.isHardNegative).length;
	console.log("\nTotal hard negatives:", totalHardNegs);
	
	// Show sample of hard negatives
	const hardNegSamples = item.contexts.filter(ctx => ctx.metadata?.isHardNegative).slice(0, 3);
	if (hardNegSamples.length > 0) {
		console.log("\n=== Sample Hard Negatives ===");
		for (const hn of hardNegSamples) {
			console.log(`  ${hn.metadata?.repo}:${hn.metadata?.filepath}`);
		}
	} else {
		console.log("\n⚠️  NO HARD NEGATIVES FOUND!");
	}
}

main().catch(console.error);

// Additional test: simulate what the retrieval + relevance check sees
import { isLocationRelevant } from "../benchmarks/packs/relevance.ts";

async function testRelevanceCheck() {
	const dataset = getDataset("repoeval")!;
	const tasks = await dataset.loadTasks({ limit: 2 });
	const task = tasks[0]!;
	
	const item = await dataset.toBenchmarkItem(task, {
		taskType: "function",
		hardNegatives: { enabled: true, strategy: "cross-repo", count: 500, maxFilesPerRepo: 100 },
	});
	
	const gt = item.metadata?.groundTruth as { file: string; startLine: number; endLine: number };
	console.log("\n\n=== RELEVANCE CHECK SIMULATION ===");
	console.log("Ground truth:", gt);
	
	// Simulate chunks with and without line info
	const testCases = [
		{ filepath: gt.file, startLine: gt.startLine, endLine: gt.endLine, desc: "exact match" },
		{ filepath: gt.file, startLine: 0, endLine: 5, desc: "partial overlap" },
		{ filepath: gt.file, startLine: 100, endLine: 200, desc: "no overlap, same file" },
		{ filepath: gt.file, startLine: undefined, endLine: undefined, desc: "file match, no lines" },
		{ filepath: "other/file.py", startLine: gt.startLine, endLine: gt.endLine, desc: "wrong file" },
		{ filepath: "amazon-science_patchcore-inspection/src/test.py", startLine: 0, endLine: 50, desc: "hard negative" },
	];
	
	for (const tc of testCases) {
		const isRelevant = isLocationRelevant(
			{ filepath: tc.filepath, startLine: tc.startLine, endLine: tc.endLine },
			gt.file,
			{ startLine: gt.startLine, endLine: gt.endLine }
		);
		console.log(`  ${tc.desc}: ${isRelevant ? "✅ RELEVANT" : "❌ not relevant"}`);
	}
}

testRelevanceCheck().catch(console.error);
