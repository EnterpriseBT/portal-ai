import type { MergedRange } from "@portalai/spreadsheet-parsing";

import { environment } from "../environment.js";
import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "workbook-cache" });

/**
 * Redis-backed chunked cache for parsed workbooks, TTL'd per
 * `FILE_UPLOAD_CACHE_TTL_SEC`. Streaming writer + chunk readers — bounded
 * memory regardless of total workbook size.
 *
 * Layout (see `docs/LARGE_FILE_PARSE_STREAMING.plan.md`):
 *
 *   {prefix}:meta                                 — JSON SessionMeta
 *   {prefix}:sheet:{sheetId}:rows:{chunkIdx}      — JSON dense row chunk
 *   {prefix}:sheet:{sheetId}:merges               — JSON MergedRange[]
 *
 * Callers own the prefix:
 *   - `upload-session:{id}`           — file-upload pipeline
 *   - `connector:wb:<slug>:{id}`      — google-sheets, microsoft-excel
 *     (see `utils/connector-cache-keys.util.ts`)
 */

// ── Streaming chunked cache ────────────────────────────────────────────────

export interface SheetChunkMeta {
  sheetId: string;
  name: string;
  rowCount: number;
  colCount: number;
  hasMerges?: boolean;
}

export interface SessionMeta {
  sheets: SheetChunkMeta[];
  status: "parsing" | "ready" | "failed";
  error?: string;
  createdAt: number;
}

/** Cell shape stored in row chunks. Dates serialize to ISO strings via JSON. */
export type ChunkCell = string | number | boolean | null;
export type ChunkRow = ChunkCell[];

const TTL = () => environment.FILE_UPLOAD_CACHE_TTL_SEC;
const ROWS_PER_CHUNK = () => environment.FILE_UPLOAD_CACHE_ROWS_PER_CHUNK;

function metaKey(prefix: string): string {
  return `${prefix}:meta`;
}
function rowsKey(prefix: string, sheetId: string, chunkIdx: number): string {
  return `${prefix}:sheet:${sheetId}:rows:${chunkIdx}`;
}
function mergesKey(prefix: string, sheetId: string): string {
  return `${prefix}:sheet:${sheetId}:merges`;
}

/**
 * Buffered writer returned by `beginSession`. The caller streams rows in for
 * each sheet; once a sheet's buffer reaches `ROWS_PER_CHUNK` the writer
 * flushes to Redis and discards the rows. Memory at any moment is bounded
 * by `ROWS_PER_CHUNK × maxColCount × avgCellBytes` (~a few MB per sheet).
 */
export interface SessionWriter {
  /** Append rows to a sheet. Buffers internally; flushes when full. */
  appendRows(sheetId: string, rows: ChunkRow[]): Promise<void>;
  /** Flush any tail buffer + write merges side-table. Call once per sheet. */
  finishSheet(
    sheetId: string,
    info: {
      name: string;
      rowCount: number;
      colCount: number;
      merges?: MergedRange[];
    }
  ): Promise<void>;
  /** Write the final session-meta key. Call once after every sheet finished. */
  finalize(status: "ready"): Promise<void>;
  /** Mark the session failed (does not delete partial chunks). */
  fail(error: string): Promise<void>;
}

interface SheetState {
  name: string;
  buffer: ChunkRow[];
  /** Index of the next chunk to write — i.e., how many chunks already flushed. */
  nextChunkIdx: number;
  /** Final stats; populated by finishSheet. */
  rowCount?: number;
  colCount?: number;
  hasMerges?: boolean;
}

