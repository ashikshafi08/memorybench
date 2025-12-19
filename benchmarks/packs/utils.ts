/**
 * Utility functions for benchmark packs.
 */

import { createHash } from "crypto";
import type { PromptArtifact } from "./interface.ts";

/**
 * Compute SHA-256 hash of a string.
 */
export function sha256(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Create a prompt artifact from text.
 */
export function createPromptArtifact(text: string): PromptArtifact {
	return {
		text,
		sha256: sha256(text),
	};
}

