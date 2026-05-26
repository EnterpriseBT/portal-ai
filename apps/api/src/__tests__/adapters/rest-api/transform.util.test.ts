import { describe, it, expect } from "@jest/globals";

import { applyTransform } from "../../../adapters/rest-api/transform.util.js";

// ── Degenerate inputs ────────────────────────────────────────────────

describe("applyTransform — empty / whitespace expressions", () => {
  it("returns a parse error for an empty expression", async () => {
    const result = await applyTransform("", { data: { items: [1] } });
    expect(result.records).toEqual([]);
    expect(result.error?.kind).toBe("parse");
  });

  it("returns a parse error for a whitespace-only expression", async () => {
    const result = await applyTransform("   \n  ", { data: { items: [1] } });
    expect(result.records).toEqual([]);
    expect(result.error?.kind).toBe("parse");
  });
});

// ── Discovery case 1: records nested under one path ─────────────────

describe("applyTransform — discovery case 1 (recordsPath equivalent)", () => {
  it("extracts records via a dotted path", async () => {
    const response = {
      status: "ok",
      data: { items: [{ id: 1 }, { id: 2 }] },
    };
    const result = await applyTransform("data.items", response);
    expect(result.error).toBeNull();
    expect(result.records).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

// ── Discovery case 2: records split across multiple top-level arrays ─

describe("applyTransform — discovery case 2 (multi-source union)", () => {
  it("concatenates two top-level arrays via $append", async () => {
    const response = {
      active_users: [{ id: 1, status: "active" }],
      archived_users: [{ id: 2, status: "archived" }],
    };
    const result = await applyTransform(
      "$append(active_users, archived_users)",
      response
    );
    expect(result.error).toBeNull();
    expect(result.records).toEqual([
      { id: 1, status: "active" },
      { id: 2, status: "archived" },
    ]);
  });
});

// ── Discovery case 3: flattening nested objects ──────────────────────

describe("applyTransform — discovery case 3 (projection / flatten)", () => {
  it("projects nested fields into a flat record shape", async () => {
    const response = {
      data: [
        { id: 1, user: { name: "Ada", email: "ada@x.test" } },
        { id: 2, user: { name: "Grace", email: "grace@x.test" } },
      ],
    };
    const result = await applyTransform(
      'data.{ "id": id, "user_name": user.name, "user_email": user.email }',
      response
    );
    expect(result.error).toBeNull();
    expect(result.records).toEqual([
      { id: 1, user_name: "Ada", user_email: "ada@x.test" },
      { id: 2, user_name: "Grace", user_email: "grace@x.test" },
    ]);
  });
});

// ── Discovery case 4: filter + project ───────────────────────────────

describe("applyTransform — discovery case 4 (filter + project)", () => {
  it("filters and projects in one expression", async () => {
    const response = {
      results: [
        { id: 1, active: true, deleted_at: null },
        { id: 2, active: false, deleted_at: "2025-01-01" },
        { id: 3, active: true, deleted_at: null },
      ],
    };
    const result = await applyTransform(
      'results[active = true and deleted_at = null].{ "id": id }',
      response
    );
    expect(result.error).toBeNull();
    expect(result.records).toEqual([{ id: 1 }, { id: 3 }]);
  });
});

// ── Result-shape coercion ────────────────────────────────────────────

describe("applyTransform — result-shape coercion", () => {
  it("wraps a single-object result into a one-element array", async () => {
    const result = await applyTransform("payload", {
      payload: { id: 1, name: "x" },
    });
    expect(result.error).toBeNull();
    expect(result.records).toEqual([{ id: 1, name: "x" }]);
  });

  it("wraps a primitive result as [{ value: primitive }]", async () => {
    const result = await applyTransform("count", { count: 42 });
    expect(result.error).toBeNull();
    expect(result.records).toEqual([{ value: 42 }]);
  });

  it("returns an empty array for an undefined / unreachable result", async () => {
    const result = await applyTransform("missing.deep.path", { other: 1 });
    expect(result.error).toBeNull();
    expect(result.records).toEqual([]);
  });

  it("returns an empty array when the response is null", async () => {
    const result = await applyTransform("data.items", null);
    expect(result.error).toBeNull();
    expect(result.records).toEqual([]);
  });
});

// ── Error classification ─────────────────────────────────────────────

describe("applyTransform — error classification", () => {
  it("classifies syntax errors as parse failures", async () => {
    const result = await applyTransform("data.{ unclosed", {
      data: { items: [] },
    });
    expect(result.records).toEqual([]);
    expect(result.error?.kind).toBe("parse");
    expect(result.error?.message).toBeTruthy();
  });

  it("classifies runtime evaluation failures as runtime errors", async () => {
    // `$foo` is an undefined function — jsonata throws at evaluate time,
    // not at parse time, because functions resolve dynamically.
    const result = await applyTransform("$foo(items)", {
      items: [1, 2, 3],
    });
    expect(result.records).toEqual([]);
    expect(result.error?.kind).toBe("runtime");
    expect(result.error?.message).toBeTruthy();
  });
});

// ── Sandbox — no Node globals reachable ──────────────────────────────

describe("applyTransform — sandbox isolation", () => {
  it("cannot reach Node globals (process, require, global, Buffer)", async () => {
    // Each global resolved in jsonata context maps to a field lookup on
    // the input data. With an empty input, all four resolve to
    // undefined and the wrap-to-array logic returns [].
    for (const name of ["process", "require", "global", "Buffer"]) {
      const result = await applyTransform(name, {});
      expect(result.error).toBeNull();
      expect(result.records).toEqual([]);
    }
  });
});

// ── Performance smoke ────────────────────────────────────────────────

describe("applyTransform — performance smoke", () => {
  it("handles 10 000 records in under 250ms (project + filter)", async () => {
    const records = Array.from({ length: 10_000 }, (_, i) => ({
      id: i,
      nested: { value: i * 2 },
      active: i % 2 === 0,
    }));
    const start = Date.now();
    const result = await applyTransform(
      'records[active = true].{ "id": id, "v": nested.value }',
      { records }
    );
    const elapsed = Date.now() - start;
    expect(result.error).toBeNull();
    expect(result.records).toHaveLength(5_000);
    expect(elapsed).toBeLessThan(250);
  });
});
