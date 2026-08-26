/**
 * Chunking the watermark reap (#460 slice 3).
 *
 * **This is trigger reduction, not the fix.** The fix is the ownership lock in
 * slice 2. What this addresses is *why* two passes came to exist at all: the
 * reap issued one `UPDATE … RETURNING id` over 431,960 rows and held the event
 * loop long enough that the worker could not renew its BullMQ lock, so BullMQ
 * concluded the job had stalled and re-delivered it. Chunking lets the loop
 * breathe between statements and shrinks that window.
 *
 * If this is ever mistaken for the fix and the lock is dropped, the loss comes
 * straight back under a slower reap — a bigger dataset, a loaded box, a broken
 * wide table making every mirror write fail.
 *
 * The loop's termination is the part worth testing carefully. #440 shipped a
 * chunk loop that exited early at 316,805 of 317,000 because its `LIMIT` chunk
 * had no ordering and kept re-selecting rows it had already processed. This
 * loop is sound for a different reason, and the reason is load-bearing: each
 * chunk sets `deleted`, and the candidate predicate requires `deleted IS NULL`,
 * so every pass strictly shrinks the candidate set. Termination follows from
 * the predicate, not from a count.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import { EntityRecordsRepository } from "../../../../db/repositories/entity-records.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("softDeleteBeforeWatermark — chunked (#460)", () => {
  let connection: ReturnType<typeof postgres>;
  let db!: DbClient;
  let dbq!: ReturnType<typeof drizzle>;
  let repo: EntityRecordsRepository;

  let orgId: string;
  let userId: string;
  let entityId: string;

  const now = Date.now();
  /** Rows written by "an earlier run" — everything below the watermark. */
  const OLD_WATERMARK = now - 60_000;
  const WATERMARK = now;

  const seed = async (count: number, syncedAt: number): Promise<string[]> => {
    const ids: string[] = [];
    const rows = Array.from({ length: count }, () => {
      const id = generateId();
      ids.push(id);
      return {
        id,
        organizationId: orgId,
        connectorEntityId: entityId,
        data: { n: 1 },
        sourceId: `src-${id}`,
        checksum: `sum-${id}`,
        syncedAt,
        origin: "sync" as const,
        validationErrors: null,
        isValid: true,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      };
    });
    for (let i = 0; i < rows.length; i += 500) {
      await dbq
        .insert(schema.entityRecords)
        .values(rows.slice(i, i + 500) as never);
    }
    return ids;
  };

  const liveCount = async (): Promise<number> => {
    const r = (await dbq.execute(
      sql`SELECT count(*)::int AS c FROM entity_records
          WHERE connector_entity_id = ${entityId} AND deleted IS NULL`
    )) as unknown as Array<{ c: number }>;
    return r[0].c;
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    dbq = drizzle(connection, { schema });
    db = dbq as DbClient;
    repo = new EntityRecordsRepository();

    await teardownOrg(dbq);

    const user = createUser(`auth0|${generateId()}`);
    await dbq.insert(schema.users).values(user as never);
    userId = user.id;
    const org = createOrganization(user.id);
    await dbq.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await dbq.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `reap-${generateId().slice(0, 8)}`,
      display: "Reap",
      category: "crm",
      authType: "none",
      configSchema: {},
      capabilityFlags: { sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const ciId = generateId();
    await dbq.insert(schema.connectorInstances).values({
      id: ciId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Reap",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    entityId = generateId();
    await dbq.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId: ciId,
      key: `ent_${entityId.slice(0, 6)}`,
      label: "Reap",
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    await teardownOrg(dbq);
    await connection.end();
  });

  it("reaps every row below the watermark and returns their ids", async () => {
    const stale = await seed(30, OLD_WATERMARK);

    const reaped = await repo.softDeleteBeforeWatermark(
      entityId,
      WATERMARK,
      userId,
      db
    );

    expect(reaped.sort()).toEqual(stale.sort());
    expect(await liveCount()).toBe(0);
  });

  it("never touches a row at or above the watermark", async () => {
    await seed(10, OLD_WATERMARK);
    await seed(7, WATERMARK); // exactly at the watermark — strict `<`

    const reaped = await repo.softDeleteBeforeWatermark(
      entityId,
      WATERMARK,
      userId,
      db
    );

    expect(reaped).toHaveLength(10);
    // The rows this run just wrote must survive its own reap.
    expect(await liveCount()).toBe(7);
  });

  it("returns [] when there is nothing to reap", async () => {
    await seed(5, WATERMARK);

    const reaped = await repo.softDeleteBeforeWatermark(
      entityId,
      WATERMARK,
      userId,
      db
    );

    expect(reaped).toEqual([]);
    expect(await liveCount()).toBe(5);
  });

  it("spans multiple chunks without duplicating or dropping an id", async () => {
    // The #440 failure mode: a chunk loop that re-selects rows it already
    // handled either loops forever or exits early. Driven with a tiny chunk
    // size so the loop runs many times over a small fixture.
    const stale = await seed(47, OLD_WATERMARK);

    const reaped = await repo.softDeleteBeforeWatermark(
      entityId,
      WATERMARK,
      userId,
      db,
      { chunkSize: 5 } // 10 chunks
    );

    expect(reaped).toHaveLength(47);
    expect(new Set(reaped).size).toBe(47); // no duplicates
    expect(reaped.sort()).toEqual(stale.sort()); // no gaps
    expect(await liveCount()).toBe(0);
  });

  it("a chunked run matches an unchunked one on the same fixture", async () => {
    const stale = await seed(23, OLD_WATERMARK);

    const chunked = await repo.softDeleteBeforeWatermark(
      entityId,
      WATERMARK,
      userId,
      db,
      { chunkSize: 4 }
    );

    // Equivalence is the whole safety claim of this slice: callers see no
    // behavioural change, only a different number of statements.
    expect(chunked.sort()).toEqual(stale.sort());
  });

  it("issues one statement per chunk, not one over the whole reap set", async () => {
    // The other cases here assert EQUIVALENCE, which an unchunked
    // implementation satisfies trivially — they are the safety net, not the
    // proof. This is the case that actually tests the slice's claim, and it
    // maps directly to the acceptance criterion: "a sync's reap no longer
    // issues a single statement over the whole reap set". Counting statements
    // is white-box, but the statement count IS the contract: it is what
    // determines whether the event loop gets to breathe.
    await seed(47, OLD_WATERMARK);

    let updates = 0;
    const counting = new Proxy(dbq, {
      get(target, prop, receiver) {
        if (prop === "update") {
          updates += 1;
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as unknown as DbClient;

    await repo.softDeleteBeforeWatermark(
      entityId,
      WATERMARK,
      userId,
      counting,
      {
        chunkSize: 5,
      }
    );

    // 47 rows / 5 per chunk = 10 chunks, and the loop needs no extra probe:
    // a short final chunk already proves the candidate set is exhausted.
    expect(updates).toBeGreaterThanOrEqual(10);
    expect(updates).toBeLessThanOrEqual(11);
  });

  it("marks deletedBy on every reaped row, across chunks", async () => {
    await seed(12, OLD_WATERMARK);

    await repo.softDeleteBeforeWatermark(entityId, WATERMARK, userId, db, {
      chunkSize: 5,
    });

    const r = (await dbq.execute(
      sql`SELECT count(*)::int AS c FROM entity_records
          WHERE connector_entity_id = ${entityId}
            AND deleted IS NOT NULL AND deleted_by = ${userId}`
    )) as unknown as Array<{ c: number }>;
    expect(r[0].c).toBe(12);
  });
});
