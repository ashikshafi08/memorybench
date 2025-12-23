/**
 * Registry module - unified registry patterns for pluggable components.
 *
 * Provides BaseRegistry class and error types for consistent
 * registration, lookup, and alias handling across the codebase.
 */

export {
	BaseRegistry,
	RegistryNotFoundError,
	RegistryConflictError,
	type RegistryOptions,
} from "./base-registry.ts";
