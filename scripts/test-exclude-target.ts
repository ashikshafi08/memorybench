/**
 * Test that excludeTargetFile works correctly
 */

import { getDataset } from "../benchmarks/loaders/download/dataset-registry.ts";

async function main() {
	const dataset = getDataset("repoeval")!;
	const tasks = await dataset.loadTasks({ limit: 1 });
	const task = tasks[0]!;
	
	// Test WITHOUT excludeTargetFile
	const itemWithTarget = await dataset.toBenchmarkItem(task, {
		taskType: "function",
		hardNegatives: { enabled: true, strategy: "same-repo", count: 100, maxFilesPerRepo: 50 },
		excludeTargetFile: false,
	});
	
	// Test WITH excludeTargetFile
	const itemWithoutTarget = await dataset.toBenchmarkItem(task, {
		taskType: "function",
		hardNegatives: { enabled: true, strategy: "same-repo", count: 100, maxFilesPerRepo: 50 },
		excludeTargetFile: true,
	});
	
	const targetFile = itemWithTarget.metadata?.targetFile as string;
	
	console.log("=== EXCLUDE TARGET FILE TEST ===\n");
	console.log("Target file:", targetFile);
	console.log();
	
	// Check if target file is in contexts
	const targetInWith = itemWithTarget.contexts.some(ctx => 
		(ctx.metadata?.filepath as string) === targetFile
	);
	const targetInWithout = itemWithoutTarget.contexts.some(ctx => 
		(ctx.metadata?.filepath as string) === targetFile
	);
	
	console.log("WITH excludeTargetFile=false:");
	console.log(`  Total contexts: ${itemWithTarget.contexts.length}`);
	console.log(`  Target file in contexts: ${targetInWith ? "✅ YES (expected)" : "❌ NO (unexpected)"}`);
	console.log();
	
	console.log("WITH excludeTargetFile=true:");
	console.log(`  Total contexts: ${itemWithoutTarget.contexts.length}`);
	console.log(`  Target file in contexts: ${targetInWithout ? "❌ YES (BUG!)" : "✅ NO (expected - excluded)"}`);
	console.log();
	
	console.log("=== RESULT ===");
	if (!targetInWith) {
		console.log("❌ FAIL: Target file missing even when excludeTargetFile=false");
	} else if (targetInWithout) {
		console.log("❌ FAIL: Target file present even when excludeTargetFile=true");
	} else {
		console.log("✅ PASS: excludeTargetFile works correctly!");
		console.log(`   - With target: ${itemWithTarget.contexts.length} contexts`);
		console.log(`   - Without target: ${itemWithoutTarget.contexts.length} contexts`);
		console.log(`   - Difference: ${itemWithTarget.contexts.length - itemWithoutTarget.contexts.length} file(s) excluded`);
	}
}

main().catch(console.error);
