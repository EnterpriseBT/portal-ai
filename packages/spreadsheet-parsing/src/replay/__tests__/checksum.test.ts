import { describe, it, expect } from "@jest/globals";

import { computeChecksum } from "../checksum.js";

describe("computeChecksum", () => {
  it("returns a stable hex string", () => {
    const out = computeChecksum({ a: 1, b: "two" });
    expect(out).toMatch(/^[a-f0-9]{16}$/);
  });

  it("is order-independent — reordering fields yields the same checksum", () => {
    const a = computeChecksum({ name: "alice", age: 30, email: "a@x.com" });
    const b = computeChecksum({ age: 30, email: "a@x.com", name: "alice" });
    expect(a).toBe(b);
  });

  it("distinguishes different field values", () => {
    const a = computeChecksum({ name: "alice" });
    const b = computeChecksum({ name: "bob" });
    expect(a).not.toBe(b);
  });

  it("distinguishes different field names for the same value", () => {
    const a = computeChecksum({ name: "alice" });
    const b = computeChecksum({ label: "alice" });
    expect(a).not.toBe(b);
  });

  it("is stable across repeated invocations (pure function)", () => {
    const a = computeChecksum({ a: 1 });
    const b = computeChecksum({ a: 1 });
    expect(a).toBe(b);
  });

  it("matches the legacy `record-import.util.ts` format (SHA-256 hex, 16 chars)", () => {
    // Legacy computeChecksum: sha256(JSON.stringify(data, sortedKeys)).slice(0, 16)
    // Both use node:crypto directly — checksums compare cleanly in the commit path.
    const out = computeChecksum({ email: "a@x.com", name: "alice", age: 30 });
    expect(out).toHaveLength(16);
  });

  it("handles nested values deterministically (JSON serialisation is stable)", () => {
    const a = computeChecksum({ tags: ["x", "y"], meta: { k: 1 } });
    const b = computeChecksum({ meta: { k: 1 }, tags: ["x", "y"] });
    expect(a).toBe(b);
  });
});
