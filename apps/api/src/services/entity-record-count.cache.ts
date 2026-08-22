/**
 * Cached exact record counts for the entity-record list (#433).
 *
 * The list endpoint returns `total` so the toolbar can render "page N of M"
 * and enable the last-page jump. Computing it means counting every matching
 * row — an Index Only Scan over 283,000 index entries measured at **3,472ms**
 * on app-dev — and it was being recomputed on *every page request*. That is
 * the ~3.5s floor that remained after the sort index and the keyset seek made
 * the rows themselves cheap.
 *
 * The count is cached, never estimated. `total` is a number a user reads and
 * may quote; an approximation would need a "~" affordance in the toolbar and
 * would make the last-page jump land imprecisely. Caching keeps it exact and
 * moves the cost from per-page to per-filter-change.
 *
 * **Redis, not an in-process Map.** The API runs multiple ECS tasks; two
 * tasks must not report different totals for the same table.
 *
 * **Fail-open throughout.** A miss, an error, or an outage falls back to
 * computing the count — slow, never wrong. Nothing here gates safety or
 * spend, so there is no reason to fail closed. Every call is bounded by
 * `withRedisTimeout`, because an unreachable Redis otherwise *hangs* rather
 * than rejecting (see that module).
 *
 * **Invalidation** is a per-entity version counter rather than a key scan.
 * Bumping the version orphans every cached fingerprint for that entity in one
 * O(1) write, and the orphans expire on their own TTL. A `SCAN`-and-delete
 * would walk the whole keyspace.
 */

import { createHash } from "crypto";

import { getRedisClient } from "../utils/redis.util.js";
import { withRedisTimeout } from "../utils/redis-timeout.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "entity-record-count-cache" });

/**
 * How long a cached total may outlive a missed invalidation. Short enough
 * that a stale "page N of M" self-heals while the user is still looking at
 * it; long enough that paging through a table never recomputes.
 */
export const COUNT_CACHE_TTL_SECONDS = 60;

/** Inputs that change the *size* of a result set. */
export interface CountCacheScope {
  search?: string;
  filters?: string;
  isValid?: string;
}

export class EntityRecordCountCache {
  /**
   * Fingerprint the filters that change how many rows match.
   *
   * `sortBy`, `sortOrder`, `limit`, `offset` and `cursor` are deliberately
   * excluded: they reorder or window the result set without resizing it, so
   * including them would miss the cache on every page.
   */
  static fingerprint(scope: CountCacheScope): string {
    const canonical = JSON.stringify({
      search: scope.search ?? "",
      filters: scope.filters ?? "",
      isValid: scope.isValid ?? "",
    });
    return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
  }

  private static versionKey(connectorEntityId: string): string {
    return `erc:v:${connectorEntityId}`;
  }

  private static async currentVersion(
    connectorEntityId: string
  ): Promise<string> {
    const raw = await withRedisTimeout(
      getRedisClient().get(this.versionKey(connectorEntityId)),
      "GET count version"
    );
    return raw ?? "0";
  }

  private static countKey(
    connectorEntityId: string,
    version: string,
    fingerprint: string
  ): string {
    return `erc:${connectorEntityId}:${version}:${fingerprint}`;
  }

  /** Cached total, or `null` on a miss or any Redis trouble (fail open). */
  static async get(
    connectorEntityId: string,
    fingerprint: string
  ): Promise<number | null> {
    try {
      const version = await this.currentVersion(connectorEntityId);
      const raw = await withRedisTimeout(
        getRedisClient().get(
          this.countKey(connectorEntityId, version, fingerprint)
        ),
        "GET count"
      );
      if (raw === null) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Count cache read failed; falling back to a live count"
      );
      return null;
    }
  }

  /** Best-effort write. A failure is logged, never thrown. */
  static async set(
    connectorEntityId: string,
    fingerprint: string,
    total: number
  ): Promise<void> {
    try {
      const version = await this.currentVersion(connectorEntityId);
      await withRedisTimeout(
        getRedisClient().set(
          this.countKey(connectorEntityId, version, fingerprint),
          String(total),
          "EX",
          COUNT_CACHE_TTL_SECONDS
        ),
        "SET count"
      );
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Count cache write failed"
      );
    }
  }

  /**
   * Drop every cached total for an entity. Call from any path that changes
   * how many rows match — a row added or removed, or a validation status
   * flipped (`isValid` is part of the fingerprint).
   *
   * Best-effort: a failure leaves a stale total for at most the TTL, which is
   * a wrong page count, never wrong rows.
   */
  static async invalidate(connectorEntityId: string): Promise<void> {
    try {
      await withRedisTimeout(
        getRedisClient().incr(this.versionKey(connectorEntityId)),
        "INCR count version"
      );
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Count cache invalidation failed; stale totals expire via TTL"
      );
    }
  }
}
