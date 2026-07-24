import { describe, it, expect } from "@jest/globals";

import {
  VISUALIZE_D3_CODEGEN_SYSTEM,
  buildCodegenPrompt,
} from "../../prompts/visualize-d3.prompt.js";

describe("VISUALIZE_D3_CODEGEN_SYSTEM (#269)", () => {
  it("states the runtime contract, idempotence rule, output shape, and a worked example", () => {
    const s = VISUALIZE_D3_CODEGEN_SYSTEM;
    // The api object the sandbox exposes.
    expect(s).toMatch(/api\.data/);
    expect(s).toMatch(/api\.theme/);
    expect(s).toMatch(/api\.container/);
    // Executed as new Function — the program is a function body.
    expect(s).toMatch(/new Function/);
    expect(s.toLowerCase()).toMatch(/function body/);
    // Progressive-render idempotence.
    expect(s.toLowerCase()).toMatch(/idempotent|re-?invoked|clear|redraw/);
    // A worked example (svg/append).
    expect(s.toLowerCase()).toMatch(/example/);
    expect(s).toMatch(/svg|append/);
  });
});

describe("buildCodegenPrompt (#269)", () => {
  const schema = [
    { name: "month", type: "text" },
    { name: "revenue", type: "numeric" },
  ];
  const samplePeek = [{ month: "Jan", revenue: 10 }];

  it("interpolates the instruction, schema columns, and sample", () => {
    const p = buildCodegenPrompt({
      instruction: "bar chart of revenue by month",
      schema,
      samplePeek,
    });
    expect(p).toMatch(/bar chart of revenue by month/);
    expect(p).toMatch(/month/);
    expect(p).toMatch(/revenue/);
    expect(p).toMatch(/Jan/);
  });

  it("includes the prior error on a retry", () => {
    const p = buildCodegenPrompt({
      instruction: "x",
      schema,
      samplePeek,
      lastError: "Unexpected token )",
    });
    expect(p).toMatch(/Unexpected token \)/);
  });
});
