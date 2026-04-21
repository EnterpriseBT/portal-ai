/**
 * Tiny concurrency-limited scheduler. Caps the number of in-flight tasks at
 * `max` and queues the rest, running them as slots free up. Resolves (or
 * rejects) in whatever order the underlying tasks settle — callers that need
 * stable ordering should index results via `Promise.all(inputs.map(schedule))`
 * rather than relying on resolution order.
 *
 * Kept inline instead of pulling in `p-limit` so the parser package has zero
 * runtime dependencies. Allocation-wise this costs one closure per `pLimit()`
 * call — fine since every `interpret()` run creates one and discards it.
 */
export function pLimit(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  if (max < 1 || !Number.isFinite(max)) {
    throw new Error(`pLimit: max must be a positive finite number, got ${max}`);
  }
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    const run = queue.shift();
    if (run) run();
  };

  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(
          (value) => {
            active--;
            resolve(value);
            next();
          },
          (err) => {
            active--;
            reject(err);
            next();
          }
        );
      };
      if (active < max) run();
      else queue.push(run);
    });
  };
}
