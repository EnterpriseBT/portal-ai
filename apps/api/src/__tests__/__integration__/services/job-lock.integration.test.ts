import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { JobLockService } from "../../../services/job-lock.service.js";
import { JobsService } from "../../../services/jobs.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

/**
 * #769: one lock model. A running job locks scopes (an entity, or a whole
 * connector instance); a write to anything that resolves into a locked scope
 * is refused, and a job can't start over a scope another running job holds.
 * Shared/exclusive advisory locks make both checks atomic with their write.
 */
describe("JobLockService (#769)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;
  let otherOrgId: string;
  // Two instances: I1 holds E1 and E2, I2 holds E3. Column definition C is
  // mapped on E1 and E3.
  let I1: string, I2: string, E1: string, E2: string, E3: string, C: string;

  const now = () => Date.now();
  const base = () => ({
    created: now(),
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });

  async function instance(organizationId: string, definitionId: string) {
    const id = generateId();
    await db.insert(schema.connectorInstances).values({
      id,
      connectorDefinitionId: definitionId,
      organizationId,
      name: "Lock test",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      ...base(),
    } as never);
    return id;
  }

  async function entity(organizationId: string, connectorInstanceId: string) {
    const id = generateId();
    await db.insert(schema.connectorEntities).values({
      id,
      organizationId,
      connectorInstanceId,
      key: `e_${id.slice(0, 8).replace(/-/g, "")}`,
      label: "Lock entity",
      ...base(),
    } as never);
    return id;
  }

  async function mapping(
    connectorEntityId: string,
    columnDefinitionId: string
  ) {
    await db.insert(schema.fieldMappings).values({
      id: generateId(),
      organizationId: orgId,
      connectorEntityId,
      columnDefinitionId,
      sourceField: "name",
      isPrimaryKey: false,
      normalizedKey: "name",
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
      ...base(),
    } as never);
  }

  /** A job row as `enqueueExclusive` would leave it, without queueing it. */
  async function job(
    type: string,
    lockScopes: string[],
    status = "active",
    organizationId = orgId
  ) {
    const id = generateId();
    await db.insert(schema.jobs).values({
      id,
      organizationId,
      type,
      status,
      progress: 0,
      metadata: {},
      attempts: 0,
      maxAttempts: 3,
      lockScopes,
      ...base(),
    } as never);
    return id;
  }

  const ctx = () => ({ organizationId: orgId });
  const sorted = (xs: string[]) => [...xs].sort();

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    ({ organizationId: orgId } = await seedUserAndOrg(db, "auth0|lock-a"));
    ({ organizationId: otherOrgId } = await seedUserAndOrg(db, "auth0|lock-b"));

    const defId = generateId();
    await db.insert(schema.connectorDefinitions).values({
      id: defId,
      slug: `lock-${defId.slice(0, 8)}`,
      display: "Lock",
      category: "crm",
      authType: "none",
      configSchema: {},
      capabilityFlags: { sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base(),
    } as never);
    I1 = await instance(orgId, defId);
    I2 = await instance(orgId, defId);
    E1 = await entity(orgId, I1);
    E2 = await entity(orgId, I1);
    E3 = await entity(orgId, I2);
    C = generateId();
    await db.insert(schema.columnDefinitions).values({
      id: C,
      organizationId: orgId,
      key: `c_${C.slice(0, 8).replace(/-/g, "")}`,
      label: "Name",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      system: false,
      ...base(),
    } as never);
    await mapping(E1, C);
    await mapping(E3, C);

    jest
      .spyOn(JobsService, "dispatch")
      .mockImplementation(async (j) => ({ ...j, bullJobId: "bull-test" }));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await connection.end();
  });

  describe("resolveScopeKeys", () => {
    it("a record, field mapping or entity resolves to its entity and instance", async () => {
      for (const target of [
        { kind: "record", connectorEntityId: E1 },
        { kind: "fieldMapping", connectorEntityId: E1 },
        { kind: "connectorEntity", id: E1 },
      ] as const) {
        expect(
          sorted(
            await JobLockService.resolveScopeKeys([target], orgId, db as never)
          )
        ).toEqual(sorted([`entity:${E1}`, `instance:${I1}`]));
      }
    });

    it("an instance resolves to itself and its live entities", async () => {
      expect(
        sorted(
          await JobLockService.resolveScopeKeys(
            [{ kind: "connectorInstance", id: I1 }],
            orgId,
            db as never
          )
        )
      ).toEqual(sorted([`instance:${I1}`, `entity:${E1}`, `entity:${E2}`]));
    });

    it("a column definition resolves through every entity that maps it", async () => {
      expect(
        sorted(
          await JobLockService.resolveScopeKeys(
            [{ kind: "columnDefinition", id: C }],
            orgId,
            db as never
          )
        )
      ).toEqual(
        sorted([
          `entity:${E1}`,
          `entity:${E3}`,
          `instance:${I1}`,
          `instance:${I2}`,
        ])
      );
    });

    it("a missing object, or one in another org, resolves to nothing", async () => {
      expect(
        await JobLockService.resolveScopeKeys(
          [{ kind: "connectorEntity", id: "nope" }],
          orgId,
          db as never
        )
      ).toEqual([]);
      expect(
        await JobLockService.resolveScopeKeys(
          [{ kind: "connectorEntity", id: E1 }],
          otherOrgId,
          db as never
        )
      ).toEqual([]);
    });
  });

  describe("findRunning", () => {
    it("an entity job is found from its records and its instance, not a sibling", async () => {
      const id = await job("revalidation", [`entity:${E1}`]);

      const onRecord = await JobLockService.findRunning(
        [{ kind: "record", connectorEntityId: E1 }],
        orgId
      );
      expect(onRecord.map((j) => j.id)).toEqual([id]);
      expect(onRecord[0].lockScopes).toEqual([`entity:${E1}`]);
      expect(
        (
          await JobLockService.findRunning(
            [{ kind: "connectorInstance", id: I1 }],
            orgId
          )
        ).map((j) => j.id)
      ).toEqual([id]);
      expect(
        await JobLockService.findRunning(
          [{ kind: "record", connectorEntityId: E2 }],
          orgId
        )
      ).toEqual([]);
    });

    it("an instance job is found from every entity under it", async () => {
      const id = await job("connector_sync", [`instance:${I1}`]);
      expect(
        (
          await JobLockService.findRunning(
            [{ kind: "record", connectorEntityId: E2 }],
            orgId
          )
        ).map((j) => j.id)
      ).toEqual([id]);
      expect(
        await JobLockService.findRunning(
          [{ kind: "record", connectorEntityId: E3 }],
          orgId
        )
      ).toEqual([]);
    });

    it("every non-terminal status locks; terminal ones don't", async () => {
      for (const status of [
        "pending",
        "active",
        "awaiting_confirmation",
        "stalled",
      ]) {
        const id = await job("revalidation", [`entity:${E1}`], status);
        expect(
          (
            await JobLockService.findRunning(
              [{ kind: "connectorEntity", id: E1 }],
              orgId
            )
          ).map((j) => j.id)
        ).toEqual([id]);
        await db
          .update(schema.jobs)
          .set({ status: "completed" } as never)
          .where(eq(schema.jobs.id, id));
      }
      for (const status of ["completed", "failed", "cancelled"]) {
        await job("revalidation", [`entity:${E1}`], status);
      }
      expect(
        await JobLockService.findRunning(
          [{ kind: "connectorEntity", id: E1 }],
          orgId
        )
      ).toEqual([]);
    });

    it("a job in another org never shows up", async () => {
      await job("revalidation", [`entity:${E1}`], "active", otherOrgId);
      expect(
        await JobLockService.findRunning(
          [{ kind: "connectorEntity", id: E1 }],
          orgId
        )
      ).toEqual([]);
    });
  });

  describe("withUnlocked", () => {
    it("runs the write on its transaction when nothing holds the scope", async () => {
      const out = await JobLockService.withUnlocked(
        { kind: "connectorEntity", id: E1 },
        ctx(),
        async (tx) => {
          await (tx as typeof db)
            .update(schema.connectorEntities)
            .set({ label: "Renamed" } as never)
            .where(eq(schema.connectorEntities.id, E1));
          return "done";
        }
      );
      expect(out).toBe("done");
      const [row] = await db
        .select()
        .from(schema.connectorEntities)
        .where(eq(schema.connectorEntities.id, E1));
      expect(row.label).toBe("Renamed");
    });

    it("refuses with one 409 naming the job and its scope, and doesn't run the write", async () => {
      const id = await job("revalidation", [`entity:${E1}`]);
      const fn = jest.fn(async () => "never");

      const err = await JobLockService.withUnlocked(
        { kind: "record", connectorEntityId: E1 },
        ctx(),
        fn
      ).catch((e) => e);

      expect(fn).not.toHaveBeenCalled();
      expect(err).toMatchObject({
        status: 409,
        code: ApiCode.ENTITY_LOCKED_BY_JOB,
        message: expect.stringMatching(
          /^Revalidation is running on this entity/
        ),
      });
      expect(err.details.runningJobs).toEqual([
        expect.objectContaining({
          id,
          type: "revalidation",
          lockScopes: [`entity:${E1}`],
        }),
      ]);
    });

    it("an instance-wide job reads as running on this connector", async () => {
      await job("connector_sync", [`instance:${I1}`]);
      const err = await JobLockService.withUnlocked(
        { kind: "connectorEntity", id: E2 },
        ctx(),
        async () => undefined
      ).catch((e) => e);
      expect(err.message).toMatch(/^Sync is running on this connector/);
    });

    it("a column definition is refused while any entity that maps it is locked", async () => {
      await job("bulk_geocode", [`entity:${E3}`]);
      await expect(
        JobLockService.withUnlocked(
          { kind: "columnDefinition", id: C },
          ctx(),
          async () => undefined
        )
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("enqueueExclusive", () => {
    const revalidation = (connectorEntityId: string) => ({
      organizationId: orgId,
      type: "revalidation" as const,
      metadata: { connectorEntityId, organizationId: orgId },
    });
    const sync = (connectorInstanceId: string) => ({
      organizationId: orgId,
      type: "connector_sync" as const,
      metadata: { connectorInstanceId },
    });

    it("inserts the row with its scopes and dispatches it after commit", async () => {
      const dispatch = JobsService.dispatch as jest.Mock;
      let visibleAtDispatch = false;
      dispatch.mockImplementationOnce((async (j: { id: string }) => {
        const check = postgres(process.env.DATABASE_URL!, { max: 1 });
        const rows = await check`SELECT id FROM jobs WHERE id = ${j.id}`;
        visibleAtDispatch = rows.length === 1;
        await check.end();
        return { ...j, bullJobId: "bull-test" };
      }) as never);

      const created = await JobLockService.enqueueExclusive(
        "user-1",
        revalidation(E1)
      );

      expect(created.lockScopes).toEqual([`entity:${E1}`]);
      expect(visibleAtDispatch).toBe(true);
    });

    it("refuses an entity job while an instance job holds its connector, and the reverse", async () => {
      const syncId = await job("connector_sync", [`instance:${I1}`]);
      await expect(
        JobLockService.enqueueExclusive("user-1", revalidation(E1))
      ).rejects.toMatchObject({
        status: 409,
        details: { runningJobs: [expect.objectContaining({ id: syncId })] },
      });
      await db
        .update(schema.jobs)
        .set({ status: "completed" } as never)
        .where(eq(schema.jobs.id, syncId));

      await job("revalidation", [`entity:${E2}`]);
      await expect(
        JobLockService.enqueueExclusive("user-1", sync(I1))
      ).rejects.toMatchObject({ status: 409 });
    });

    it("jobs on different entities don't conflict", async () => {
      await job("revalidation", [`entity:${E1}`]);
      await expect(
        JobLockService.enqueueExclusive("user-1", revalidation(E2))
      ).resolves.toMatchObject({ lockScopes: [`entity:${E2}`] });
    });

    it("reuse returns a running job of the same type and scopes; refuse is the default", async () => {
      const running = await job("revalidation", [`entity:${E1}`]);
      const dispatch = JobsService.dispatch as jest.Mock;
      dispatch.mockClear();

      const reused = await JobLockService.enqueueExclusive(
        "user-1",
        revalidation(E1),
        { onSameJob: "reuse" }
      );
      expect(reused.id).toBe(running);
      expect(dispatch).not.toHaveBeenCalled();

      await expect(
        JobLockService.enqueueExclusive("user-1", revalidation(E1))
      ).rejects.toMatchObject({ status: 409 });
    });

    it("reuse still refuses a different job type holding the scope", async () => {
      await job("bulk_geocode", [`entity:${E1}`]);
      await expect(
        JobLockService.enqueueExclusive("user-1", revalidation(E1), {
          onSameJob: "reuse",
        })
      ).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("races (deterministic)", () => {
    function gate() {
      let open!: () => void;
      const opened = new Promise<void>((r) => (open = r));
      return { open, opened };
    }
    const settledWithin = (p: Promise<unknown>, ms: number) =>
      Promise.race([
        p.then(
          () => true,
          () => true
        ),
        new Promise<boolean>((r) => setTimeout(() => r(false), ms)),
      ]);

    it("a job can't start while a write that passed its check is still open", async () => {
      const held = gate();
      const inside = gate();
      const write = JobLockService.withUnlocked(
        { kind: "record", connectorEntityId: E1 },
        ctx(),
        async () => {
          inside.open();
          await held.opened;
        }
      );
      await inside.opened;

      const enqueue = JobLockService.enqueueExclusive("user-1", revalidation());
      expect(await settledWithin(enqueue, 400)).toBe(false);

      held.open();
      await write;
      const created = await enqueue;
      expect(created.type).toBe("revalidation");

      await expect(
        JobLockService.withUnlocked(
          { kind: "record", connectorEntityId: E1 },
          ctx(),
          async () => undefined
        )
      ).rejects.toMatchObject({ status: 409 });

      function revalidation() {
        return {
          organizationId: orgId,
          type: "revalidation" as const,
          metadata: { connectorEntityId: E1, organizationId: orgId },
        };
      }
    });

    it("a write waits for a job that's being enqueued, then sees it", async () => {
      const held = gate();
      const inside = gate();
      const insertRow = JobsService.insertRow.bind(JobsService);
      jest
        .spyOn(JobsService, "insertRow")
        .mockImplementationOnce(async (...args) => {
          inside.open();
          await held.opened;
          return insertRow(...args);
        });

      const enqueue = JobLockService.enqueueExclusive("user-1", {
        organizationId: orgId,
        type: "revalidation",
        metadata: { connectorEntityId: E1, organizationId: orgId },
      });
      await inside.opened;

      const fn = jest.fn(async () => undefined);
      const write = JobLockService.withUnlocked(
        { kind: "record", connectorEntityId: E1 },
        ctx(),
        fn
      );
      expect(await settledWithin(write, 400)).toBe(false);

      held.open();
      await enqueue;
      await expect(write).rejects.toMatchObject({ status: 409 });
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
