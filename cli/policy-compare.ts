/**
 * Policy Comparison Command (Phase 9A)
 *
 * Runs both 1-hop and H-hop retrieval policies for each chunker
 * and reports them side-by-side.
 *
 * Usage:
 *   memorybench eval:policy --benchmarks repoeval --providers code-chunk-ast,code-chunk-fixed
 *
 * Output format:
 * ┌─────────────────────────────────────────────────────────────────────────────────────┐
 * │ SPAN-LEVEL RETRIEVAL (RepoEval, Python, Function-level)                             │
 * ├─────────────────────────────────────────────────────────────────────────────────────┤
 * │ Chunker        │ 1-hop nDCG@10  │ H-hop nDCG@10  │ Δ nDCG     │ Embed Calls │ Effect │
 * ├─────────────────────────────────────────────────────────────────────────────────────┤
 * │ code-chunk     │ 85.2 ± 2.1     │ 89.1 ± 1.9     │ +4.6%**    │ 2.1         │ d=0.42 │
 * │ Fixed          │ 78.3 ± 2.4     │ 80.1 ± 2.2     │ +2.3%      │ 2.3         │ d=0.18 │
 * └─────────────────────────────────────────────────────────────────────────────────────┘
 */

import { getRegistry } from "../core/registry.ts";
import { ResultsStore } from "../core/results.ts";
import { getDefaultRegistry } from "../core/metrics/index.ts";
import { bootstrapCI, cohensD, pairedTTest } from "../core/analysis/statistics.ts";
import {
	executePolicy,
	type PolicyType,
	type MultiHopStats,
	DEFAULT_MULTI_HOP_CONFIG,
} from "../core/policies/index.ts";
import type { EvalResult, SearchResult } from "../core/config.ts";

// Display names
const DISPLAY_NAMES: Record<string, string> = {
	"code-chunk-ast": "code-chunk",
	"code-chunk-fixed": "Fixed",
	"chonkie-code": "Chonkie",
	"chonkie-recursive": "Chonkie-R",
};

interface PolicyCompareOptions {
	benchmarks: string[];
	providers: string[];
	limit?: number;
	budget?: number;
	dbPath?: string;
}

interface PolicyResult {
	provider: string;
	benchmark: string;
	policy: PolicyType;
	results: EvalResult[];
	stats: {
		avgEmbedCalls: number;
		avgUniqueChunks: number;
	};
}

/**
 * Run policy comparison evaluation.
 */
export async function policyCompareCommand(options: PolicyCompareOptions): Promise<void> {
	const {
		benchmarks,
		providers,
		limit,
		budget = DEFAULT_MULTI_HOP_CONFIG.totalBudget,
		dbPath = "./results/results.db",
	} = options;

	console.log(`
╭─────────────────────────────────────────────────────────────────╮
│                 POLICY COMPARISON (1-hop vs H-hop)               │
├─────────────────────────────────────────────────────────────────┤
│ Benchmarks: ${benchmarks.join(", ").padEnd(50)} │
│ Providers:  ${providers.join(", ").padEnd(50)} │
│ Budget:     ${String(budget).padEnd(50)} │
╰─────────────────────────────────────────────────────────────────╯
`);

	// This is a stub - full implementation requires integrating with the runner
	// For now, show what the output would look like
	console.log(`
⚠️  Policy comparison requires running evaluations with both policies.
    This feature is partially implemented (Phase 9A).

    To use policy comparison:
    
    1. Run eval twice with different policies (when --policy flag is added):
       bun run cli eval --benchmarks repoeval --providers code-chunk-ast --policy 1-hop
       bun run cli eval --benchmarks repoeval --providers code-chunk-ast --policy H-hop
    
    2. Or use the future eval:policy command:
       bun run cli eval:policy --benchmarks repoeval --providers code-chunk-ast,code-chunk-fixed

    Current implementation status:
    ✅ Multi-hop retrieval algorithm (core/policies/multi-hop.ts)
    ✅ Query expansion from chunk text
    ⏳ Integration with BenchmarkRunner
    ⏳ Side-by-side table output
`);

	// Print example output format
	console.log(`
Example output format (when fully implemented):
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ SPAN-LEVEL RETRIEVAL (RepoEval, Python, Function-level)                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Chunker        │ 1-hop nDCG@10  │ H-hop nDCG@10  │ Δ nDCG     │ Embed Calls │ Effect             │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ code-chunk     │ 85.2 ± 2.1     │ 89.1 ± 1.9     │ +4.6%**    │ 2.1         │ d=0.42             │
│ Fixed          │ 78.3 ± 2.4     │ 80.1 ± 2.2     │ +2.3%      │ 2.3         │ d=0.18             │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ** p < 0.01 improvement from H-hop (paired t-test)                                               │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
`);
}

/**
 * Parse CLI options for policy comparison.
 */
export function parsePolicyCompareOptions(
	options: Record<string, string | string[] | boolean>,
): PolicyCompareOptions {
	const benchmarks = options.benchmarks
		? String(options.benchmarks).split(",").map((s) => s.trim())
		: [];
	const providers = options.providers
		? String(options.providers).split(",").map((s) => s.trim())
		: [];
	const limit = options.limit ? parseInt(String(options.limit), 10) : undefined;
	const budget = options.budget ? parseInt(String(options.budget), 10) : undefined;

	return { benchmarks, providers, limit, budget };
}
