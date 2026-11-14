import { TOAST_ANCHOR } from "../utils/toast.constants";
import { toastStackEdge } from "../utils/toast-placement.util";

// #1024: the stack steps aside for focus (WCAG 2.4.11). Viewport 1280×720,
// stack 400×200 at 24 px from the bottom-right corner, so at the bottom it
// spans x 856–1256, y 496–696.
const viewport = { width: 1280, height: 720 };
const stack = { width: 400, height: 200 };
const INSET = 24;
const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("toastStackEdge", () => {
  // Review: the geometry models a bottom-right stack. Moving the anchor
  // means changing the model too.
  it("models the anchor ToastHost renders from", () => {
    expect(TOAST_ANCHOR).toEqual({ vertical: "bottom", horizontal: "right" });
  });

  it("stays at the bottom when the focused box is clear of it", () => {
    expect(toastStackEdge(box(100, 600, 80, 30), stack, viewport, INSET)).toBe(
      "bottom"
    );
    expect(toastStackEdge(box(1000, 100, 80, 30), stack, viewport, INSET)).toBe(
      "bottom"
    );
  });

  it("moves to the top when the focused box would be under it", () => {
    expect(toastStackEdge(box(1100, 650, 32, 32), stack, viewport, INSET)).toBe(
      "top"
    );
  });

  it("moves for a partial overlap too", () => {
    // A row reaching into the stack's left edge.
    expect(toastStackEdge(box(100, 600, 800, 40), stack, viewport, INSET)).toBe(
      "top"
    );
  });

  it("treats touching edges as clear", () => {
    expect(toastStackEdge(box(100, 456, 756, 40), stack, viewport, INSET)).toBe(
      "bottom"
    );
  });

  it("stays at the bottom when the top wouldn't clear the box either", () => {
    // `main` after the skip link: as tall as the page.
    expect(toastStackEdge(box(0, 0, 1280, 720), stack, viewport, INSET)).toBe(
      "bottom"
    );
  });

  it("moves on a narrow viewport, where the stack is the full width", () => {
    const phone = { width: 390, height: 844 };
    const wide = { width: 342, height: 160 };
    expect(toastStackEdge(box(16, 700, 358, 48), wide, phone, INSET)).toBe(
      "top"
    );
  });

  it("stays at the bottom with nothing focused or nothing shown", () => {
    expect(toastStackEdge(null, stack, viewport, INSET)).toBe("bottom");
    expect(
      toastStackEdge(
        box(1100, 650, 32, 32),
        { width: 0, height: 0 },
        viewport,
        INSET
      )
    ).toBe("bottom");
  });
});
