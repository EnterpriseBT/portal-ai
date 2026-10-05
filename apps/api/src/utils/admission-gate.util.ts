/**
 * Bounded, per-key-fair admission control for expensive per-request work
 * (#698). Unlike `pLimit` (unbounded queue, no timeout, no abort), a gate
 * turns overload into a fast typed rejection instead of an ever-growing queue:
 *
 *   - at most `concurrency` holders run at once (process-wide);
 *   - at most `perKeyLimit` of them share one key (an org), so one tenant
 *     can't take every slot — a waiter whose key is capped is skipped in
 *     favour of the next waiter, and is admitted when its own key frees;
 *   - at most `maxQueue` waiters; beyond that a caller is rejected
 *     `queue_full` immediately;
 *   - a waiter not admitted within `maxWaitMs` is rejected `timeout`;
 *   - a waiter whose `signal` aborts is removed and rejected `aborted`.
 *
 * Aborting a *holder* does not release its slot early — the slot tracks the
 * work actually running, and `fn` owns cancelling that work. In-memory and
 * per-process by design: the resource a gate protects (a process's DB pool)
 * is itself per-process.
 */

export interface AdmissionGateOptions {
  /** Max holders at once. */
  concurrency: number;
  /** Max waiters; a caller beyond this is rejected `queue_full`. */
  maxQueue: number;
  /** A waiter not admitted within this is rejected `timeout`. */
  maxWaitMs: number;
  /** Max concurrent holders sharing one key. */
  perKeyLimit: number;
}

export type GateRejectReason = "queue_full" | "timeout" | "aborted";

export class GateRejectedError extends Error {
  constructor(readonly reason: GateRejectReason) {
    super(`admission rejected: ${reason}`);
    this.name = "GateRejectedError";
  }
}

interface Waiter {
  key: string;
  admit: () => void;
  reject: (err: GateRejectedError) => void;
}

export class AdmissionGate {
  private active = 0;
  private readonly activeByKey = new Map<string, number>();
  private readonly queue: Waiter[] = [];

  constructor(private readonly opts: AdmissionGateOptions) {}

  /** Run `fn` holding one slot for `key`; the slot is released when `fn`
   *  settles. Rejects with {@link GateRejectedError} if never admitted. */
  async run<T>(
    key: string,
    signal: AbortSignal | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    if (signal?.aborted) throw new GateRejectedError("aborted");
    if (this.canAdmit(key)) {
      this.acquire(key);
    } else {
      if (this.queue.length >= this.opts.maxQueue) {
        throw new GateRejectedError("queue_full");
      }
      await this.wait(key, signal);
    }
    try {
      return await fn();
    } finally {
      this.release(key);
    }
  }

  stats(): {
    active: number;
    queued: number;
    activeByKey: Record<string, number>;
  } {
    return {
      active: this.active,
      queued: this.queue.length,
      activeByKey: Object.fromEntries(this.activeByKey),
    };
  }

  private canAdmit(key: string): boolean {
    return (
      this.active < this.opts.concurrency &&
      (this.activeByKey.get(key) ?? 0) < this.opts.perKeyLimit
    );
  }

  private acquire(key: string): void {
    this.active++;
    this.activeByKey.set(key, (this.activeByKey.get(key) ?? 0) + 1);
  }

  private release(key: string): void {
    this.active--;
    const n = (this.activeByKey.get(key) ?? 1) - 1;
    if (n <= 0) this.activeByKey.delete(key);
    else this.activeByKey.set(key, n);
    this.drain();
  }

  /** Admit queued waiters, in order, while slots allow — skipping (not
   *  dequeuing) a waiter whose key is at its per-key limit. */
  private drain(): void {
    for (let i = 0; i < this.queue.length; ) {
      if (this.active >= this.opts.concurrency) return;
      const waiter = this.queue[i];
      if (this.canAdmit(waiter.key)) {
        this.queue.splice(i, 1);
        this.acquire(waiter.key);
        waiter.admit();
      } else {
        i++;
      }
    }
  }

  private wait(key: string, signal: AbortSignal | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const leave = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const i = this.queue.indexOf(waiter);
        if (i !== -1) this.queue.splice(i, 1);
      };
      const waiter: Waiter = {
        key,
        admit: () => {
          // Already removed from the queue and counted by `drain`.
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve();
        },
        reject: (err) => {
          leave();
          reject(err);
        },
      };
      const onAbort = () => waiter.reject(new GateRejectedError("aborted"));
      const timer = setTimeout(
        () => waiter.reject(new GateRejectedError("timeout")),
        this.opts.maxWaitMs
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
    });
  }
}
