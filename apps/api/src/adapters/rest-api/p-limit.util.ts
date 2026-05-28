/**
 * Tiny concurrency-limited scheduler — caps in-flight tasks at `max`.
 *
 * Same shape as `packages/spreadsheet-parsing/src/interpret/util/p-limit.ts`;
 * inlined here so the adapter doesn't reach across packages for a
 * 30-line utility. The classifier batches LLM calls at this limit so
 * a 50-column endpoint doesn't burst against the model's rate cap.
 */
export function pLimit(
  max: number
): <T>(fn: () => Promise<T>) => Promise<T> {
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
