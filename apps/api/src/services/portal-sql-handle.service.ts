/**
 * PortalSqlHandleService (#85 Phase 3 slice 0).
 *
 * Producer for the query-handle read path: runs an LLM-issued SELECT,
 * stages the result rows in Redis under a fresh `queryHandle`, and
 * broadcasts the rows to a per-handle Pub/Sub channel so the SSE route
 * (slice 1) can forward them to the UI.
 *
 * The agent's tool result carries the QueryHandleEnvelope from
 * `@portalai/core/contracts` (rowCount, schema, sampled, samplePeek).
 * The rows themselves never enter the agent's context window — the
 * UI fetches them via the SSE stream (live) or the snapshot endpoint
 * (re-open).
 *
 * Phase 3 slice 0 implementation: runs the SQL once via
 * `PortalSqlService.runSqlQuery` with the row cap lifted, then chunks
 * the result in memory. Cursor-driven streaming is a follow-up; this
 * shape exercises the surrounding pipeline (SSE + snapshot + cache
 * eviction) end-to-end.
 */

import { randomUUID } from "crypto";
import {
  READ_HANDLE_TTL_MS,
  SAMPLING_THRESHOLD,
} from "@portalai/core/constants";
// Inline the QueryHandleEnvelope type — the core barrel doesn't yet
// export portal-sql.contract directly. Shape mirrors Phase 1 spec.
interface QueryHandleEnvelope {
  queryHandle: string;
  rowCount: number;
  schema: Array<{ name: string; type: string }>;
  sampled: boolean;
  sampleSize?: number;
  truncated: boolean;
  samplePeek: Array<Record<string, unknown>>;
}

import { ApiCode } from "../constants/api-codes.constants.js";
import { ApiError } from "./http.service.js";
import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";
import { PortalSqlService } from "./portal-sql.service.js";

const logger = createLogger({ module: "portal-sql-handle" });

const HANDLE_PREFIX = "portal-sql:handle:";
const STREAM_CHANNEL_PREFIX = "portal-sql:stream:";
const BATCH_SIZE = 1_000;
const SAMPLE_PEEK_SIZE = 10;
const HANDLE_ROW_CAP = 100_000;

export interface ProduceOptions {
  stationId: string;
  organizationId: string;
  sql: string;
}

export interface SnapshotResult {
  rows: Array<Record<string, unknown>>;
  total: number;
  offset: number;
  limit: number;
}

/**
 * Channel + key derivation. Exposed so the route layer (slice 1) can
 * subscribe to the same channel the producer publishes to.
 */
export function streamChannelKey(handleId: string): string {
  return `${STREAM_CHANNEL_PREFIX}${handleId}`;
}
function metaKey(handleId: string): string {
  return `${HANDLE_PREFIX}${handleId}:meta`;
}
function batchKey(handleId: string, batchIndex: number): string {
  return `${HANDLE_PREFIX}${handleId}:batches:${batchIndex}`;
}

