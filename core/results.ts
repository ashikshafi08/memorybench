/**
 * Results storage using Bun's built-in SQLite.
 * Stores evaluation results and provides querying/aggregation.
 */

import { Database } from "bun:sqlite";
import type { EvalResult } from "./config.ts";
import type { RunResult, BenchmarkProviderResult, RunSummary } from "./runner.ts";

export interface StoredRun {
	id: string;
	startedAt: string;
	completedAt: string | null;
	benchmarks: string;
	providers: string;
	config: string;
}

export interface StoredResult {
	id: number;
	runId: string;
	benchmark: string;
	provider: string;
	itemId: string;
	question: string;
	expected: string;
	actual: string;
	score: number;
	correct: number;
	retrievedContext: string;
	metadata: string;
	createdAt: string;
}

export interface AggregatedMetrics {
	benchmark: string;
	provider: string;
	totalItems: number;
	correctItems: number;
	accuracy: number;
	avgScore: number;
	byQuestionType?: Record<string, { total: number; correct: number; accuracy: number }>;
	byCategory?: Record<string, { total: number; correct: number; accuracy: number }>;
}

export interface ProviderComparison {
	benchmark: string;
	providers: Array<{
		provider: string;
		accuracy: number;
		totalItems: number;
		correctItems: number;
	}>;
}

export class ResultsStore {
	private db: Database;

	constructor(dbPath: string = "./results.db") {
		this.db = new Database(dbPath);
		this.initialize();
	}