export const WorkbookCacheService = {
  // ── Streaming chunked API ────────────────────────────────────────────────

  /**
   * Open a new chunked session under `prefix`. Writes a `parsing` meta
   * record so concurrent readers see the session in progress.
   */
  async beginSession(prefix: string): Promise<SessionWriter> {
    const redis = getRedisClient();
    const initialMeta: SessionMeta = {
      sheets: [],
      status: "parsing",
      createdAt: Date.now(),
    };
    await redis.set(metaKey(prefix), JSON.stringify(initialMeta), "EX", TTL());

    const sheets = new Map<string, SheetState>();
    const finishedSheets: SheetChunkMeta[] = [];

    const flushChunk = async (sheetId: string): Promise<void> => {
      const state = sheets.get(sheetId);
      if (!state || state.buffer.length === 0) return;
      const idx = state.nextChunkIdx;
      const payload = JSON.stringify(state.buffer);
      await redis.set(rowsKey(prefix, sheetId, idx), payload, "EX", TTL());
      state.buffer = [];
      state.nextChunkIdx = idx + 1;
    };

    return {
      async appendRows(sheetId, rows) {
        let state = sheets.get(sheetId);
        if (!state) {
          state = { name: sheetId, buffer: [], nextChunkIdx: 0 };
          sheets.set(sheetId, state);
        }
        for (const row of rows) {
          state.buffer.push(row);
          if (state.buffer.length >= ROWS_PER_CHUNK()) {
            await flushChunk(sheetId);
          }
        }
      },
      async finishSheet(sheetId, info) {
        await flushChunk(sheetId);
        const state = sheets.get(sheetId) ?? {
          name: info.name,
          buffer: [],
          nextChunkIdx: 0,
        };
        state.name = info.name;
        state.rowCount = info.rowCount;
        state.colCount = info.colCount;
        state.hasMerges = !!(info.merges && info.merges.length > 0);
        sheets.set(sheetId, state);

        if (info.merges && info.merges.length > 0) {
          await redis.set(
            mergesKey(prefix, sheetId),
            JSON.stringify(info.merges),
            "EX",
            TTL()
          );
        }

        finishedSheets.push({
          sheetId,
          name: info.name,
          rowCount: info.rowCount,
          colCount: info.colCount,
          hasMerges: state.hasMerges,
        });
      },
      async finalize(status) {
        const meta: SessionMeta = {
          sheets: finishedSheets,
          status,
          createdAt: Date.now(),
        };
        await redis.set(metaKey(prefix), JSON.stringify(meta), "EX", TTL());
        logger.debug(
          {
            prefix,
            sheetCount: finishedSheets.length,
            totalRows: finishedSheets.reduce((a, s) => a + s.rowCount, 0),
            event: "cache.session.finalize",
          },
          "Session finalized"
        );
      },
      async fail(error) {
        const meta: SessionMeta = {
          sheets: finishedSheets,
          status: "failed",
          error,
          createdAt: Date.now(),
        };
        await redis.set(metaKey(prefix), JSON.stringify(meta), "EX", TTL());
      },
    };
  },

  /** Read the session metadata. Null when the session does not exist. */
  async getSessionMeta(prefix: string): Promise<SessionMeta | null> {
    const redis = getRedisClient();
    const payload = await redis.get(metaKey(prefix));
    if (!payload) return null;
    try {
      return JSON.parse(payload) as SessionMeta;
    } catch (err) {
      logger.warn(
        { prefix, err: err instanceof Error ? err.message : err },
        "Session meta failed JSON.parse — evicting"
      );
      await redis.del(metaKey(prefix));
      return null;
    }
  },

  /**
   * Read a row range `[rowStart, rowEnd)` (0-indexed) from a sheet. Yields
   * one row at a time and pulls only the chunks that intersect the range.
   * Chunks within the range are fetched in a single MGET pipeline.
   */
  async *readRows(
    prefix: string,
    sheetId: string,
    rowStart: number,
    rowEnd: number
  ): AsyncIterable<ChunkRow> {
    if (rowEnd <= rowStart) return;
    const redis = getRedisClient();
    const chunkSize = ROWS_PER_CHUNK();
    const firstChunk = Math.floor(rowStart / chunkSize);
    const lastChunk = Math.floor((rowEnd - 1) / chunkSize);
    const keys: string[] = [];
    for (let c = firstChunk; c <= lastChunk; c++) {
      keys.push(rowsKey(prefix, sheetId, c));
    }
    const payloads =
      keys.length === 1
        ? [await redis.get(keys[0]!)]
        : await redis.mget(...keys);
    for (let i = 0; i < payloads.length; i++) {
      const payload = payloads[i];
      if (!payload) continue; // sparse / cache-miss within range — skip silently
      const chunkRows = JSON.parse(payload) as ChunkRow[];
      const chunkIdx = firstChunk + i;
      const chunkRowStart = chunkIdx * chunkSize;
      for (let r = 0; r < chunkRows.length; r++) {
        const absoluteRow = chunkRowStart + r;
        if (absoluteRow < rowStart) continue;
        if (absoluteRow >= rowEnd) return;
        yield chunkRows[r]!;
      }
    }
  },

  /** Read merged-cell metadata for a sheet (XLSX). Empty for CSV. */
  async getMerges(prefix: string, sheetId: string): Promise<MergedRange[]> {
    const redis = getRedisClient();
    const payload = await redis.get(mergesKey(prefix, sheetId));
    if (!payload) return [];
    try {
      return JSON.parse(payload) as MergedRange[];
    } catch {
      return [];
    }
  },

  /**
   * Hard-delete a session: meta + every per-sheet chunk + merges. Uses
   * SCAN under the prefix so we don't need a separate manifest of keys.
   */
  async deleteSession(prefix: string): Promise<void> {
    const redis = getRedisClient();
    const stream = redis.scanStream({ match: `${prefix}:*`, count: 200 });
    const toDelete: string[] = [];
    for await (const batch of stream) {
      const keys = batch as string[];
      if (keys.length > 0) toDelete.push(...keys);
    }
    if (toDelete.length === 0) return;
    // Batch deletes so a single command doesn't carry thousands of keys.
    for (let i = 0; i < toDelete.length; i += 256) {
      await redis.del(...toDelete.slice(i, i + 256));
    }
  },
};

// The legacy single-blob `set/get/delete(cacheKey, WorkbookData)` API was
// removed in Phase 4; all three pipelines (file-upload, google-sheets,
// microsoft-excel) now use the chunked `beginSession` / `readRows` API
// above. See `docs/LARGE_FILE_PARSE_STREAMING.plan.md` §Phase 4.
