import { resolveFrameSize } from "../widget-sizing.util";

// #278: available width in, painted extent out, vertical fit invariant.
// The host supplies the width it has; the frame reports what it painted;
// this rule reconciles the two. Height is never clamped — the widget always
// fits its entire visualization and never scrolls vertically, in any host.

const FALLBACK_HEIGHT = 360;

describe("resolveFrameSize — width", () => {
  it("uses the container width when the content is narrower", () => {
    expect(
      resolveFrameSize({
        contentWidth: 400,
        contentHeight: 300,
        containerWidth: 800,
        fallbackHeight: FALLBACK_HEIGHT,
      }).width
    ).toBe(800);
  });

  it("uses the content width when the content is wider — this is what scrolls", () => {
    // The wrapper's overflowX: auto can only engage if the frame exceeds it.
    expect(
      resolveFrameSize({
        contentWidth: 1_600,
        contentHeight: 300,
        containerWidth: 800,
        fallbackHeight: FALLBACK_HEIGHT,
      }).width
    ).toBe(1_600);
  });

  it("falls back to the container width when the frame reported none", () => {
    expect(
      resolveFrameSize({
        contentHeight: 300,
        containerWidth: 640,
        fallbackHeight: FALLBACK_HEIGHT,
      }).width
    ).toBe(640);
  });
});

describe("resolveFrameSize — height", () => {
  it("is always the painted height, never clamped to the container or fallback", () => {
    const tall = resolveFrameSize({
      contentWidth: 400,
      contentHeight: 2_400,
      containerWidth: 800,
      fallbackHeight: FALLBACK_HEIGHT,
    });
    expect(tall.height).toBe(2_400);

    const short = resolveFrameSize({
      contentWidth: 400,
      contentHeight: 80,
      containerWidth: 800,
      fallbackHeight: FALLBACK_HEIGHT,
    });
    expect(short.height).toBe(80);
  });

  it("uses the fallback height until the frame has reported one", () => {
    expect(
      resolveFrameSize({
        containerWidth: 800,
        fallbackHeight: FALLBACK_HEIGHT,
      }).height
    ).toBe(FALLBACK_HEIGHT);
  });
});

describe("resolveFrameSize — degenerate inputs", () => {
  it("never yields NaN or a non-positive size", () => {
    const cases = [
      { contentWidth: NaN, contentHeight: NaN, containerWidth: 800 },
      { contentWidth: 0, contentHeight: 0, containerWidth: 800 },
      { contentWidth: -50, contentHeight: -50, containerWidth: 800 },
      { contentWidth: Infinity, contentHeight: Infinity, containerWidth: 800 },
    ];
    for (const partial of cases) {
      const size = resolveFrameSize({
        ...partial,
        fallbackHeight: FALLBACK_HEIGHT,
      });
      expect(size.width).toBe(800);
      expect(size.height).toBe(FALLBACK_HEIGHT);
    }
  });

  it("survives a degenerate container width too (fails open, never zero)", () => {
    const size = resolveFrameSize({
      contentWidth: NaN,
      containerWidth: 0,
      fallbackHeight: FALLBACK_HEIGHT,
    });
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBe(FALLBACK_HEIGHT);
  });

  it("rounds fractional measurements up so nothing is a sub-pixel short", () => {
    const size = resolveFrameSize({
      contentWidth: 800.2,
      contentHeight: 300.4,
      containerWidth: 640,
      fallbackHeight: FALLBACK_HEIGHT,
    });
    expect(size.width).toBe(801);
    expect(size.height).toBe(301);
  });
});
