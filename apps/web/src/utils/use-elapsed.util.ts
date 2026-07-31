import { useState, useEffect } from "react";

/**
 * Whole seconds elapsed since `startedAt` (#279), re-rendering once a second.
 *
 * Returns 0 and registers no interval while `startedAt` is null, so an idle
 * portal session runs no timer at all. The clock restarts whenever
 * `startedAt` changes — a new tool step is a new measurement, not a
 * continuation of the previous one.
 *
 * `Date.now()` is read inside the interval callback rather than during render,
 * which is the same rule `streamStartedAt` follows in
 * `PortalSession.component.tsx`.
 *
 * Call this **once** per turn (in the container) and pass the number down, so
 * the display components stay pure and testable without timers.
 */
export function useElapsed(startedAt: number | null): number {
  // The effect subscribes to the clock; the elapsed value is *derived* during
  // render. Resetting via a setState in the effect body would work but
  // triggers a cascading render on every step change — deriving needs no
  // reset at all, because a `now` from a previous step is simply older than
  // the new `startedAt` and floors to 0.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (startedAt === null) return;

    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  if (startedAt === null || now === null || now <= startedAt) return 0;
  return Math.floor((now - startedAt) / 1000);
}
