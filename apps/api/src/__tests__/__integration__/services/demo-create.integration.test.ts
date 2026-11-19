/**
 * Integration tests for `ApplicationService.createDemoOrganization` (#1035):
 * the one transaction `db:demo:create` runs before the dataset load — a normal
 * provisioned org, marked `is_demo`, on the requested tier, plus its own
 * "Demo" station. A failure anywhere rolls the whole org back.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { DbService } from "../../../services/db.service.js";
import { DemoSeedService } from "../../../services/demo-seed.service.js";
import { SeedService } from "../../../services/seed.service.js";
import { PROVISIONED_STATIONS } from "../../../constants/provisioned-stations.constants.js";
import { DEMO_STATION_NAME } from "../../../demo/dataset-manifest.js";
import {
  createUser,
  generateId,
  teardownOrg,
} from "../utils/application.util.js";

const TEST_ACTOR = "DEMO_CREATE_TEST";

describe("ApplicationService.createDemoOrganization (integration)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let ownerEmail!: string;
  let ownerId!: string;
  let tierSlug!: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await new SeedService().seedConnectorDefinitions(db);

    const owner = createUser(`auth0|${generateId()}`);
    await db.insert(schema.users).values(owner as never);
    ownerEmail = owner.email;
    ownerId = owner.id;

    tierSlug = `demo-create-${generateId().slice(0, 8)}`;
    const now = Date.now();
    await db.insert(schema.tiers).values({
      id: generateId(),
      created: now,
      createdBy: TEST_ACTOR,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      slug: tierSlug,
      displayName: "Demo create test",
    } as never);
  });

  afterEach(async () => {
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await db.delete(schema.tiers).where(eq(schema.tiers.createdBy, TEST_ACTOR));
    await connection.end();
  });

  async function liveOrgsNamed(name: string) {
    return (await db.select().from(schema.organizations)).filter(
      (o) => o.name === name && o.deleted === null
    );
  }

  it("provisions a normal org, marks it a demo, sets the tier and adds a Demo station", async () => {
    const name = `Acme demo ${generateId()}`;

    const { organizationId, stationId } =
      await ApplicationService.createDemoOrganization({
        ownerEmail,
        name,
        tier: tierSlug,
      });

    const org =
      await DbService.repository.organizations.findById(organizationId);
    expect(org).toBeDefined();
    expect(org!.isDemo).toBe(true);
    expect(org!.tier).toBe(tierSlug);
    expect(org!.ownerUserId).toBe(ownerId);
    expect(org!.name).toBe(name);

    const stations =
      await DbService.repository.stations.findByOrganizationId(organizationId);
    expect(stations.map((s) => s.name).sort()).toEqual(
      [...PROVISIONED_STATIONS.map((s) => s.name), DEMO_STATION_NAME].sort()
    );
    const demo = stations.find((s) => s.id === stationId);
    expect(demo!.name).toBe(DEMO_STATION_NAME);

    // The provisioned default (Administrate) stays the default.
    const defaultName = PROVISIONED_STATIONS.find((s) => s.isDefault)!.name;
    const defaultStation = stations.find((s) => s.id === org!.defaultStationId);
    expect(defaultStation!.name).toBe(defaultName);

    // The demo station starts empty; the seed attaches connectors and packs.
    expect(
      await DbService.repository.stationInstances.findByStationId(stationId)
    ).toHaveLength(0);
  });

  it("refuses an unknown owner email and creates nothing", async () => {
    const name = `No owner ${generateId()}`;
    await expect(
      ApplicationService.createDemoOrganization({
        ownerEmail: `missing-${generateId()}@example.com`,
        name,
        tier: tierSlug,
      })
    ).rejects.toThrow(/not found/);
    expect(await liveOrgsNamed(name)).toHaveLength(0);
  });

  it("rolls the whole org back on an unknown tier", async () => {
    const name = `Bad tier ${generateId()}`;
    await expect(
      ApplicationService.createDemoOrganization({
        ownerEmail,
        name,
        tier: `nope-${generateId()}`,
      })
    ).rejects.toThrow(/Tier "nope-/);
    expect(
      (await db.select().from(schema.organizations)).filter(
        (o) => o.name === name
      )
    ).toHaveLength(0);
    expect(
      (await db.select().from(schema.stations)).filter(
        (s) => s.name === DEMO_STATION_NAME
      )
    ).toHaveLength(0);
  });

  it("creates an independent org on every call, even with the same name", async () => {
    const name = `Twice ${generateId()}`;
    const first = await ApplicationService.createDemoOrganization({
      ownerEmail,
      name,
      tier: tierSlug,
    });
    const second = await ApplicationService.createDemoOrganization({
      ownerEmail,
      name,
      tier: tierSlug,
    });
    expect(second.organizationId).not.toBe(first.organizationId);
    expect(second.stationId).not.toBe(first.stationId);
    expect(await liveOrgsNamed(name)).toHaveLength(2);
  });

  // ── Review fixes (#1035 code review) ─────────────────────────────────

  it("leaves the owner's current org where it was (the demo membership never wins the pick)", async () => {
    const { organization: real } =
      await ApplicationService.createOrganizationForEmail(
        ownerEmail,
        `Real ${generateId()}`
      );

    const { organizationId } = await ApplicationService.createDemoOrganization({
      ownerEmail,
      name: `Acme demo ${generateId()}`,
      tier: tierSlug,
    });

    const current = await ApplicationService.getCurrentOrganization(ownerId);
    expect(current!.organization.id).toBe(real.id);
    const [membership] = (
      await db.select().from(schema.organizationUsers)
    ).filter((m) => m.organizationId === organizationId);
    expect(membership.lastLogin).toBe(0);
  });

  describe("deleteDemoOrganization", () => {
    async function demoWithRecords(): Promise<string> {
      const { organizationId, stationId } =
        await ApplicationService.createDemoOrganization({
          ownerEmail,
          name: `Acme demo ${generateId()}`,
          tier: tierSlug,
        });
      await DemoSeedService.seed({ orgId: organizationId, stationId, rows: 0 });
      return organizationId;
    }

    it("runs the full org deletion: content gone, org and memberships tombstoned", async () => {
      const orgId = await demoWithRecords();
      const entityIds = (await db.select().from(schema.connectorEntities))
        .filter((e) => e.organizationId === orgId)
        .map((e) => e.id);
      expect(entityIds.length).toBeGreaterThan(0);

      await ApplicationService.deleteDemoOrganization(orgId, "operator-1");

      const [org] = (await db.select().from(schema.organizations)).filter(
        (o) => o.id === orgId
      );
      expect(org.deleted).not.toBeNull();
      expect(org.deletedBy).toBe("operator-1");
      const memberships = (
        await db.select().from(schema.organizationUsers)
      ).filter((m) => m.organizationId === orgId);
      expect(memberships.every((m) => m.deleted !== null)).toBe(true);
      expect(
        (await db.select().from(schema.entityRecords)).filter(
          (r) => r.organizationId === orgId
        )
      ).toHaveLength(0);
      const tables = (await db.execute(
        sql`SELECT count(*)::int AS count FROM pg_tables WHERE tablename = ANY(${sql.raw(
          `ARRAY[${entityIds.map((id) => `'er__${id}'`).join(",")}]`
        )})`
      )) as unknown as Array<{ count: number }>;
      expect(tables[0].count).toBe(0);
      // The owner falls back to no current org rather than a deleted one.
      expect(
        await ApplicationService.getCurrentOrganization(ownerId)
      ).toBeNull();
    }, 90000);

    it("refuses an org without the demo marker and leaves it whole", async () => {
      const { organization } =
        await ApplicationService.createOrganizationForEmail(
          ownerEmail,
          `Customer ${generateId()}`
        );
      await expect(
        ApplicationService.deleteDemoOrganization(organization.id, "operator-1")
      ).rejects.toMatchObject({ code: "DEMO_ORGANIZATION_NOT_DEMO" });
      expect(
        await DbService.repository.organizations.findById(organization.id)
      ).toBeDefined();
    });

    it("refuses a missing or already-deleted org as not found", async () => {
      const orgId = await demoWithRecords();
      await ApplicationService.deleteDemoOrganization(orgId, "operator-1");
      for (const id of [orgId, generateId()]) {
        await expect(
          ApplicationService.deleteDemoOrganization(id, "operator-1")
        ).rejects.toMatchObject({ code: "DEMO_ORGANIZATION_NOT_FOUND" });
      }
    }, 90000);
  });
});
