import type { WorkbookData } from "@portalai/spreadsheet-parsing";

import { environment } from "../environment.js";
import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "workbook-cache" });

const KEY_PREFIX = "upload-session:";

function keyFor(uploadSessionId: string): string {
  return `${KEY_PREFIX}${uploadSessionId}`;
}

/**
 * Redis-backed cache for the parsed `WorkbookData`. Keyed by
 * `uploadSessionId`, TTL'd per `FILE_UPLOAD_CACHE_TTL_SEC`. Miss handling is
 * the caller's responsibility — the streaming pipeline re-streams from S3 +
 * re-parses on miss, which is transparent to the client.
 */
export const WorkbookCacheService = {
  async set(uploadSessionId: string, workbook: WorkbookData): Promise<void> {
    const redis = getRedisClient();
    const payload = JSON.stringify(workbook);
    await redis.set(
      keyFor(uploadSessionId),
      payload,
      "EX",
      environment.FILE_UPLOAD_CACHE_TTL_SEC
    );
    logger.debug(
      {
        uploadSessionId,
        sheetCount: workbook.sheets.length,
        bytes: payload.length,
      },
      "Cached parsed workbook"
    );
  },

  async get(uploadSessionId: string): Promise<WorkbookData | null> {
    const redis = getRedisClient();
    const payload = await redis.get(keyFor(uploadSessionId));
    if (!payload) {
      logger.debug({ uploadSessionId, event: "cache.miss" }, "cache miss");
      return null;
    }
    try {
      return JSON.parse(payload) as WorkbookData;
    } catch (err) {
      logger.warn(
        { uploadSessionId, err: err instanceof Error ? err.message : err },
        "Cached workbook failed JSON.parse — evicting"
      );
      await redis.del(keyFor(uploadSessionId));
      return null;
    }
  },

  async delete(uploadSessionId: string): Promise<void> {
    const redis = getRedisClient();
    await redis.del(keyFor(uploadSessionId));
  },
};
