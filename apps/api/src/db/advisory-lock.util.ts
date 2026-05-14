/**
 * Postgres advisory-lock helper for serialising operations on a single
 * connector entity.
 *
 * The reconciler holds the lock around its DDL transaction; the sync
 * write path (phase 2) will hold the same lock around its bulk-upsert
 * transaction. Two callers acting on the same entity therefore queue
 * at the lock — one set of DDL or one set of writes runs at a time
 * per entity, while different entities run freely in parallel.
 *
 * The lock is `pg_advisory_xact_lock`: bound to the transaction, auto-
 * released on COMMIT or ROLLBACK. No explicit unlock path is required.
 */

import crypto from "node:crypto";
import { sql } from "drizzle-orm";

import type { db } from "./client.js";
import type { DbClient } from "./repositories/base.repository.js";

/**
 * Stable signed 64-bit integer derived from the entity id, suitable
 * for use as a Postgres advisory-lock key.
 *
 * Postgres advisory-lock keys are 64-bit signed ints. We take the
 * leading 8 bytes of SHA-256(entityId) and read them big-endian as
 * a signed bigint. Birthday-collision probability across realistic
 * entity counts is negligible.
 */
export function entityLockKey(connectorEntityId: string): bigint {
  const hash = crypto.createHash("sha256").update(connectorEntityId).digest();
  return hash.readBigInt64BE(0);
}

/**
 * Run `fn` inside a transaction that holds `pg_advisory_xact_lock`
 * keyed on `connectorEntityId`. The lock is released automatically
 * when the transaction commits or rolls back.
 *
 * Always opens a (root or savepoint) transaction — `pg_advisory_xact_lock`
 * is bound to the *current* transaction, so issuing it outside one
 * would auto-commit and release the lock immediately. Drizzle supports
 * nested transactions via savepoints, so passing an already-open tx as
 * `client` is fine; the inner BEGIN is recorded as a savepoint.
 *
 * @example
 *   await withEntityLock(db, entityId, async (tx) => {
 *     await reconciler.reconcileEntity(entityId, tx);
 *   });
 */
export async function withEntityLock<T>(
  client: DbClient,
  connectorEntityId: string,
  fn: (tx: DbClient) => Promise<T>
): Promise<T> {
  const key = entityLockKey(connectorEntityId);

  return await (client as typeof db).transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${key}::bigint)`);
    return fn(tx as DbClient);
  });
}
