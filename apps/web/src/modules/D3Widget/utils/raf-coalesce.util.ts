/**
 * Collapse a burst of calls into one per animation frame (#278).
 *
 * Responsive reflow is bursty even without manual resize handles: dragging a
 * window edge, opening a side panel, or rotating a device produces a run of
 * `ResizeObserver` ticks. Forwarding each one to the sandbox would cost a
 * postMessage, a full program re-invoke and a re-measure apiece — a
 * re-render storm over a 10k-row chart. The in-frame side already coalesces
 * its render passes through `requestAnimationFrame`; this is the parent-side
 * counterpart.
 *
 * Last value wins: an intermediate width during a drag is never the one the
 * program needs.
 */
export interface CoalescedFn<T> {
  (value: T): void;
  /** Drop a pending invocation (call on teardown). */
  cancel(): void;
}

export function rafCoalesce<T>(fn: (value: T) => void): CoalescedFn<T> {
  let handle: number | null = null;
  let pending: { value: T } | null = null;

  const coalesced = (value: T): void => {
    // Fail open: without rAF, invoke directly rather than silently dropping
    // resizes — a stale layout is worse than an uncoalesced one.
    if (typeof requestAnimationFrame !== "function") {
      fn(value);
      return;
    }

    pending = { value };
    if (handle !== null) return;

    handle = requestAnimationFrame(() => {
      handle = null;
      const next = pending;
      pending = null;
      if (next) fn(next.value);
    });
  };

  coalesced.cancel = (): void => {
    pending = null;
    if (handle !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle);
    }
    handle = null;
  };

  return coalesced;
}
