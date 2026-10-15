import { describe, it, expect } from "@jest/globals";

const { MAX_NUL_PATH_LENGTH, findNul, stripNul, stripNulDeep } =
  await import("../../utils/nul-character.util.js");

const NUL = "\u0000";

// ── findNul ─────────────────────────────────────────────────────────

describe("findNul", () => {
  it("finds a NUL in a top-level string value", () => {
    expect(findNul({ name: `Ops${NUL}x` })).toEqual({ path: "name" });
  });

  it("finds a NUL in a nested value", () => {
    expect(findNul({ data: { notes: `a${NUL}` } })).toEqual({
      path: "data.notes",
    });
  });

  it("finds a NUL in an array element", () => {
    expect(findNul({ items: ["a", "b", `c${NUL}`] })).toEqual({
      path: "items.2",
    });
    expect(findNul({ items: [{ name: "a" }, { name: `${NUL}` }] })).toEqual({
      path: "items.1.name",
    });
  });

  it("reports a NUL in a key as the parent path plus the stripped key", () => {
    expect(findNul({ data: { [`k${NUL}`]: 1 } })).toEqual({ path: "data.k" });
    expect(findNul({ [`${NUL}k`]: 1 })).toEqual({ path: "k" });
  });

  it("reports a root string as the empty path", () => {
    expect(findNul(`x${NUL}`)).toEqual({ path: "" });
  });

  it("reports the first NUL in document order", () => {
    expect(findNul({ a: "ok", b: `${NUL}`, c: `${NUL}` })).toEqual({
      path: "b",
    });
    expect(findNul([[`${NUL}`], `${NUL}`])).toEqual({ path: "0.0" });
  });

  it("visits keys and values strictly in document order", () => {
    // `a`'s nested value comes before the later key `b\u0000`.
    expect(findNul({ a: { x: `${NUL}` }, [`b${NUL}`]: 1 })).toEqual({
      path: "a.x",
    });
    expect(findNul({ [`a${NUL}`]: { x: `${NUL}` } })).toEqual({ path: "a" });
  });

  it("returns null for clean input", () => {
    expect(findNul({ name: "Ops", n: 1, b: true, z: null })).toBeNull();
    expect(findNul([])).toBeNull();
    expect(findNul(undefined)).toBeNull();
    expect(findNul(42)).toBeNull();
  });

  it("accepts the escaped text \\u0000, tab, newline and other controls", () => {
    // JSON.parse('"\\\\u0000"') is a backslash followed by "u0000": six
    // printable characters, which Postgres stores fine.
    expect(findNul({ code: JSON.parse('"\\\\u0000"') })).toBeNull();
    expect(findNul({ tsv: "a\tb\nc\r\u0001\u001f" })).toBeNull();
  });

  it("doesn't overflow the stack on deep nesting", () => {
    let deep: unknown = `leaf${NUL}`;
    for (let i = 0; i < 10_000; i++) deep = { n: deep };
    const hit = findNul(deep);
    expect(hit?.path.startsWith("n.n.n")).toBe(true);
  });

  it("doesn't walk non-plain objects", () => {
    expect(findNul({ at: new Date(0) })).toBeNull();
  });

  it("walks null-prototype objects", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.v = `${NUL}`;
    expect(findNul({ o })).toEqual({ path: "o.v" });
  });

  it("caps a long path", () => {
    const key = "k".repeat(MAX_NUL_PATH_LENGTH * 2);
    const hit = findNul({ [key]: `${NUL}` });
    expect(hit?.path).toHaveLength(MAX_NUL_PATH_LENGTH);
    expect(hit?.path.endsWith("…")).toBe(true);
  });
});

// ── stripNul ────────────────────────────────────────────────────────

describe("stripNul", () => {
  it("removes every NUL", () => {
    expect(stripNul(`${NUL}a${NUL}${NUL}b${NUL}`)).toBe("ab");
  });

  it("leaves a clean string alone", () => {
    expect(stripNul("a\tb")).toBe("a\tb");
  });
});

// ── stripNulDeep ────────────────────────────────────────────────────

describe("stripNulDeep", () => {
  it("returns the same reference and 0 for clean input", () => {
    const input = { a: "x", b: [1, { c: "y" }] };
    const out = stripNulDeep(input);
    expect(out.value).toBe(input);
    expect(out.stripped).toBe(0);
  });

  it("strips a root string", () => {
    expect(stripNulDeep(`a${NUL}b`)).toEqual({ value: "ab", stripped: 1 });
  });

  it("returns a stripped copy and leaves the original untouched", () => {
    const input = {
      name: `Ops${NUL}x`,
      tags: ["ok", `t${NUL}`],
      nested: { [`k${NUL}`]: `v${NUL}`, keep: 1 },
    };
    const out = stripNulDeep(input);
    expect(out.value).toEqual({
      name: "Opsx",
      tags: ["ok", "t"],
      nested: { k: "v", keep: 1 },
    });
    // name, tags.1, the nested key and its value.
    expect(out.stripped).toBe(4);
    expect(input.name).toBe(`Ops${NUL}x`);
    expect(input.nested).toHaveProperty(`k${NUL}`);
  });

  it("passes non-plain values through", () => {
    const at = new Date(0);
    const out = stripNulDeep({ at, s: `${NUL}` });
    expect(out.value.at).toBe(at);
  });

  it("lets the later key win when stripping makes two keys collide", () => {
    const out = stripNulDeep({ [`a${NUL}`]: 1, a: 2 });
    expect(out.value).toEqual({ a: 2 });
  });

  it("copies into plain objects, even from a null-prototype input", () => {
    const sub = Object.create(null) as Record<string, unknown>;
    sub.v = `${NUL}`;
    const out = stripNulDeep({ sub });
    const copied = (out.value as { sub: object }).sub;
    expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
    expect(copied).toEqual({ v: "" });
  });

  it("keeps a __proto__ key as an own property, never as the prototype", () => {
    const input = JSON.parse(`{"__proto__":{"polluted":"x\\u0000"}}`);
    const out = stripNulDeep(input);
    const copy = out.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(copy, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("doesn't overflow the stack on deep dirty nesting", () => {
    let deep: unknown = `leaf${NUL}`;
    for (let i = 0; i < 10_000; i++) deep = { n: deep };
    expect(stripNulDeep(deep).stripped).toBe(1);
  });
});
