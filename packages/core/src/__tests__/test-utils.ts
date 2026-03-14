/**
 * Shared test utilities for @portalai/core tests.
 *
 * Centralises common helpers (regex patterns, stub factories, builder
 * functions) so individual test files stay focused on behaviour.
 */
import { CoreModelFactory } from "../models/base.model.js";
import { DateFactory } from "../utils/date.factory.js";
import { IDFactory } from "../utils/id-factory.js";

// ── Patterns ────────────────────────────────────────────────────────

/** Regex that matches a standard UUID v4 string. */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Stub factories ──────────────────────────────────────────────────

/** Deterministic ID factory for predictable assertions. */
export class StubIDFactory extends IDFactory {
  private _counter = 0;
  private _prefix: string;
  constructor(prefix: string = "stub-id") {
    super();
    this._prefix = prefix;
  }
  generate(): string {
    return `${this._prefix}-${++this._counter}`;
  }
}

// ── Builder helpers ─────────────────────────────────────────────────

/** A shared UTC DateFactory instance. */
export const dateFactory = new DateFactory("UTC");

/**
 * Build a `CoreModelFactory` with an optional custom `IDFactory`.
 * Defaults to the real `UUIDv4Factory` when none is provided.
 */
export function buildCoreModelFactory(idFactory?: IDFactory) {
  return new CoreModelFactory({
    dateFactory,
    ...(idFactory ? { idFactory } : {}),
  });
}
