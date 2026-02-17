import { v4, v5 } from "uuid";

/**
 * Abstract factory for generating unique identifiers.
 *
 * Subclasses implement `generate()` to produce IDs using a specific
 * strategy (UUIDv4, UUIDv5, nanoid, etc.).
 */
export abstract class IDFactory {
  /** Return a new unique identifier string. */
  constructor() {
    if (new.target === IDFactory) {
      throw new Error(
        "IDFactory is abstract and cannot be instantiated directly."
      );
    }
  }
  abstract generate(): string;
}

/**
 * Generates random UUIDv4 identifiers.
 *
 * Each call to `generate()` returns a new cryptographically-random
 * UUID (e.g. `"9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"`).
 */
export class UUIDv4Factory extends IDFactory {
  generate(): string {
    return v4();
  }
}

/**
 * Generates deterministic UUIDv5 identifiers.
 *
 * UUIDv5 produces the **same** UUID for a given `(name, namespace)` pair,
 * making it ideal for stable, reproducible identifiers (e.g. deriving a
 * resource ID from a URL or domain-specific key).
 *
 * @example
 * ```ts
 * const factory = new UUIDv5Factory("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
 * factory.generate("https://example.com");
 * // → always returns the same UUID for that input
 * ```
 */
export class UUIDv5Factory extends IDFactory {
  /** The namespace UUID used to scope generated IDs. */
  private readonly namespace: string;

  /**
   * @param namespace - A valid UUID that acts as the namespace.
   *   Common choices:
   *   - `v5.DNS`  (`"6ba7b810-9dad-11d1-80b4-00c04fd430c8"`)
   *   - `v5.URL`  (`"6ba7b811-9dad-11d1-80b4-00c04fd430c8"`)
   *   - Any application-specific UUID.
   */
  constructor(namespace: string) {
    super();
    this.namespace = namespace;
  }

  /**
   * Generate a UUIDv5 for the given name.
   *
   * @param name - The value to hash within the namespace.
   *               If omitted, a random fallback name is generated via
   *               `v4()` so the factory still satisfies the
   *               `IDFactory.generate()` contract.
   */
  generate(name?: string): string {
    const input = name ?? v4();
    return v5(input, this.namespace);
  }
}
