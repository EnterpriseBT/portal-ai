import React, { useEffect } from "react";

import { render, screen, act } from "./test-utils";
import { useToast } from "../utils/toast.context";
import type { ToastApi } from "../utils/toast.context";

// #293 slice 4: the provider joins the app chain AND the shared test harness.
//
// The harness half is load-bearing, not convenience: without it, a migrated
// view's `toast.error(...)` silently no-ops (by design — see the fail-open
// rule), so slice 5's migration assertions would pass while proving nothing.

const Probe: React.FC<{ onApi: (api: ToastApi) => void }> = ({ onApi }) => {
  const toast = useToast();
  useEffect(() => {
    onApi(toast);
  }, [toast, onApi]);
  return null;
};

describe("shared test harness — toast provider", () => {
  it("gives components a REAL toast API, not the no-op fallback", () => {
    let api: ToastApi | null = null;
    render(
      <Probe
        onApi={(next) => {
          api = next;
        }}
      />
    );
    expect(api).not.toBeNull();

    // The distinguishing check: a no-op API renders nothing, a real one shows
    // the toast. Everything slice 5 asserts depends on this being real.
    // Raising is a state update, so it must be flushed inside `act`.
    const live = api as unknown as ToastApi;
    act(() => {
      live.error("Something failed");
    });
    expect(screen.getByTestId("toast-error")).toHaveTextContent(
      "Something failed"
    );
  });

  it("renders no toast surface when nothing has been raised", () => {
    // Mounted in every test, so an idle host must be invisible — this is what
    // keeps the mount from perturbing unrelated suites and snapshots.
    const { container } = render(<div data-testid="plain">nothing</div>);
    expect(screen.getByTestId("plain")).toBeInTheDocument();
    expect(container.querySelector('[data-testid="toast-host"]')).toBeNull();
    expect(document.querySelector('[data-testid="toast-host"]')).toBeNull();
  });
});
