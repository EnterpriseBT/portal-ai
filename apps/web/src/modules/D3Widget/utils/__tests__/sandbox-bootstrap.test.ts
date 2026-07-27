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

  // #278: height/width must reflect the PAINTED extent, not the DOM box.
  // scrollHeight misses marks drawn outside a declared SVG viewport, which
  // is what silently cropped the beeswarm; getBBox catches them, and
  // getScreenCTM converts user units to CSS px.
  describe("painted-extent measurement", () => {
    it("measures SVG content via getBBox scaled through getScreenCTM", () => {
      expect(source).toContain("getBBox");
      expect(source).toContain("getScreenCTM");
    });

    it("falls back to the DOM box when measurement is unavailable", () => {
      expect(source).toContain("scrollWidth");
      expect(source).toContain("scrollHeight");
    });

    it("reports a width alongside height on rendered and resize", () => {
      // Both report sites carry the measured size.
      expect(source).toMatch(/post\(\s*"rendered"[\s\S]{0,160}width/);
      expect(source).toMatch(/post\(\s*"resize"[\s\S]{0,120}width/);
    });

    // #278 follow-up: measuring the painted extent is not enough. Marks that
    // escape the SVG viewport also escape the BODY box, where the srcdoc's
    // `overflow:hidden` clips them — the frame grows and the content is still
    // invisible. Growing #root to the measured extent makes the document box
    // contain what was painted, so nothing clips and no scrollbar can appear.
    it("grows #root to the measured extent so the body box contains it", () => {
      expect(source).toMatch(/style\.minHeight\s*=/);
      expect(source).toMatch(/style\.minWidth\s*=/);
    });

    it("resets the applied extent before re-measuring, so a widget can shrink", () => {
      // Without the reset, scrollWidth/scrollHeight read back the previously
      // applied min-size and the frame could only ever grow.
      expect(source).toMatch(/style\.minHeight\s*=\s*""/);
      expect(source).toMatch(/style\.minWidth\s*=\s*""/);
    });

    it("only re-posts a resize when the measured size actually changed", () => {
      // Applying the min-size resizes #root, which fires the in-frame
      // ResizeObserver: without this guard the frame would ping-pong.
      expect(source).toMatch(/lastPosted|lastWidth|lastHeight/);
    });
  });
});
