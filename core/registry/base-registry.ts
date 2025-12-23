/**
 * BaseRegistry - Generic registry pattern for pluggable components.
 *
 * This base class provides:
 * - Key-based registration with optional aliases
 * - Lookup by key or alias
 * - Conflict detection on registration
 * - List and iteration utilities
 *
 * Used by: MetricRegistry, PackRegistry, LoaderRegistry, DatasetRegistry
 *
 * @example
 * ```typescript
 * class MyRegistry extends BaseRegistry<MyItem> {
 *   register(item: MyItem): void {
 *     super.registerItem(item.name, item, item.aliases);
 *   }
 * }
 * ```
 */

/**
 * Error thrown when a requested item is not found in the registry.
 */
export class RegistryNotFoundError extends Error {
	constructor(
		public readonly key: string,
		public readonly registryName: string,
		public readonly availableKeys: string[],
	) {
		const available = availableKeys.length > 0
			? `Available: ${availableKeys.join(", ")}`
			: "Registry is empty";
		super(`${registryName}: "${key}" not found. ${available}`);
		this.name = "RegistryNotFoundError";
	}
}

/**
 * Error thrown when registration conflicts with existing entry.
 */
export class RegistryConflictError extends Error {
	constructor(
		public readonly key: string,
		public readonly registryName: string,
		public readonly conflictType: "key" | "alias",
	) {
		const type = conflictType === "key" ? "Key" : "Alias";
		super(`${registryName}: ${type} "${key}" is already registered`);
		this.name = "RegistryConflictError";
	}
}

/**
 * Options for registry behavior.
 */
export interface RegistryOptions {
	/** Name of the registry (used in error messages) */
	name: string;
	/** Whether to throw on duplicate registration (default: true) */
	throwOnConflict?: boolean;
}

/**
 * Generic base registry class.
 *
 * @typeParam T - Type of items stored in the registry
 */
export class BaseRegistry<T> {
	protected items = new Map<string, T>();
	protected aliasMap = new Map<string, string>(); // alias -> primary key
	protected readonly registryName: string;
	protected readonly throwOnConflict: boolean;

	constructor(options: RegistryOptions) {
		this.registryName = options.name;
		this.throwOnConflict = options.throwOnConflict ?? true;
	}

	/**
	 * Register an item with a key and optional aliases.
	 *
	 * @param key - Primary key for the item
	 * @param item - Item to register
	 * @param aliases - Optional aliases that also resolve to this item
	 * @throws RegistryConflictError if key or alias conflicts (when throwOnConflict=true)
	 */
	protected registerItem(key: string, item: T, aliases?: readonly string[]): void {
		// Check for key conflicts
		if (this.items.has(key) || this.aliasMap.has(key)) {
			if (this.throwOnConflict) {
				throw new RegistryConflictError(key, this.registryName, "key");
			}
			return; // Silent skip when throwOnConflict=false
		}

		// Check for alias conflicts
		for (const alias of aliases ?? []) {
			if (this.items.has(alias) || this.aliasMap.has(alias)) {
				if (this.throwOnConflict) {
					throw new RegistryConflictError(alias, this.registryName, "alias");
				}
				return;
			}
		}

		// Register the item
		this.items.set(key, item);

		// Register aliases
		for (const alias of aliases ?? []) {
			this.aliasMap.set(alias, key);
		}
	}

	/**
	 * Get an item by key or alias.
	 * Returns undefined if not found.
	 */
	get(keyOrAlias: string): T | undefined {
		// Direct lookup
		if (this.items.has(keyOrAlias)) {
			return this.items.get(keyOrAlias);
		}

		// Alias lookup
		const primaryKey = this.aliasMap.get(keyOrAlias);
		if (primaryKey) {
			return this.items.get(primaryKey);
		}

		return undefined;
	}

	/**
	 * Get an item by key or alias.
	 * Throws RegistryNotFoundError if not found.
	 */
	getOrThrow(keyOrAlias: string): T {
		const item = this.get(keyOrAlias);
		if (item === undefined) {
			throw new RegistryNotFoundError(
				keyOrAlias,
				this.registryName,
				this.keys(),
			);
		}
		return item;
	}

	/**
	 * Check if an item exists by key or alias.
	 */
	has(keyOrAlias: string): boolean {
		return this.items.has(keyOrAlias) || this.aliasMap.has(keyOrAlias);
	}

	/**
	 * Get all registered items.
	 */
	list(): T[] {
		return Array.from(this.items.values());
	}

	/**
	 * Get all primary keys (sorted alphabetically).
	 */
	keys(): string[] {
		return Array.from(this.items.keys()).sort();
	}

	/**
	 * Get all aliases (sorted alphabetically).
	 */
	aliases(): string[] {
		return Array.from(this.aliasMap.keys()).sort();
	}

	/**
	 * Get number of registered items (not counting aliases).
	 */
	get size(): number {
		return this.items.size;
	}

	/**
	 * Remove an item by primary key.
	 * Also removes all associated aliases.
	 */
	delete(key: string): boolean {
		if (!this.items.has(key)) {
			return false;
		}

		// Remove aliases pointing to this key
		for (const [alias, primaryKey] of this.aliasMap.entries()) {
			if (primaryKey === key) {
				this.aliasMap.delete(alias);
			}
		}

		// Remove the item
		this.items.delete(key);
		return true;
	}

	/**
	 * Clear all items and aliases.
	 */
	clear(): void {
		this.items.clear();
		this.aliasMap.clear();
	}

	/**
	 * Resolve an alias to its primary key.
	 * Returns the input if it's already a primary key or not found.
	 */
	resolveAlias(keyOrAlias: string): string {
		return this.aliasMap.get(keyOrAlias) ?? keyOrAlias;
	}
}
