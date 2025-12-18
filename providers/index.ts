/**
 * Provider exports for memorybench.
 *
 * This module exports both the legacy direct-import providers and
 * the new adapter-based system.
 *
 * New providers should use:
 * - YAML config in providers/configs/
 * - Adapter in providers/adapters/ extending LocalProvider
 * - Factory registration in providers/factory.ts
 */

// Legacy template types (deprecated - use core/config.ts types)
export * from "./_template";

// Legacy direct-import providers (deprecated - use adapters with factory)
export { default as AQRAGProvider } from "./AQRAG";
export { default as ContextualRetrievalProvider } from "./ContextualRetrieval";

// New adapter system (preferred)
export * from "./adapters";
export * from "./base";
export * from "./factory";
