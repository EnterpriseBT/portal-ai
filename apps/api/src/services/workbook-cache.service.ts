import type { WorkbookData } from "@portalai/spreadsheet-parsing";

import { environment } from "../environment.js";
import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "workbook-cache" });

/**
 * Redis-backed cache for parsed `WorkbookData`, TTL'd per
 * `FILE_UPLOAD_CACHE_TTL_SEC`. Callers own the cache key (and its
 * prefix) — `upload-session:{id}` for file-upload,
 * `connector:wb:<slug>:{id}` for OAuth-driven connectors (see
 * `utils/connector-cache-keys.util.ts`). Miss handling is the caller's
 * responsibility: parse-from-source-and-refill is transparent to the
 * client.
 */
export const WorkbookCacheService = {
  async set(cacheKey: string, workbook: WorkbookData): Promise<void> {
    const redis = getRedisClient();
    const payload = JSON.stringify(workbook);
    await redis.set(
      cacheKey,
      payload,
      "EX",
      environment.FILE_UPLOAD_CACHE_TTL_SEC
    );
    logger.debug(
      {
        cacheKey,
        sheetCount: workbook.sheets.length,
        bytes: payload.length,
      },
      "Cached parsed workbook"
    );
  },

  async get(cacheKey: string): Promise<WorkbookData | null> {
    const redis = getRedisClient();
    const payload = await redis.get(cacheKey);
    if (!payload) {
      logger.debug({ cacheKey, event: "cache.miss" }, "cache miss");
      return null;
    }
    try {
      return JSON.parse(payload) as WorkbookData;
    } catch (err) {
      logger.warn(
        { cacheKey, err: err instanceof Error ? err.message : err },
        "Cached workbook failed JSON.parse — evicting"
      );
      await redis.del(cacheKey);
      return null;
    }
  },

  async delete(cacheKey: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(cacheKey);
  },
};
