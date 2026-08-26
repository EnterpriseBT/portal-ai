/**
 * The regression test for #460 — the one that would have caught the data loss.
 *
 * ## What was lost, and how
 *
 * BullMQ re-delivered a stalled sync while its first invocation was still
 * running, so two passes executed over one entity. Each pass writes every
 * record stamped with its own `runStartedAt`, then soft-deletes everything
 * below that watermark. Observed on a 397,960-record layer:
 *
 * ```
 * 22:40:41  pass A starts                 watermark = 22:40:40.681
 * 22:48:37  pass B starts (re-delivery)   watermark = 22:48:36.717
 * 22:49:42  pass A, still flushing, writes 34,000 rows at ITS watermark
 * 22:53:01  pass B's reap deletes everything < its watermark — those 34,000
 *           included
 * ```
 *
 * Final state: 363,960 live where the source had 397,960, and the job reported
 * `completed` with counts that added up, because each pass counted its own
 * work correctly.
 *
 * ## What this test drives
 *
 * The interleave is staged with **explicit ordering**, never a wall-clock race:
 * a race would be flaky, and #440 established that a flaky case is a
 * test-design fault rather than noise (and #462 is the standing example of a
 * timing assertion that measures the machine instead of the code).
 *
 * It exercises the real primitives that produced the loss —
 * `upsertManyBySourceId` for the writes, `softDeleteBeforeWatermark` for the
 * reap, `SyncLockService.withInstanceLock` for the fix — rather than simulating
 * HTTP. The adapters' own pipelines add pagination and mirroring on top, but
 * the write-then-reap-by-watermark shape asserted here is exactly what all
 * three of them do and is where the records were lost.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import { EntityRecordsRepository } from "../../../db/repositories/entity-records.repository.js";
import { SyncLockService } from "../../../services/sync-lock.service.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

/** The source has this many records; every one of them must end up live. */
const SOURCE_SIZE = 40;
/** How many pass A has flushed before pass B is let in. */
const A_FIRST_FLUSH = 25;

