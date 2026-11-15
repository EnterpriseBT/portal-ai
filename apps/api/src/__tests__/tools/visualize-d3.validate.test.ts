import { describe, it, expect } from "@jest/globals";

import {
  findColourLiterals,
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

// #1022: series colours come from api.theme (held at 3:1 by the theme), so a
// program that writes its own colour is rejected and regenerated.
describe("the colour check (#1022)", () => {
  const program = (line: string) =>
    `const svg = api.d3.select(api.container).append("svg");\n${line}`;

  it.each([
    ["#rgb", 'svg.attr("fill", "#f00");', "#f00"],
    ["#rgba", 'svg.attr("fill", "#f00a");', "#f00a"],
    ["#rrggbb", "svg.attr('stroke', '#1f77b4');", "#1f77b4"],
    ["#rrggbbaa", "svg.attr(`fill`, `#1f77b4cc`);", "#1f77b4cc"],
    ["rgb()", 'svg.style("fill", "rgb(31, 119, 180)");', "rgb("],
    ["rgba()", 'const c = "rgba(0,0,0,0.5)";', "rgba("],
    ["hsl()", 'svg.attr("fill", `hsl(${i * 40}, 60%, 50%)`);', "hsl("],
    [
      "a d3 scheme",
      "const c = d3.scaleOrdinal(d3.schemeCategory10);",
      "d3.schemeCategory10",
    ],
    [
      "api.d3 scheme",
      "const c = api.d3.schemeTableau10;",
      "api.d3.schemeTableau10",
    ],
    [
      "a colour interpolator",
      "const c = api.d3.interpolateViridis(0.5);",
      "api.d3.interpolateViridis",
    ],
    ["a named fill", 'svg.attr("fill", "red");', "red"],
    ["a named style stroke", "svg.style('stroke', 'steelblue');", "steelblue"],
    [
      "a named colour in a ternary",
      "svg.attr('fill', (d) => (d.v > 0 ? 'green' : api.theme.text));",
      "green",
    ],
    [
      "a named colour in an array",
      "const c = ['navy', api.theme.text];",
      "navy",
    ],
    [
      "a scheme inside a template",
      "svg.attr('fill', `${api.d3.schemeTableau10[0]}`);",
      "api.d3.schemeTableau10",
    ],
    ["a hex in a CSS declaration", 'svg.attr("style", "fill:#fff");', "#fff"],
    [
      "a hex in a gradient",
      'svg.style("background", "linear-gradient(#fff, #000)");',
      "#fff",
    ],
  ])("rejects %s", (_kind, line, literal) => {
    const res = validateProgram(program(line));
    expect(res).toEqual({
      ok: false,
      error: `Colour "${literal}" on line 2: take series colours from api.theme.categorical, and use api.theme.text or api.theme.background for anything else.`,
      colour: { literal, line: 2 },
    });
  });

  it.each([
    [
      "a theme colour",
      'svg.attr("fill", api.theme.categorical[i % api.theme.categorical.length]);',
    ],
    [
      "none and currentColor",
      'svg.attr("fill", "none").attr("stroke", "currentColor");',
    ],
    [
      "transparent and inherit",
      "svg.style('fill', 'transparent').style('color', 'inherit');",
    ],
    ["a non-colour interpolator", "const t = api.d3.interpolateNumber(0, 10);"],
    [
      "a hex in a line comment",
      "// was #1f77b4 before #1022\nsvg.attr('fill', api.theme.text);",
    ],
    [
      "a hex in a block comment",
      "/* fill: #fff */ svg.attr('fill', api.theme.background);",
    ],
    [
      "a # that isn't a colour",
      'svg.append("text").text("#1 region").attr("id", "#total");',
    ],
    [
      "a colour word in text",
      'svg.append("text").text("red team vs blue team");',
    ],
    ["a dash pattern", 'svg.attr("stroke-dasharray", api.theme.dashes[1]);'],
    ["an order number", 'svg.append("text").text("Order #1234");'],
    [
      "a rank in a template",
      "svg.append('text').text(`Rank #123 of ${api.data.length}`);",
    ],
    ["a hex-like word in text", "svg.append('text').text('Build #cafe');"],
  ])("allows %s", (_kind, line) => {
    expect(validateProgram(program(line))).toEqual({ ok: true });
  });

  it("a parse error wins over a colour", () => {
    const res = validateProgram('svg.attr("fill", "#f00") )(');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).not.toMatch(/^Colour/);
      expect(res).not.toHaveProperty("colour");
    }
  });

  it("finds every literal, in order of appearance", () => {
    expect(
      findColourLiterals(
        'a.attr("fill", "#abc");\nb.style("stroke", "navy");\nc(d3.schemeSet2);'
      )
    ).toEqual([
      { literal: "#abc", line: 1 },
      { literal: "navy", line: 2 },
      { literal: "d3.schemeSet2", line: 3 },
    ]);
  });
});
