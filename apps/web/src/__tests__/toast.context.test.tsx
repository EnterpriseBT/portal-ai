import React from "react";

import { render } from "./test-utils";
import { useToast } from "../utils/toast.context";
import {
  TOAST_ANCHOR,
  TOAST_AUTO_HIDE_MS,
  TOAST_MAX_VISIBLE,
  TOAST_QUEUE_CAP,
} from "../utils/toast.constants";

// #293 slice 1: the constants are a contract (the per-severity asymmetry in
// particular), and `useToast()` must be a silent no-op with no provider —
// a missing toast may never break the feature that raised it.

describe("toast constants", () => {
  it("never auto-hides an error, and does auto-hide everything else", () => {
    // The asymmetry is the contract, not an implementation detail: an error
    // is a long-lived occupant the user must dismiss.
    expect(TOAST_AUTO_HIDE_MS.error).toBeNull();
    expect(TOAST_AUTO_HIDE_MS.success).toBeGreaterThan(0);
    expect(TOAST_AUTO_HIDE_MS.info).toBeGreaterThan(0);
    expect(TOAST_AUTO_HIDE_MS.warning).toBeGreaterThan(0);
  });

  it("anchors bottom-right, clear of UpdateBanner's bottom-center", () => {
    expect(TOAST_ANCHOR).toEqual({ vertical: "bottom", horizontal: "right" });
  });

  it("bounds both the visible stack and the pending queue", () => {
    expect(TOAST_MAX_VISIBLE).toBe(3);
    expect(TOAST_QUEUE_CAP).toBeGreaterThan(TOAST_MAX_VISIBLE);
  });
});

describe("useToast — no provider (spec case 14)", () => {
  const Probe: React.FC = () => {
    const toast = useToast();
    // Every method, called during render: none may throw.
    toast.success("s");
    toast.info("i");
    toast.warning("w");
    toast.error("e");
    toast.show({ message: "m", severity: "info" });
    toast.dismiss("nope");
    toast.dismissAll();
    return <span data-testid="probe">rendered</span>;
  };

  it("no-ops instead of throwing, and renders nothing", () => {
    // Rendered WITHOUT ToastProvider — the fail-open path.
    const { container, getByTestId } = render(<Probe />);
    expect(getByTestId("probe")).toBeInTheDocument();
    // No toast surface appears from a no-op API.
    expect(container.querySelector('[data-testid="toast-host"]')).toBeNull();
  });

  it("returns a stable object across renders", () => {
    // A new object each render would break any consumer memoizing on it.
    const seen: unknown[] = [];
    const Capture: React.FC = () => {
      seen.push(useToast());
      return null;
    };
    const { rerender } = render(<Capture />);
    rerender(<Capture />);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });
});
