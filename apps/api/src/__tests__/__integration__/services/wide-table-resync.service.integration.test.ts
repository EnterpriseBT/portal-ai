/**
 * Integration tests for `wideTableResyncService.resyncAllConnectorInstances`.
 *
 * Cases 49–50 from `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_2.spec.md`:
 *   49 — enqueues one job per live, sync-capable instance; skips
 *        soft-deleted and adapter-unsupported instances.
 *   50 — skips instances with an in-flight job; idempotent re-run
 *        re-enqueues the instance after the prior job completes.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { wideTableResyncService } from "../../../services/wide-table-resync.service.js";
import { SyncService } from "../../../services/sync.service.js";
import { ConnectorAdapterRegistry } from "../../../adapters/adapter.registry.js";
import { JobsService } from "../../../services/jobs.service.js";
import {
  generateId,
  teardownOrg,
  seedUserAndOrg,
} from "../utils/application.util.js";

describe("wideTableResyncService.resyncAllConnectorInstances", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let organizationId: string;
  let userId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    const seed = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      `auth0|resync-${generateId().slice(0, 6)}`
    );
    organizationId = seed.organizationId;
    userId = seed.userId;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await connection.end();
  });

  async function seedDef(
    capabilityFlags: Record<string, boolean> = { sync: true, read: true }
  ): Promise<string> {
    const defId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorDefinitions)
      .values({
        id: defId,
        slug: `resync-conn-${defId.slice(0, 8)}`,
        display: "Resync Test Connector",
        category: "crm",
        authType: "oauth2",
        configSchema: {},
        capabilityFlags,
        isActive: true,
        version: "1.0.0",
        iconUrl: null,
        created: Date.now(),
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    return defId;
  }

  async function seedInstance(
    defId: string,
    overrides: Partial<Record<string, unknown>> = {}
  ): Promise<string> {
    const id = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorInstances)
      .values({
        id,
        connectorDefinitionId: defId,
        organizationId,
        name: `Instance ${id.slice(0, 8)}`,
        status: "active" as const,
        config: {},
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
        created: Date.now(),
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        ...overrides,
      } as never);
    return id;
  }

  // ── Case 49 — enqueues one job per live sync-capable instance ────

  it("enqueues one connector_sync job per live sync-capable instance", async () => {
    // Mock the adapter registry to return adapters with deterministic
    // syncInstance availability — sandbox-like instances declare no
    // syncInstance so they should be skipped.
    const syncCapableDefId = await seedDef();
    const sandboxDefId = await seedDef();

    const sandboxAdapter = {
      syncInstance: undefined,
    } as unknown as Parameters<
      typeof ConnectorAdapterRegistry.register
    >[1];
    const syncCapableAdapter = {
      syncInstance: jest.fn(async () => ({
        recordCounts: { created: 0, updated: 0, unchanged: 0 },
        connectorEntityIds: [],
      })),
    } as unknown as Parameters<typeof ConnectorAdapterRegistry.register>[1];

    const getSpy = jest
      .spyOn(ConnectorAdapterRegistry, "get")
      .mockImplementation((slug: string) => {
        const def = slug.startsWith("resync-conn-");
        if (!def) {
          throw new Error(`unexpected slug ${slug}`);
        }
        const isSandbox = slug === sandboxSlug;
        return isSandbox ? sandboxAdapter : syncCapableAdapter;
      });

    // Pull the seeded slugs back so the mock can branch deterministically.
    const sandboxRow = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.connectorDefinitions)
      .where(eq(schema.connectorDefinitions.id, sandboxDefId));
    const sandboxSlug = sandboxRow[0]!.slug;

    const liveSyncId = await seedInstance(syncCapableDefId);
    const sandboxId = await seedInstance(sandboxDefId);
    // Soft-deleted instances are skipped entirely.
    const _softDeletedId = await seedInstance(syncCapableDefId, {
      deleted: Date.now(),
      deletedBy: userId,
    });
    void _softDeletedId;

    const report =
      await wideTableResyncService.resyncAllConnectorInstances(userId);

    expect(report.triggered).toHaveLength(1);
    expect(report.skippedUnsupported).toEqual([sandboxId]);
    expect(report.skippedInFlight).toEqual([]);
    expect(report.failed).toEqual([]);

    // Each `triggered` id is a real job row in `connector_sync`.
    const triggeredJobId = report.triggered[0]!;
    const jobs = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, triggeredJobId));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.type).toBe("connector_sync");
    const meta = jobs[0]!.metadata as Record<string, unknown>;
    expect(meta.connectorInstanceId).toBe(liveSyncId);

    getSpy.mockRestore();
  });

  // ── Case 50 — skips in-flight + idempotent re-run ────────────────

  it("skips instances with an active sync job and is idempotent across re-runs", async () => {
    const defId = await seedDef();
    const instanceId = await seedInstance(defId);

    const adapter = {
      syncInstance: jest.fn(async () => ({
        recordCounts: { created: 0, updated: 0, unchanged: 0 },
        connectorEntityIds: [],
      })),
    } as unknown as Parameters<typeof ConnectorAdapterRegistry.register>[1];
    const getSpy = jest
      .spyOn(ConnectorAdapterRegistry, "get")
      .mockReturnValue(adapter);

    // Pre-seed an in-flight `connector_sync` job for this instance so
    // the trigger sees it and skips.
    await JobsService.create(userId, {
      type: "connector_sync",
      organizationId,
      metadata: {
        connectorInstanceId: instanceId,
        organizationId,
        userId,
      },
    });

    const first =
      await wideTableResyncService.resyncAllConnectorInstances(userId);
    expect(first.triggered).toHaveLength(0);
    expect(first.skippedInFlight).toEqual([instanceId]);

    // Mark the pre-seeded job completed so the second run sees no
    // active sync and re-enqueues the instance.
    const existing = await SyncService.findActiveSyncJob(instanceId);
    expect(existing).not.toBeNull();
    await (db as ReturnType<typeof drizzle>)
      .update(schema.jobs)
      .set({ status: "completed", updated: Date.now(), updatedBy: userId } as never)
      .where(eq(schema.jobs.id, existing!.id));

    const second =
      await wideTableResyncService.resyncAllConnectorInstances(userId);
    expect(second.triggered).toHaveLength(1);
    expect(second.skippedInFlight).toEqual([]);

    getSpy.mockRestore();
  });
});
