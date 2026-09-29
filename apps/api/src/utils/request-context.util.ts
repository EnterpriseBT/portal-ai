import { AsyncLocalStorage } from "node:async_hooks";
import type pino from "pino";

export interface RequestContext {
  log: pino.Logger;
  /** Per-request memo for correctness-neutral dedup of work that can't change
   *  within a single request (#647). Lazily created by {@link memoizeForRequest}. */
  memo?: Map<string, unknown>;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * Memoize `factory` for the lifetime of the current request, keyed by `key`
 * (#647). The resolved value is cached — a rejection is not, so a failed call
 * is retried by the next caller. With no request store (a job worker, a test),
 * this is a passthrough that just runs `factory`. Only use it for values that
 * cannot change within one request (e.g. a caller's resolved view grants).
 */
export async function memoizeForRequest<T>(
  key: string,
  factory: () => Promise<T>
): Promise<T> {
  const ctx = requestContext.getStore();
  if (!ctx) return factory();
  const memo = (ctx.memo ??= new Map<string, unknown>());
  if (memo.has(key)) return memo.get(key) as T;
  const value = await factory();
  memo.set(key, value);
  return value;
}
