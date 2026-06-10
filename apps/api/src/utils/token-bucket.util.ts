/**
 * Tiny token-bucket rate limiter (#85 Phase 4 slice 0).
 *
 * Pre-loads `ratePerSec` tokens; each `acquire()` resolves when a
 * token's available. Refills the bucket every 1s by `ratePerSec`
 * tokens up to the cap. Used by the bulk-transform dispatcher to
 * cap total throughput against tools that wrap metered APIs.
 *
 * No dependencies; runs on a single `setInterval`. Call `destroy()`
 * to release the timer when the bucket goes out of scope.
 */
export class TokenBucket {
  private tokens: number;
  private readonly cap: number;
  private readonly interval: NodeJS.Timeout | null;
  private waiters: Array<() => void> = [];

  constructor(opts: { ratePerSec: number }) {
    if (!Number.isFinite(opts.ratePerSec) || opts.ratePerSec <= 0) {
      throw new Error(
        `TokenBucket: ratePerSec must be a positive finite number; got ${opts.ratePerSec}`
      );
    }
    this.cap = opts.ratePerSec;
    this.tokens = opts.ratePerSec;
    this.interval = setInterval(() => {
      this.tokens = Math.min(this.cap, this.tokens + this.cap);
      // Wake up to `tokens` waiters.
      while (this.waiters.length > 0 && this.tokens > 0) {
        const next = this.waiters.shift();
        if (!next) break;
        this.tokens -= 1;
        next();
      }
    }, 1_000);
  }

  /**
   * Resolves when a token becomes available. If a token is in the
   * bucket, resolves synchronously (well, in microtask order); else
   * queues until the next refill interval.
   */
  acquire(): Promise<void> {
    if (this.tokens > 0) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  destroy(): void {
    if (this.interval) clearInterval(this.interval);
    // Resolve any pending waiters so callers don't hang.
    while (this.waiters.length > 0) {
      const next = this.waiters.shift();
      next?.();
    }
  }
}