export class PortalSqlHandleService {
  /**
   * Run a SELECT and stage its rows in Redis under a fresh handle.
   * Returns the envelope synchronously; the broadcast loop fires
   * batches on the per-handle stream channel as it walks.
   *
   * Errors from the underlying SQL surface via the existing
   * PortalSqlService.runSqlQuery error envelope; this service
   * re-throws as ApiError so callers can branch.
   */
  static async produce(
    opts: ProduceOptions
  ): Promise<{ envelope: QueryHandleEnvelope }> {
    const handleId = `qh-${randomUUID()}`;
    const redis = getRedisClient();
    const channel = streamChannelKey(handleId);

    // Run the query through the existing pipeline. The handle path
    // uses a higher row cap; sampling for >SAMPLING_THRESHOLD rows is
    // applied to the envelope.
    const result = await PortalSqlService.runSqlQuery({
      stationId: opts.stationId,
      organizationId: opts.organizationId,
      sql: opts.sql,
      rowCap: HANDLE_ROW_CAP,
    });

    // The three response shapes:
    //   1. { rows }                          → normal
    //   2. { rows, truncated, totalCount }   → row cap hit
    //   3. { sample, truncated, totalCount } → payload-too-large collapse
    // Phase 3's handle path lifts the row cap, so shape 2 only fires
    // for queries past HANDLE_ROW_CAP rows. Shape 3 is preserved by
    // PortalSqlService; we surface it as a typed error here since the
    // handle is supposed to remove the payload-cap pressure.
    let rowsRaw: Array<Record<string, unknown>>;
    let totalCount: number;
    if ("sample" in result) {
      // PortalSqlService collapsed the result past the payload cap.
      // Phase 3's handle path is meant to dodge this; if we still trip,
      // the SQL needs to aggregate further.
      throw new ApiError(
        413,
        ApiCode.REQUEST_PAYLOAD_TOO_LARGE,
        "Result exceeded the payload cap before handle staging"
      );
    }
    rowsRaw = result.rows;
    totalCount =
      "totalCount" in result ? result.totalCount ?? rowsRaw.length : rowsRaw.length;

    const sampled = totalCount > SAMPLING_THRESHOLD;
    const sampleSize = sampled
      ? Math.min(rowsRaw.length, SAMPLING_THRESHOLD)
      : undefined;

    // Schema: derive from the first row's keys + value types.
    const firstRow = rowsRaw[0] as Record<string, unknown> | undefined;
    const schema = firstRow
      ? Object.keys(firstRow).map((name) => ({
          name,
          type: detectPgType(firstRow[name]),
        }))
      : [];

    const samplePeek = rowsRaw.slice(0, SAMPLE_PEEK_SIZE) as Array<
      Record<string, unknown>
    >;

    const envelope: QueryHandleEnvelope = {
      queryHandle: handleId,
      rowCount: totalCount,
      schema,
      sampled,
      ...(sampleSize ? { sampleSize } : {}),
      truncated: rowsRaw.length < totalCount,
      samplePeek,
    };

    // Stage batches in Redis + broadcast.
    const ttlSeconds = Math.ceil(READ_HANDLE_TTL_MS / 1000);
    await redis.set(
      metaKey(handleId),
      JSON.stringify(envelope),
      "EX",
      ttlSeconds
    );

    for (let i = 0; i < rowsRaw.length; i += BATCH_SIZE) {
      const batchIndex = Math.floor(i / BATCH_SIZE);
      const batch = rowsRaw.slice(i, i + BATCH_SIZE) as Array<
        Record<string, unknown>
      >;
      await redis.set(
        batchKey(handleId, batchIndex),
        JSON.stringify(batch),
        "EX",
        ttlSeconds
      );
      await redis.publish(
        channel,
        JSON.stringify({
          type: "data",
          batchIndex,
          rows: batch,
        })
      );
    }

    await redis.publish(channel, JSON.stringify({ type: "complete" }));

    logger.info(
      {
        handleId,
        stationId: opts.stationId,
        rowCount: totalCount,
        batches: Math.ceil(rowsRaw.length / BATCH_SIZE),
      },
      "portal-sql handle produced"
    );

    return { envelope };
  }

  /**
   * Read a paged window of cached rows from Redis. Returns
   * READ_HANDLE_EXPIRED via ApiError when the handle's meta key is
   * missing (TTL expired or never produced).
   */
  static async getSnapshot(
    handleId: string,
    range: { offset?: number; limit?: number }
  ): Promise<SnapshotResult> {
    const redis = getRedisClient();
    const metaRaw = await redis.get(metaKey(handleId));
    if (!metaRaw) {
      throw new ApiError(
        404,
        ApiCode.READ_HANDLE_EXPIRED,
        "Query handle has expired or does not exist"
      );
    }
    const envelope = JSON.parse(metaRaw) as QueryHandleEnvelope;
    const offset = range.offset ?? 0;
    const limit = Math.min(range.limit ?? BATCH_SIZE, 5_000);

    const out: Array<Record<string, unknown>> = [];
    const startBatch = Math.floor(offset / BATCH_SIZE);
    for (
      let batchIndex = startBatch;
      out.length < limit && batchIndex * BATCH_SIZE < envelope.rowCount;
      batchIndex++
    ) {
      const batchRaw = await redis.get(batchKey(handleId, batchIndex));
      if (!batchRaw) break;
      const batch = JSON.parse(batchRaw) as Array<Record<string, unknown>>;
      const startInBatch =
        batchIndex === startBatch ? offset - startBatch * BATCH_SIZE : 0;
      for (let i = startInBatch; i < batch.length && out.length < limit; i++) {
        out.push(batch[i]);
      }
    }

    return { rows: out, total: envelope.rowCount, offset, limit };
  }
}

/**
 * Best-effort PG type detection from a sample value. The agent uses
 * `schema[].type` as a hint, not a strong contract — PG sends raw
 * values without column type info via postgres-js's row format.
 */
function detectPgType(value: unknown): string {
  if (value == null) return "unknown";
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "numeric";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "string") return "text";
  if (value instanceof Date) return "timestamptz";
  return "jsonb";
}
