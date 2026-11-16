import { describe, it, expect } from "@jest/globals";

import {
  VISUALIZE_D3_CODEGEN_SYSTEM,
  buildCodegenPrompt,
} from "../../prompts/visualize-d3.prompt.js";
import { validateProgram } from "../../tools/visualize-d3.validate.js";

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

// #278: the two axes are NOT symmetric. `api.width` is a layout constraint
// the program should respect; `api.height` carries no budget, because the
// widget always grows to fit whatever is painted and never scrolls
// vertically. The old wording steered straight into the clipping bug.
describe("VISUALIZE_D3_CODEGEN_SYSTEM sizing semantics (#278)", () => {
  const s = VISUALIZE_D3_CODEGEN_SYSTEM;

  it("describes width as the available width and height as exceedable", () => {
    expect(s).toMatch(/api\.width\s+.*available width/);
    // The height line must say it may be exceeded / is only a starting point.
    expect(s).toMatch(/api\.height\s+.*(exceed|starting|suggested)/i);
    expect(s.toLowerCase()).toMatch(
      /grows to fit|grow to fit|fits? (the )?whole/
    );
  });

  it("tells the program to give labels and legends the room they need", () => {
    expect(s.toLowerCase()).toMatch(/label|legend/);
    expect(s.toLowerCase()).toMatch(
      /never (compress|clip|shrink)|do not (compress|clip)/
    );
  });

  it('no longer instructs the program to "stay bounded" by the height', () => {
    // The exact instruction that produced clipped axes and legends.
    expect(s).not.toMatch(/stay bounded/i);
  });

  it("derives the example's height from api.height rather than hardcoding it", () => {
    expect(s).not.toMatch(/height\s*=\s*260/);
    // The example still shows an explicit height, sourced from the api.
    expect(s).toMatch(/height\s*=\s*[^;\n]*api\.height/);
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

  it("says a retry's error was a rejection, not only a compile failure (#1022)", () => {
    const p = buildCodegenPrompt({
      instruction: "x",
      schema,
      samplePeek,
      lastError:
        'Colour "red" on line 3: take series colours from api.theme.categorical, …',
    });
    expect(p).toMatch(/was rejected/);
    expect(p).not.toMatch(/failed to compile/);
  });
});

// #1022: series colours come only from the theme, and two or more series
// differ by more than colour.
describe("VISUALIZE_D3_CODEGEN_SYSTEM colour and labelling (#1022)", () => {
  const s = VISUALIZE_D3_CODEGEN_SYSTEM;

  it("documents the theme fields a program may use", () => {
    for (const field of ["background", "categorical", "dashes", "symbols"]) {
      expect(s).toContain(`api.theme.${field}`);
    }
  });

  it("forbids colour literals and d3 colour schemes", () => {
    expect(s).toMatch(/never write a colou?r literal/i);
    expect(s).toMatch(/d3\.scheme/);
    expect(s).toMatch(/rejected/i);
  });

  it("requires a second cue and a text legend from two series up", () => {
    expect(s).toMatch(/two or more series/i);
    expect(s).toMatch(/label each series directly/i);
    expect(s).toMatch(/api\.theme\.dashes/);
    expect(s).toMatch(/api\.theme\.symbols/);
    expect(s).toMatch(/text legend/i);
  });

  it("its worked example passes the colour check", () => {
    const example = s.slice(s.indexOf("EXAMPLE"));
    const body = example.slice(
      example.indexOf("\n", example.indexOf("Given data")) + 1
    );
    expect(validateProgram(body)).toEqual({ ok: true });
  });
});
