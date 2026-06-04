/**
 * Per-batch tool-dispatch fan-out for the bulk_transform processor
 * (#85 Phase 4 slice 0).
 *
 * Invoked by the bulk-transform processor when `expression.kind ===
 * "tool"`. For each source row in the batch, build the tool input
 * (merge static args with the source row's keyField value), invoke
 * the tool with bounded concurrency + optional rate limit + per-call
 * timeout, and collect success / failure tuples.
 *
 * No DB I/O here — the processor handles per-batch UPSERT against the
 * target wide table using the dispatcher's `successes[]`. This module
 * is pure compute, mock-friendly via the injected `toolExecutor`.
 */

import { pLimit } from "../../adapters/rest-api/p-limit.util.js";
import { TokenBucket } from "../../utils/token-bucket.util.js";

export interface BulkDispatchMetadata {
  /** Max concurrent in-flight invocations per batch. */
  maxConcurrency: number;
  /** Per-call wall-clock budget. Calls past this reject as failures. */
  timeoutMs: number;
  /** Optional token-bucket rate cap across all in-flight calls. */
  ratePerSec?: number;
  /** Documents whether retrying a failed call is safe (advisory). */
  idempotent?: boolean;
  /** Used by the route's ETA pre-flight (Phase 4 slice 2). */
  estimatedMsPerCall?: number;
  /** Drives the cost-acknowledgement gate at the tool route. */
  costHint?: "free" | "metered" | "expensive";
}

export interface DispatchOptions {
  toolMetadata: BulkDispatchMetadata;
  /** Static args from `expression.args` merged into every per-record input. */
  staticArgs?: Record<string, unknown>;
  /** Wide-column name on the source whose value seeds `sourceKey` for the
   *  upsert + the per-record input. */
  keyField: string;
  /** Committed batch of source rows. */
  batch: Array<Record<string, unknown>>;
  /** Closed-over Tool.execute. Tests pass a stub; production passes the
   *  resolved tool from `ToolService.lookupBulkDispatchable`. */
  toolExecutor: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface DispatchSuccess {
  sourceKey: string;
  value: Record<string, unknown>;
}

export interface DispatchFailure {
  sourceKey: string;
  error: {
    code: string;
    message: string;
    recommendation?: string;
  };
}

export interface DispatchResult {
  successes: DispatchSuccess[];
  failures: DispatchFailure[];
  batchDurationMs: number;
}

/**
 * Wrap a promise with a wall-clock timeout. Rejects with a tagged
 * error so the caller can branch on `error.code`.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(
        Object.assign(new Error(`Call timed out after ${ms}ms`), {
          code: "BULK_DISPATCH_CALL_TIMEOUT",
        })
      );
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function dispatchBatch(
  opts: DispatchOptions
): Promise<DispatchResult> {
  const start = Date.now();
  const limit = pLimit(opts.toolMetadata.maxConcurrency);
  const bucket = opts.toolMetadata.ratePerSec
    ? new TokenBucket({ ratePerSec: opts.toolMetadata.ratePerSec })
    : null;

  const successes: DispatchSuccess[] = [];
  const failures: DispatchFailure[] = [];

  const results = await Promise.allSettled(
    opts.batch.map((row) => {
      const sourceKey = String(row[opts.keyField] ?? "");
      return limit(async () => {
        if (bucket) await bucket.acquire();
        const input = {
          ...(opts.staticArgs ?? {}),
          sourceKey,
          sourceRow: row,
        };
        try {
          const value = (await withTimeout(
            opts.toolExecutor(input),
            opts.toolMetadata.timeoutMs
          )) as Record<string, unknown>;
          return { kind: "ok" as const, sourceKey, value };
        } catch (err) {
          const code = (err as { code?: string }).code ?? "BULK_DISPATCH_CALL_FAILED";
          const message = err instanceof Error ? err.message : String(err);
          return {
            kind: "err" as const,
            sourceKey,
            error: { code, message },
          };
        }
      });
    })
  );

  if (bucket) bucket.destroy();

  for (const r of results) {
    if (r.status === "fulfilled") {
      const v = r.value;
      if (v.kind === "ok") {
        successes.push({ sourceKey: v.sourceKey, value: v.value });
      } else {
        failures.push({ sourceKey: v.sourceKey, error: v.error });
      }
    } else {
      // pLimit shouldn't reject (we catch inside the closure) but
      // guard so an unexpected throw still surfaces.
      failures.push({
        sourceKey: "<unknown>",
        error: {
          code: "BULK_DISPATCH_CALL_FAILED",
          message:
            r.reason instanceof Error ? r.reason.message : String(r.reason),
        },
      });
    }
  }

  return { successes, failures, batchDurationMs: Date.now() - start };
}
