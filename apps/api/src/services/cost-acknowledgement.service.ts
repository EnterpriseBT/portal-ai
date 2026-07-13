/**
 * Server-side enforcement of the bulk_transform expensive-tool
 * confirmation gate (#85 §4b).
 *
 * The agent's `acknowledgeCost: true` on `transform_entity_records`
 * is meaningless unless the user actually consented. Prompt
 * instructions to the agent — "ask first, wait for their reply, then
 * retry" — are unreliable; the agent has bypassed every version. This
 * service makes the gate server-enforced:
 *
 *  1. First call without `acknowledgeCost` against an expensive tool
 *     records a `pending` entry in Redis (TTL ~15 min) tagged with
 *     `(portalId, jobSignature, rejectedAt)`. Then rejects with
 *     `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED` as before.
 *  2. A subsequent call WITH `acknowledgeCost: true` is only accepted
 *     when (a) a pending entry exists for the same `(portalId,
 *     jobSignature)`, AND (b) the portal's most recent USER message
 *     timestamp is later than the entry's `rejectedAt`. That second
 *     check is the objective server-knowable signal that "the user
 *     spoke between the rejection and the retry."
 *
 * Signature scope: hashes (sourceConnectorEntityId,
 * targetConnectorEntityId, expression, keyField, batchSize). The agent
 * changing any of those parameters constitutes a different job and
 * needs fresh acknowledgement.
 */

import crypto from "node:crypto";

import { DbService } from "./db.service.js";
import { getRedisClient } from "../utils/redis.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "cost-acknowledgement-service" });

const REDIS_KEY_PREFIX = "cost-ack:";
const TTL_SECONDS = 15 * 60;

export interface CostAckSignatureInputs {
  sourceConnectorEntityId: string;
  targetConnectorEntityId: string;
  expression: unknown;
  keyField: string;
  batchSize: number;
}

/** Stable per-job hash. Same inputs → same hash; any change invalidates. */
export function computeJobSignature(inputs: CostAckSignatureInputs): string {
  const canonical = JSON.stringify({
    s: inputs.sourceConnectorEntityId,
    t: inputs.targetConnectorEntityId,
    e: inputs.expression,
    k: inputs.keyField,
    b: inputs.batchSize,
  });
  return crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Stable per-query hash for the `sql_query` job-tier escalation (#130
 * E1b). Scope is `(stationId, sql)` — the agent changing the SQL is a
 * different query and needs fresh acknowledgement. Feeds the same
 * `recordRejection` / `validate` reject→ack→retry flow as the bulk gate,
 * which is what "generalizes the cost-ack flow into the escalation
 * mechanism" (spec D8a) means in practice.
 */
export function computeSqlQuerySignature(inputs: {
  sql: string;
  stationId: string;
}): string {
  const canonical = JSON.stringify({ st: inputs.stationId, q: inputs.sql });
  return crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, 32);
}

function redisKey(portalId: string, signature: string): string {
  return `${REDIS_KEY_PREFIX}${portalId}:${signature}`;
}

export class CostAcknowledgementService {
  /**
   * Stash a pending acknowledgement for this portal + job signature.
   * Called from the tool's pre-flight when an expensive tool is
   * rejected without `acknowledgeCost`. The stored `rejectedAt` is
   * compared against the portal's latest user-message timestamp on
   * the retry.
   */
  static async recordRejection(
    portalId: string,
    signature: string,
    rejectedAt: number
  ): Promise<void> {
    const redis = getRedisClient();
    await redis.set(
      redisKey(portalId, signature),
      String(rejectedAt),
      "EX",
      TTL_SECONDS
    );
    logger.info({ portalId, signature, rejectedAt }, "Cost rejection recorded");
  }

  /**
   * Validate that `acknowledgeCost: true` is legitimate.
   *
   *   - "missing": no prior rejection on file (the agent set
   *     acknowledgeCost on a first attempt — bypass).
   *   - "stale": rejection on file but the user hasn't spoken since
   *     (the agent retried in the same turn as the rejection — bypass).
   *   - "ok": rejection on file AND user has sent a new message since.
   *     Clears the stored entry.
   */
  static async validate(
    portalId: string,
    signature: string
  ): Promise<{ ok: true } | { ok: false; reason: "missing" | "stale" }> {
    const redis = getRedisClient();
    const raw = await redis.get(redisKey(portalId, signature));
    if (raw === null) {
      return { ok: false, reason: "missing" };
    }
    const rejectedAt = Number(raw);
    const latestUserAt =
      await DbService.repository.portalMessages.latestUserMessageTimestamp(
        portalId
      );
    if (latestUserAt === null || latestUserAt <= rejectedAt) {
      return { ok: false, reason: "stale" };
    }
    // Consume the entry — fresh acknowledgement on every accepted retry.
    await redis.del(redisKey(portalId, signature));
    return { ok: true };
  }
}