describe("concurrent sync passes must not reap each other's records (#460)", () => {
  let connection: ReturnType<typeof postgres>;
  let db!: DbClient;
  let dbq!: ReturnType<typeof drizzle>;
  let repo: EntityRecordsRepository;

  let orgId: string;
  let userId: string;
  let instanceId: string;
  let entityId: string;

  const now = Date.now();

  /** The source's stable record identities. */
  const sourceIds = Array.from({ length: SOURCE_SIZE }, (_, i) => `src-${i}`);

  const write = async (ids: string[], watermark: number) =>
    repo.upsertManyBySourceId(
      ids.map((sourceId) => ({
        id: generateId(),
        organizationId: orgId,
        connectorEntityId: entityId,
        data: { sourceId },
        sourceId,
        checksum: `sum-${sourceId}`,
        syncedAt: watermark,
        origin: "sync" as const,
        validationErrors: null,
        isValid: true,
        created: now,
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      })) as never,
      db
    );

  const liveSourceIds = async (): Promise<string[]> => {
    const r = (await dbq.execute(
      sql`SELECT source_id FROM entity_records
          WHERE connector_entity_id = ${entityId} AND deleted IS NULL
          ORDER BY source_id`
    )) as unknown as Array<{ source_id: string }>;
    return r.map((x) => x.source_id);
  };

  /**
   * A pass split into its observable phases, so the interleave can be ordered
   * explicitly rather than raced.
   *
   * The ORDER matters more than it looks. My first version of the control ran
   * B's reap inside A's flush gap — before A's late writes — and reproduced no
   * loss at all, because A then re-stamped those rows *after* the reap had
   * passed. The real timeline is the other way round: A's late flush at
   * 22:49:42 came first, and B's reap at 22:53:01 came last and swept it. The
   * control below is what caught that, which is why it exists.
   *
   * Both passes write the SAME source ids, because both passes of one job
   * share a generation key (#439) — so each write is an upsert that re-stamps
   * `synced_at` to the writing pass's watermark. That is the mechanism: the
   * last writer wins the stamp, and the last reaper deletes whatever the other
   * writer stamped.
   */
  const phase = {
    writeFirstHalf: (watermark: number) =>
      write(sourceIds.slice(0, A_FIRST_FLUSH), watermark),
    writeRest: (watermark: number) =>
      write(sourceIds.slice(A_FIRST_FLUSH), watermark),
    writeAll: (watermark: number) => write(sourceIds, watermark),
    reap: (watermark: number) =>
      repo.softDeleteBeforeWatermark(entityId, watermark, userId, db),
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
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
      slug: `conc-${generateId().slice(0, 8)}`,
      display: "Concurrent",
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

    instanceId = generateId();
    await dbq.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Concurrent",
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
      connectorInstanceId: instanceId,
      key: `ent_${entityId.slice(0, 6)}`,
      label: "Concurrent",
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

  it("reproduces the loss when the passes are NOT serialised", async () => {
    // The control. Not a test of the fix — a demonstration that the fixture
    // actually reproduces #460, so the passing case below cannot pass for an
    // unrelated reason. A lock that silently did nothing would otherwise look
    // identical to a lock that works.
    const wA = now;
    const wB = now + 1000; // B starts later, so its watermark is higher

    // The observed timeline, in order:
    await phase.writeFirstHalf(wA); //  22:40:43  A writes what it has
    await phase.writeAll(wB); //        22:48:37+ B writes everything
    await phase.writeRest(wA); //       22:49:42  A flushes the rest, at ITS watermark
    await phase.reap(wB); //            22:53:01  B reaps below its watermark

    const live = await liveSourceIds();
    // Exactly A's late writes are gone: they carry wA, and B reaped < wB.
    expect(live).toHaveLength(A_FIRST_FLUSH);
    expect(SOURCE_SIZE - live.length).toBe(SOURCE_SIZE - A_FIRST_FLUSH);
    // The shape of the real loss: 363,960 live of 397,960, silently.
    expect(live).toEqual(sourceIds.slice(0, A_FIRST_FLUSH).sort());
  });

  it("loses nothing when both passes go through the instance lock", async () => {
    const wA = now;
    const wB = now + 1000;
    let bRan = false;

    const outcomeA = await SyncLockService.withInstanceLock(
      instanceId,
      async () => {
        await phase.writeFirstHalf(wA);

        // B arrives mid-flush — the re-delivery — and must be refused.
        const outcomeB = await SyncLockService.withInstanceLock(
          instanceId,
          async () => {
            bRan = true;
            await phase.writeAll(wB);
            await phase.reap(wB);
          }
        );
        expect(outcomeB.acquired).toBe(false);

        await phase.writeRest(wA);
        await phase.reap(wA);
      }
    );

    expect(outcomeA.acquired).toBe(true);
    expect(bRan).toBe(false);

    // The acceptance criterion: every record the source has is live.
    expect(await liveSourceIds()).toEqual([...sourceIds].sort());
  });

  it("a pass refused mid-flight leaves the holder's data untouched", async () => {
    // Distinct from the case above: there, B never started. Here B is refused
    // *after* A has already written a partial generation, which is the state
    // the re-delivery actually arrives in.
    const wA = now;
    await write(sourceIds.slice(0, A_FIRST_FLUSH), wA);

    const refused = await SyncLockService.withInstanceLock(instanceId, () =>
      // A still holds nothing here — take the lock as A, then have B try.
      SyncLockService.withInstanceLock(instanceId, async () => {
        await repo.softDeleteBeforeWatermark(entityId, now + 5000, userId, db);
      })
    );

    // Narrow rather than cast: the union is the contract, and asserting
    // through a cast would keep passing if `acquired` ever stopped being
    // discriminating.
    if (!refused.acquired)
      throw new Error("outer lock should have been granted");
    expect(refused.value.acquired).toBe(false);
    // B's reap never ran, so A's partial generation survives intact.
    expect(await liveSourceIds()).toHaveLength(A_FIRST_FLUSH);
  });

  it("the lock does not serialise different instances", async () => {
    // The fix must not turn every org's syncs into a queue behind each other.
    const other = generateId();
    const outer = await SyncLockService.withInstanceLock(instanceId, () =>
      SyncLockService.withInstanceLock(other, async () => "ran")
    );

    if (!outer.acquired) throw new Error("outer lock should have been granted");
    expect(outer.value).toEqual({ acquired: true, value: "ran" });
  });
});
