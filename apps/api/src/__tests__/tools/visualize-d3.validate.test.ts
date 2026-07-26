import { describe, it, expect } from "@jest/globals";

import {
  validateProgram,
  stripProgramFence,
} from "../../tools/visualize-d3.validate.js";

// validateProgram is the parse-only gate: it constructs `new Function("api", src)`
// exactly as the sandbox bootstrap does — so acceptance can't diverge from what
// the frame parses — and NEVER calls the function (no execution, no side effects).

describe("validateProgram (#269)", () => {
  it("accepts a well-formed function body", () => {
    expect(
      validateProgram("api.d3.select(api.container).append('svg');")
    ).toEqual({ ok: true });
  });

  it("rejects a syntax error with the message", () => {
    const res = validateProgram("this is not javascript )(");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBeTruthy();
  });

  it("is construction-only — a body with fetch()/side effects validates ok (never executed)", () => {
    // If this ran, fetch would be called; parse-only means it just validates.
    expect(validateProgram("fetch('https://evil.example');").ok).toBe(true);
  });

  it("is construction-only — a body that throws still validates ok", () => {
    expect(validateProgram("throw new Error('boom');").ok).toBe(true);
  });
});

// #281 — the codegen model sometimes wraps the program in a Markdown fence,
// which parses as an empty-string tagged template ("" is not a function at
// runtime). Strip the fence before validation/minting.
describe("stripProgramFence (#281)", () => {
  const PROG = "const d3 = api.d3;\napi.container.innerHTML = '';";

  it("strips a ```javascript fence", () => {
    expect(stripProgramFence("```javascript\n" + PROG + "\n```")).toBe(PROG);
  });

  it("strips a bare ``` fence", () => {
    expect(stripProgramFence("```\n" + PROG + "\n```")).toBe(PROG);
  });

  it("tolerates surrounding whitespace and a doubled opening fence", () => {
    expect(stripProgramFence("\n```javascript\n```\n" + PROG + "\n```\n")).toBe(
      PROG
    );
  });

  it("leaves an unfenced program unchanged", () => {
    expect(stripProgramFence(PROG)).toBe(PROG);
  });

  it("a fenced program is a runtime trap that validateProgram accepts, but the stripped one is clean", () => {
    const fenced = "```javascript\n" + PROG + "\n```";
    // The fence is syntactically valid (tagged template) — hence the bug.
    expect(validateProgram(fenced).ok).toBe(true);
    // After stripping, it's the real function body.
    expect(validateProgram(stripProgramFence(fenced)).ok).toBe(true);
    expect(stripProgramFence(fenced)).not.toContain("```");
  });
});
