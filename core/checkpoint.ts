/**
 * Checkpoint manager for resumable benchmark runs.
 * Manages JSON checkpoint files per run/benchmark/provider.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface CheckpointItem {
	itemId: string;
	status: "pending" | "in_progress" | "completed" | "failed";
	timestamp: string;
	phase: "ingest" | "search" | "evaluate";
	error?: string;
}

export interface Checkpoint {
	runId: string;
	benchmark: string;
	provider: string;
	questionType?: string;
	startPosition?: number;
	endPosition?: number;
	items: CheckpointItem[];
	createdAt: string;
	updatedAt: string;
}

export interface CheckpointProgress {
	total: number;
	completed: number;
	failed: number;
	inProgress: number;
	pending: number;
}

export class CheckpointManager {
	private checkpointsDir: string;
	private checkpoints = new Map<string, Checkpoint>();

	constructor(baseDir: string = "./checkpoints") {
		this.checkpointsDir = baseDir;
	}

	/**
	 * Get the file path for a checkpoint.
	 */
	private getCheckpointPath(
		runId: string,
		benchmark: string,
		provider: string,
	): string {
		return `${this.checkpointsDir}/${runId}/${benchmark}-${provider}.json`;
	}

	/**
	 * Get the cache key for a checkpoint.
	 */
	private getCacheKey(
		runId: string,
		benchmark: string,
		provider: string,
	): string {
		return `${runId}:${benchmark}:${provider}`;
	}

	/**
	 * Load or create a checkpoint for a run.
	 */
	async loadOrCreate(
		runId: string,
		benchmark: string,
		provider: string,
		options?: {
			questionType?: string;
			startPosition?: number;
			endPosition?: number;
		},
	): Promise<Checkpoint> {
		const cacheKey = this.getCacheKey(runId, benchmark, provider);

		// Check cache first
		const cached = this.checkpoints.get(cacheKey);
		if (cached) {
			return cached;
		}

		// Try to load from file
		const path = this.getCheckpointPath(runId, benchmark, provider);
		const file = Bun.file(path);

		if (await file.exists()) {
			const content = await file.text();
			const checkpoint = JSON.parse(content) as Checkpoint;
			this.checkpoints.set(cacheKey, checkpoint);
			return checkpoint;
		}

		// Create new checkpoint
		const checkpoint: Checkpoint = {
			runId,
			benchmark,
			provider,
			questionType: options?.questionType,
			startPosition: options?.startPosition,
			endPosition: options?.endPosition,
			items: [],
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		// Ensure directory exists
		await mkdir(dirname(path), { recursive: true });

		// Save and cache
		await this.save(checkpoint);
		this.checkpoints.set(cacheKey, checkpoint);

		return checkpoint;
	}

	/**
	 * Check if an item should be skipped (already completed).
	 */
	async shouldSkip(
		runId: string,
		benchmark: string,
		provider: string,
		itemId: string,
		phase: "ingest" | "search" | "evaluate",
	): Promise<boolean> {
		const checkpoint = await this.loadOrCreate(runId, benchmark, provider);
		const item = checkpoint.items.find((i) => i.itemId === itemId);

		if (!item) {
			return false;
		}

		// Skip if completed at this phase or a later phase
		if (item.status === "completed") {
			const phases = ["ingest", "search", "evaluate"];
			const itemPhaseIndex = phases.indexOf(item.phase);
			const targetPhaseIndex = phases.indexOf(phase);
			return itemPhaseIndex >= targetPhaseIndex;
		}

		return false;
	}

	/**
	 * Mark an item as in progress.
	 */
	async markInProgress(
		runId: string,
		benchmark: string,
		provider: string,
		itemId: string,
		phase: "ingest" | "search" | "evaluate",
	): Promise<void> {
		await this.updateItem(runId, benchmark, provider, itemId, {
			status: "in_progress",
			phase,
			timestamp: new Date().toISOString(),
		});
	}

	/**
	 * Mark an item as completed.
	 */
	async markComplete(
		runId: string,
		benchmark: string,
		provider: string,
		itemId: string,
		phase: "ingest" | "search" | "evaluate",
	): Promise<void> {
		await this.updateItem(runId, benchmark, provider, itemId, {
			status: "completed",
			phase,
			timestamp: new Date().toISOString(),
		});
	}

	/**
	 * Mark an item as failed.
	 */
	async markFailed(
		runId: string,
		benchmark: string,
		provider: string,
		itemId: string,
		phase: "ingest" | "search" | "evaluate",
		error: string,
	): Promise<void> {
		await this.updateItem(runId, benchmark, provider, itemId, {
			status: "failed",
			phase,
			timestamp: new Date().toISOString(),
			error,
		});
	}

	/**
	 * Update an item in the checkpoint.
	 */
	private async updateItem(
		runId: string,
		benchmark: string,
		provider: string,
		itemId: string,
		update: Partial<CheckpointItem>,
	): Promise<void> {
		const checkpoint = await this.loadOrCreate(runId, benchmark, provider);

		// Find or create item
		let item = checkpoint.items.find((i) => i.itemId === itemId);
		if (!item) {
			item = {
				itemId,
				status: "pending",
				phase: "ingest",
				timestamp: new Date().toISOString(),
			};
			checkpoint.items.push(item);
		}

		// Apply update
		Object.assign(item, update);
		checkpoint.updatedAt = new Date().toISOString();

		// Save
		await this.save(checkpoint);
	}

	/**
	 * Get progress for a run.
	 */
	async getProgress(
		runId: string,
		benchmark: string,
		provider: string,
	): Promise<CheckpointProgress> {
		const checkpoint = await this.loadOrCreate(runId, benchmark, provider);

		return {
			total: checkpoint.items.length,
			completed: checkpoint.items.filter((i) => i.status === "completed")
				.length,
			failed: checkpoint.items.filter((i) => i.status === "failed").length,
			inProgress: checkpoint.items.filter((i) => i.status === "in_progress")
				.length,
			pending: checkpoint.items.filter((i) => i.status === "pending").length,
		};
	}

	/**
	 * Get failed items for retry.
	 */
	async getFailedItems(
		runId: string,
		benchmark: string,
		provider: string,
	): Promise<CheckpointItem[]> {
		const checkpoint = await this.loadOrCreate(runId, benchmark, provider);
		return checkpoint.items.filter((i) => i.status === "failed");
	}

	/**
	 * Save checkpoint to file atomically.
	 */
	private async save(checkpoint: Checkpoint): Promise<void> {
		const path = this.getCheckpointPath(
			checkpoint.runId,
			checkpoint.benchmark,
			checkpoint.provider,
		);

		// Write to temp file first, then rename (atomic)
		const tempPath = `${path}.tmp`;
		await Bun.write(tempPath, JSON.stringify(checkpoint, null, 2));

		// Rename temp to final
		const file = Bun.file(tempPath);
		await Bun.write(path, await file.text());

		// Clean up temp file
		try {
			await Bun.file(tempPath).exists() &&
				(await import("node:fs/promises")).unlink(tempPath);
		} catch {
			// Ignore cleanup errors
		}

		// Update cache
		const cacheKey = this.getCacheKey(
			checkpoint.runId,
			checkpoint.benchmark,
			checkpoint.provider,
		);
		this.checkpoints.set(cacheKey, checkpoint);
	}

	/**
	 * Clear checkpoint cache.
	 */
	clearCache(): void {
		this.checkpoints.clear();
	}
}

