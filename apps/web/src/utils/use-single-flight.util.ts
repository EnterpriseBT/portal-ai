import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * #751: wrap an async action so a call while a previous one is still running
 * returns that run's promise instead of starting another. For workflow
 * actions that chain several requests (a direct upload, a loop of creates):
 * `useAuthMutation` already drops a duplicate *request*, but a duplicate
 * *run* would still repeat the steps it can't see.
 *
 * The wrapper is stable across renders and always invokes the latest `fn`, so
 * callers keep their existing dependencies. Run tokens, where a workflow has
 * them, still discard a superseded run's result; this only stops a
 * concurrent duplicate from starting.
 */
export function useSingleFlight<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  const fnRef = useRef(fn);
  // A layout effect, not a render-time write: it runs after each commit,
  // before any later input.
  useLayoutEffect(() => {
    fnRef.current = fn;
  });

  const running = useRef<Promise<TResult> | null>(null);

  return useCallback((...args: TArgs) => {
    if (running.current) return running.current;
    const run = fnRef.current(...args).finally(() => {
      if (running.current === run) running.current = null;
    });
    running.current = run;
    return run;
  }, []);
}
