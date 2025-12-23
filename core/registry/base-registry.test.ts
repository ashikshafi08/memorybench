/**
 * Unit tests for BaseRegistry class.
 *
 * Tests cover:
 * 1. Basic CRUD operations (register, get, has, delete)
 * 2. Alias support and resolution
 * 3. Conflict detection and error handling
 * 4. Edge cases (empty registry, duplicate aliases)
 */

import { describe, expect, it, beforeEach } from "bun:test";
import {
	BaseRegistry,
	RegistryNotFoundError,
	RegistryConflictError,
} from "./base-registry.ts";

// Test item type
interface TestItem {
	name: string;
	value: number;
	aliases?: readonly string[];
}

// Concrete registry for testing
class TestRegistry extends BaseRegistry<TestItem> {
	constructor(throwOnConflict = true) {
		super({ name: "TestRegistry", throwOnConflict });
	}

	register(item: TestItem): void {
		this.registerItem(item.name, item, item.aliases);
	}
}

describe("BaseRegistry", () => {
	let registry: TestRegistry;

	beforeEach(() => {
		registry = new TestRegistry();
	});

	describe("Basic operations", () => {
		it("registers and retrieves items by key", () => {
			const item: TestItem = { name: "foo", value: 42 };
			registry.register(item);

			expect(registry.get("foo")).toEqual(item);
			expect(registry.has("foo")).toBe(true);
		});

		it("returns undefined for non-existent key", () => {
			expect(registry.get("nonexistent")).toBeUndefined();
			expect(registry.has("nonexistent")).toBe(false);
		});

		it("throws RegistryNotFoundError when using getOrThrow", () => {
			expect(() => registry.getOrThrow("nonexistent")).toThrow(
				RegistryNotFoundError,
			);

			try {
				registry.getOrThrow("nonexistent");
			} catch (e) {
				expect(e).toBeInstanceOf(RegistryNotFoundError);
				const err = e as RegistryNotFoundError;
				expect(err.key).toBe("nonexistent");
				expect(err.registryName).toBe("TestRegistry");
				expect(err.availableKeys).toEqual([]);
			}
		});

		it("includes available keys in error message", () => {
			registry.register({ name: "alpha", value: 1 });
			registry.register({ name: "beta", value: 2 });

			try {
				registry.getOrThrow("gamma");
			} catch (e) {
				const err = e as RegistryNotFoundError;
				expect(err.availableKeys).toContain("alpha");
				expect(err.availableKeys).toContain("beta");
				expect(err.message).toContain("alpha");
				expect(err.message).toContain("beta");
			}
		});

		it("lists all registered items", () => {
			registry.register({ name: "a", value: 1 });
			registry.register({ name: "b", value: 2 });
			registry.register({ name: "c", value: 3 });

			const items = registry.list();
			expect(items).toHaveLength(3);
			expect(items.map((i) => i.name)).toContain("a");
			expect(items.map((i) => i.name)).toContain("b");
			expect(items.map((i) => i.name)).toContain("c");
		});

		it("returns sorted keys", () => {
			registry.register({ name: "zebra", value: 1 });
			registry.register({ name: "apple", value: 2 });
			registry.register({ name: "mango", value: 3 });

			const keys = registry.keys();
			expect(keys).toEqual(["apple", "mango", "zebra"]);
		});

		it("tracks size correctly", () => {
			expect(registry.size).toBe(0);

			registry.register({ name: "a", value: 1 });
			expect(registry.size).toBe(1);

			registry.register({ name: "b", value: 2 });
			expect(registry.size).toBe(2);
		});
	});

	describe("Alias support", () => {
		it("retrieves items by alias", () => {
			const item: TestItem = {
				name: "recall_at_5",
				value: 100,
				aliases: ["recall@5", "r@5"],
			};
			registry.register(item);

			expect(registry.get("recall_at_5")).toEqual(item);
			expect(registry.get("recall@5")).toEqual(item);
			expect(registry.get("r@5")).toEqual(item);
		});

		it("has() works with aliases", () => {
			registry.register({
				name: "ndcg_at_10",
				value: 50,
				aliases: ["ndcg@10"],
			});

			expect(registry.has("ndcg_at_10")).toBe(true);
			expect(registry.has("ndcg@10")).toBe(true);
			expect(registry.has("ndcg@5")).toBe(false);
		});

		it("returns sorted aliases", () => {
			registry.register({ name: "metric", value: 1, aliases: ["z", "a", "m"] });

			const aliases = registry.aliases();
			expect(aliases).toEqual(["a", "m", "z"]);
		});

		it("resolves alias to primary key", () => {
			registry.register({
				name: "primary",
				value: 1,
				aliases: ["alias1", "alias2"],
			});

			expect(registry.resolveAlias("alias1")).toBe("primary");
			expect(registry.resolveAlias("alias2")).toBe("primary");
			expect(registry.resolveAlias("primary")).toBe("primary"); // Returns itself
			expect(registry.resolveAlias("unknown")).toBe("unknown"); // Returns input if not found
		});

		it("aliases don't count toward size", () => {
			registry.register({
				name: "item",
				value: 1,
				aliases: ["a", "b", "c"],
			});

			expect(registry.size).toBe(1);
		});
	});

	describe("Conflict detection", () => {
		it("throws on duplicate key registration", () => {
			registry.register({ name: "dup", value: 1 });

			expect(() => registry.register({ name: "dup", value: 2 })).toThrow(
				RegistryConflictError,
			);
		});

		it("throws when key conflicts with existing alias", () => {
			registry.register({ name: "original", value: 1, aliases: ["alias"] });

			expect(() => registry.register({ name: "alias", value: 2 })).toThrow(
				RegistryConflictError,
			);
		});

		it("throws when alias conflicts with existing key", () => {
			registry.register({ name: "original", value: 1 });

			expect(() =>
				registry.register({ name: "new", value: 2, aliases: ["original"] }),
			).toThrow(RegistryConflictError);
		});

		it("throws when alias conflicts with existing alias", () => {
			registry.register({ name: "first", value: 1, aliases: ["shared"] });

			expect(() =>
				registry.register({ name: "second", value: 2, aliases: ["shared"] }),
			).toThrow(RegistryConflictError);
		});

		it("provides detailed conflict error info", () => {
			registry.register({ name: "existing", value: 1 });

			try {
				registry.register({ name: "existing", value: 2 });
			} catch (e) {
				expect(e).toBeInstanceOf(RegistryConflictError);
				const err = e as RegistryConflictError;
				expect(err.key).toBe("existing");
				expect(err.registryName).toBe("TestRegistry");
				expect(err.conflictType).toBe("key");
			}
		});
	});

	describe("throwOnConflict=false mode", () => {
		it("silently ignores duplicate registration", () => {
			const lenientRegistry = new TestRegistry(false);

			lenientRegistry.register({ name: "item", value: 1 });
			lenientRegistry.register({ name: "item", value: 2 }); // Should not throw

			// First registration wins
			expect(lenientRegistry.get("item")?.value).toBe(1);
		});

		it("silently ignores alias conflicts", () => {
			const lenientRegistry = new TestRegistry(false);

			lenientRegistry.register({ name: "first", value: 1, aliases: ["shared"] });
			lenientRegistry.register({ name: "second", value: 2, aliases: ["shared"] }); // Should not throw

			// First registration wins
			expect(lenientRegistry.get("shared")?.name).toBe("first");
		});
	});

	describe("Delete operations", () => {
		it("deletes item by key", () => {
			registry.register({ name: "deleteme", value: 1 });
			expect(registry.has("deleteme")).toBe(true);

			const result = registry.delete("deleteme");
			expect(result).toBe(true);
			expect(registry.has("deleteme")).toBe(false);
			expect(registry.size).toBe(0);
		});

		it("returns false when deleting non-existent key", () => {
			expect(registry.delete("nonexistent")).toBe(false);
		});

		it("removes associated aliases when deleting", () => {
			registry.register({
				name: "item",
				value: 1,
				aliases: ["alias1", "alias2"],
			});

			expect(registry.has("alias1")).toBe(true);
			expect(registry.has("alias2")).toBe(true);

			registry.delete("item");

			expect(registry.has("alias1")).toBe(false);
			expect(registry.has("alias2")).toBe(false);
		});

		it("clears all items and aliases", () => {
			registry.register({ name: "a", value: 1, aliases: ["x"] });
			registry.register({ name: "b", value: 2, aliases: ["y"] });

			registry.clear();

			expect(registry.size).toBe(0);
			expect(registry.has("a")).toBe(false);
			expect(registry.has("x")).toBe(false);
		});
	});

	describe("Edge cases", () => {
		it("handles empty alias array", () => {
			registry.register({ name: "item", value: 1, aliases: [] });
			expect(registry.get("item")?.value).toBe(1);
		});

		it("handles undefined aliases", () => {
			registry.register({ name: "item", value: 1 });
			expect(registry.get("item")?.value).toBe(1);
		});

		it("handles multiple items with different aliases", () => {
			registry.register({ name: "a", value: 1, aliases: ["a1", "a2"] });
			registry.register({ name: "b", value: 2, aliases: ["b1", "b2"] });

			expect(registry.get("a1")?.name).toBe("a");
			expect(registry.get("b2")?.name).toBe("b");
		});

		it("list() returns empty array for empty registry", () => {
			expect(registry.list()).toEqual([]);
		});

		it("keys() returns empty array for empty registry", () => {
			expect(registry.keys()).toEqual([]);
		});

		it("getOrThrow shows empty registry in error", () => {
			try {
				registry.getOrThrow("any");
			} catch (e) {
				const err = e as RegistryNotFoundError;
				expect(err.message).toContain("Registry is empty");
			}
		});
	});
});
