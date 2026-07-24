import { describe, it, expect } from "@jest/globals";

import { validateProgram } from "../../tools/visualize-d3.validate.js";

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
