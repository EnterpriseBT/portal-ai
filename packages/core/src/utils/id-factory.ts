import { v4 } from "uuid";

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