	/**
	 * Initialize the database schema.
	 */
	private initialize(): void {
		this.db.run(`
			CREATE TABLE IF NOT EXISTS runs (
				id TEXT PRIMARY KEY,
				started_at TEXT NOT NULL,
				completed_at TEXT,
				benchmarks TEXT NOT NULL,
				providers TEXT NOT NULL,
				config TEXT
			)
		`);

		this.db.run(`
			CREATE TABLE IF NOT EXISTS results (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				run_id TEXT NOT NULL,
				benchmark TEXT NOT NULL,
				provider TEXT NOT NULL,
				item_id TEXT NOT NULL,
				question TEXT NOT NULL,
				expected TEXT NOT NULL,
				actual TEXT NOT NULL,
				score REAL NOT NULL,
				correct INTEGER NOT NULL,
				retrieved_context TEXT,
				metadata TEXT,
				created_at TEXT DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (run_id) REFERENCES runs(id)
			)
		`);

		this.db.run(
			`CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id)`,
		);
		this.db.run(
			`CREATE INDEX IF NOT EXISTS idx_results_benchmark ON results(benchmark)`,
		);
		this.db.run(
			`CREATE INDEX IF NOT EXISTS idx_results_provider ON results(provider)`,
		);
		this.db.run(
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_results_unique ON results(run_id, benchmark, provider, item_id)`,
		);
	}

	/**
	 * Save a complete run result.
	 */
	saveRun(runResult: RunResult): void {
		// Insert or update run
		this.db.run(
			`
			INSERT OR REPLACE INTO runs (id, started_at, completed_at, benchmarks, providers, config)
			VALUES (?, ?, ?, ?, ?, ?)
		`,
			[
				runResult.runId,
				runResult.startedAt,
				runResult.completedAt ?? null,
				JSON.stringify(runResult.benchmarks),
				JSON.stringify(runResult.providers),
				JSON.stringify(runResult.summary),
			],
		);

		// Insert results
		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO results (run_id, benchmark, provider, item_id, question, expected, actual, score, correct, retrieved_context, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		for (const benchmarkResult of runResult.results) {
			for (const result of benchmarkResult.results) {
				stmt.run(
					result.runId,
					result.benchmark,
					result.provider,
					result.itemId,
					result.question,
					result.expected,
					result.actual,
					result.score,
					result.correct ? 1 : 0,
					JSON.stringify(result.retrievedContext),
					JSON.stringify(result.metadata),
				);
			}
		}
	}

	/**
	 * Save a single evaluation result.
	 */
	saveResult(result: EvalResult): void {
		this.db.run(
			`
			INSERT OR REPLACE INTO results (run_id, benchmark, provider, item_id, question, expected, actual, score, correct, retrieved_context, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			[
				result.runId,
				result.benchmark,
				result.provider,
				result.itemId,
				result.question,
				result.expected,
				result.actual,
				result.score,
				result.correct ? 1 : 0,
				JSON.stringify(result.retrievedContext),
				JSON.stringify(result.metadata),
			],
		);
	}

	/**
	 * Get a run by ID.
	 */
	getRun(runId: string): StoredRun | null {
		const row = this.db
			.query<StoredRun, [string]>(
				`SELECT id, started_at as startedAt, completed_at as completedAt, benchmarks, providers, config FROM runs WHERE id = ?`,
			)
			.get(runId);

		return row ?? null;
	}

	/**
	 * Get all runs.
	 */
	listRuns(options?: { limit?: number; offset?: number }): StoredRun[] {
		const limit = options?.limit ?? 100;
		const offset = options?.offset ?? 0;

		return this.db
			.query<StoredRun, [number, number]>(
				`SELECT id, started_at as startedAt, completed_at as completedAt, benchmarks, providers, config 
				 FROM runs ORDER BY started_at DESC LIMIT ? OFFSET ?`,
			)
			.all(limit, offset);
	}

	/**
	 * Get results for a run.
	 */
	getRunResults(runId: string): EvalResult[] {
		const rows = this.db
			.query<StoredResult, [string]>(
				`SELECT * FROM results WHERE run_id = ?`,
			)
			.all(runId);

		return rows.map((row) => ({
			runId: row.runId,
			benchmark: row.benchmark,
			provider: row.provider,
			itemId: row.itemId,
			question: row.question,
			expected: row.expected,
			actual: row.actual,
			score: row.score,
			correct: row.correct === 1,
			retrievedContext: JSON.parse(row.retrievedContext || "[]"),
			metadata: JSON.parse(row.metadata || "{}"),
		}));
	}

	/**
	 * Get aggregated metrics for a run.
	 */
	getRunMetrics(runId: string): AggregatedMetrics[] {
		const rows = this.db
			.query<
				{
					benchmark: string;
					provider: string;
					total: number;
					correct: number;
					avgScore: number;
				},
				[string]
			>(
				`
			SELECT 
				benchmark,
				provider,
				COUNT(*) as total,
				SUM(correct) as correct,
				AVG(score) as avgScore
			FROM results
			WHERE run_id = ?
			GROUP BY benchmark, provider
		`,
			)
			.all(runId);

		return rows.map((row) => ({
			benchmark: row.benchmark,
			provider: row.provider,
			totalItems: row.total,
			correctItems: row.correct,
			accuracy: row.total > 0 ? row.correct / row.total : 0,
			avgScore: row.avgScore,
		}));
	}

	/**
	 * Get metrics breakdown by question type.
	 */
	getMetricsByQuestionType(
		runId: string,
		benchmark: string,
		provider: string,
	): Record<string, { total: number; correct: number; accuracy: number }> {
		const rows = this.db
			.query<
				{ questionType: string; total: number; correct: number },
				[string, string, string]
			>(
				`
			SELECT 
				json_extract(metadata, '$.questionType') as questionType,
				COUNT(*) as total,
				SUM(correct) as correct
			FROM results
			WHERE run_id = ? AND benchmark = ? AND provider = ?
			GROUP BY json_extract(metadata, '$.questionType')
		`,
			)
			.all(runId, benchmark, provider);

		const result: Record<
			string,
			{ total: number; correct: number; accuracy: number }
		> = {};

		for (const row of rows) {
			if (row.questionType) {
				result[row.questionType] = {
					total: row.total,
					correct: row.correct,
					accuracy: row.total > 0 ? row.correct / row.total : 0,
				};
			}
		}

		return result;
	}

	/**
	 * Get metrics breakdown by category.
	 */
	getMetricsByCategory(
		runId: string,
		benchmark: string,
		provider: string,
	): Record<string, { total: number; correct: number; accuracy: number }> {
		const rows = this.db
			.query<
				{ category: string; total: number; correct: number },
				[string, string, string]
			>(
				`
			SELECT 
				json_extract(metadata, '$.category') as category,
				COUNT(*) as total,
				SUM(correct) as correct
			FROM results
			WHERE run_id = ? AND benchmark = ? AND provider = ?
			GROUP BY json_extract(metadata, '$.category')
		`,
			)
			.all(runId, benchmark, provider);

		const result: Record<
			string,
			{ total: number; correct: number; accuracy: number }
		> = {};

		for (const row of rows) {
			if (row.category) {
				result[row.category] = {
					total: row.total,
					correct: row.correct,
					accuracy: row.total > 0 ? row.correct / row.total : 0,
				};
			}
		}

		return result;
	}

	/**
	 * Compare providers on a benchmark.
	 */
	compareProviders(benchmark: string, providers: string[]): ProviderComparison {
		const placeholders = providers.map(() => "?").join(",");

		const rows = this.db
			.query<
				{ provider: string; total: number; correct: number },
				[string, ...string[]]
			>(
				`
			SELECT 
				provider,
				COUNT(*) as total,
				SUM(correct) as correct
			FROM results
			WHERE benchmark = ? AND provider IN (${placeholders})
			GROUP BY provider
		`,
			)
			.all(benchmark, ...providers);

		return {
			benchmark,
			providers: rows.map((row) => ({
				provider: row.provider,
				accuracy: row.total > 0 ? row.correct / row.total : 0,
				totalItems: row.total,
				correctItems: row.correct,
			})),
		};
	}

	/**
	 * Export results to JSON.
	 */
	exportToJson(runId: string): string {
		const run = this.getRun(runId);
		const results = this.getRunResults(runId);
		const metrics = this.getRunMetrics(runId);

		return JSON.stringify(
			{
				run,
				results,
				metrics,
			},
			null,
			2,
		);
	}

	/**
	 * Export results to CSV.
	 */
	exportToCsv(runId: string): string {
		const results = this.getRunResults(runId);

		const headers = [
			"run_id",
			"benchmark",
			"provider",
			"item_id",
			"question",
			"expected",
			"actual",
			"score",
			"correct",
		];

		const rows = results.map((r) => [
			r.runId,
			r.benchmark,
			r.provider,
			r.itemId,
			`"${r.question.replace(/"/g, '""')}"`,
			`"${r.expected.replace(/"/g, '""')}"`,
			`"${r.actual.replace(/"/g, '""')}"`,
			r.score.toString(),
			r.correct ? "1" : "0",
		]);

		return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		this.db.close();
	}
}

