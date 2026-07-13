import { describe, it, expect } from "@jest/globals";

import {
  buildJsonataSuggestPrompt,
  truncateForPrompt,
} from "../../../adapters/rest-api/jsonata-suggest.prompt.js";

// ── truncateForPrompt ────────────────────────────────────────────────

describe("truncateForPrompt — primitives pass through", () => {
  it("returns numbers unchanged", () => {
    expect(truncateForPrompt(42)).toBe(42);
  });

  it("returns strings unchanged", () => {
    expect(truncateForPrompt("abc")).toBe("abc");
  });

  it("returns booleans unchanged", () => {
    expect(truncateForPrompt(false)).toBe(false);
    expect(truncateForPrompt(true)).toBe(true);
  });

  it("returns null unchanged", () => {
    expect(truncateForPrompt(null)).toBeNull();
  });

  it("returns undefined unchanged", () => {
    expect(truncateForPrompt(undefined)).toBeUndefined();
  });
});

describe("truncateForPrompt — arrays", () => {
  it("returns arrays of length <= 5 unchanged (deep-equal, new instance)", () => {
    const input = [1, 2, 3, 4, 5];
    const result = truncateForPrompt(input) as unknown[];
    expect(result).toEqual([1, 2, 3, 4, 5]);
    expect(result).not.toBe(input);
  });

  it("returns the first 5 elements + __truncated__ sentinel for 6-element array", () => {
    const result = truncateForPrompt([1, 2, 3, 4, 5, 6]);
    expect(result).toEqual([1, 2, 3, 4, 5, "__truncated__"]);
  });

  it("returns 6-element array (5 + sentinel) for 100-element input", () => {
    const input = Array.from({ length: 100 }, (_, i) => i);
    const result = truncateForPrompt(input) as unknown[];
    expect(result.length).toBe(6);
    expect(result.slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(result[5]).toBe("__truncated__");
  });

  it("recurses into elements that survive the slice", () => {
    const input = [[1, 2, 3, 4, 5, 6], [7]];
    expect(truncateForPrompt(input)).toEqual([
      [1, 2, 3, 4, 5, "__truncated__"],
      [7],
    ]);
  });

  it("returns empty array unchanged (no sentinel)", () => {
    expect(truncateForPrompt([])).toEqual([]);
  });

  it("preserves mixed types in the first 5 elements", () => {
    const result = truncateForPrompt([1, "two", true, null, { a: 1 }, "sixth"]);
    expect(result).toEqual([1, "two", true, null, { a: 1 }, "__truncated__"]);
  });
});

describe("truncateForPrompt — objects", () => {
  it("returns empty object unchanged", () => {
    expect(truncateForPrompt({})).toEqual({});
  });

  it("recurses into object values", () => {
    expect(truncateForPrompt({ a: [1, 2, 3, 4, 5, 6] })).toEqual({
      a: [1, 2, 3, 4, 5, "__truncated__"],
    });
  });

  it("recurses through deep nesting", () => {
    const input = {
      data: {
        items: Array.from({ length: 10 }, (_, i) => ({ id: i })),
      },
    };
    const result = truncateForPrompt(input) as {
      data: { items: unknown[] };
    };
    expect(result.data.items.length).toBe(6);
    expect(result.data.items.slice(0, 5)).toEqual([
      { id: 0 },
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
    ]);
    expect(result.data.items[5]).toBe("__truncated__");
  });

  it("preserves keys and values for objects with all simple values", () => {
    expect(truncateForPrompt({ a: 1, b: "x", c: null })).toEqual({
      a: 1,
      b: "x",
      c: null,
    });
  });
});

// ── buildJsonataSuggestPrompt ────────────────────────────────────────

describe("buildJsonataSuggestPrompt", () => {
  const sample = { data: { items: [{ id: 1, name: "x" }] } };

  it("renders the sample as pretty JSON under the Sample response header", () => {
    const prompt = buildJsonataSuggestPrompt({ sampleResponse: sample });
    expect(prompt).toContain("## Sample response");
    expect(prompt).toContain(JSON.stringify(sample, null, 2));
  });

  it("shows '(no hint provided)' under the User hint header when hint is absent", () => {
    const prompt = buildJsonataSuggestPrompt({ sampleResponse: sample });
    expect(prompt).toContain("## User hint");
    expect(prompt).toContain("(no hint provided)");
  });

  it("renders the hint verbatim when provided", () => {
    const prompt = buildJsonataSuggestPrompt({
      sampleResponse: sample,
      promptHint: "use just id and email",
    });
    expect(prompt).toContain("## User hint");
    expect(prompt).toContain("use just id and email");
    expect(prompt).not.toContain("(no hint provided)");
  });

  it("omits the Previous attempt section when previousAttempt is absent", () => {
    const prompt = buildJsonataSuggestPrompt({ sampleResponse: sample });
    expect(prompt).not.toContain("## Previous attempt");
  });

  it("renders the Previous attempt section with both fields when set", () => {
    const prompt = buildJsonataSuggestPrompt({
      sampleResponse: sample,
      previousAttempt: {
        expression: "data.items.{}",
        error: "the expression returned 0 records",
      },
    });
    expect(prompt).toContain("## Previous attempt");
    expect(prompt).toContain("data.items.{}");
    expect(prompt).toContain("the expression returned 0 records");
  });

  it("includes the closing instruction line", () => {
    const prompt = buildJsonataSuggestPrompt({ sampleResponse: sample });
    expect(prompt).toContain(
      'Return JSON: { "expression": "<jsonata expression string>" }.'
    );
  });

  it("is deterministic across two calls with deep-equal input", () => {
    const inputA = { sampleResponse: sample, promptHint: "hint" };
    const inputB = { sampleResponse: sample, promptHint: "hint" };
    expect(buildJsonataSuggestPrompt(inputA)).toBe(
      buildJsonataSuggestPrompt(inputB)
    );
  });

  it("includes the opening rubric lines about flat record objects and JSONata syntax", () => {
    const prompt = buildJsonataSuggestPrompt({ sampleResponse: sample });
    // The four bullet-rules from the spec rubric.
    expect(prompt).toContain("array of flat record objects");
    expect(prompt).toContain("plain object");
    expect(prompt).toContain("top-level keys");
    expect(prompt).toContain("docs.jsonata.org");
  });

  it("pretty-prints the JSON sample with indent of 2", () => {
    const prompt = buildJsonataSuggestPrompt({ sampleResponse: sample });
    // After "## Sample response\n" expect at least one indented newline.
    expect(prompt).toMatch(/## Sample response\n\{\n {2}"data":/);
  });
});
