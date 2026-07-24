import { readFileSync } from "node:fs";

// The bootstrap executes only inside the sandboxed iframe (real browser);
// jsdom can't run cross-frame scripts (spec resolved Q5), so this suite
// pins the source's load-bearing markers at string level. Behavioral
// coverage lives in the web Storybook + the smoke checklist.
const source = readFileSync(
  new URL("../sandbox-bootstrap.js", import.meta.url),
  "utf8"
);

describe("sandbox-bootstrap.js source contract", () => {
  it("compiles the program via new Function('api', …)", () => {
    expect(source).toContain('new Function("api"');
  });

  it("coalesces render passes via requestAnimationFrame", () => {
    expect(source).toContain("requestAnimationFrame");
  });

  it("reports content height via a ResizeObserver", () => {
    expect(source).toContain("ResizeObserver");
  });

  it("communicates only via postMessage", () => {
    expect(source).toContain("postMessage");
  });

  it("is a standalone strict-mode script — no module syntax", () => {
    expect(source).toContain('"use strict"');
    expect(source).not.toMatch(/^\s*(import|export)\b/m);
  });
});
