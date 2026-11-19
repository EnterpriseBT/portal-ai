/**
 * Integration tests for `ApplicationService.createDemoOrganization` (#1035):
 * the one transaction `db:demo:create` runs before the dataset load — a normal
 * provisioned org, marked `is_demo`, on the requested tier, plus its own
 * "Demo" station. A failure anywhere rolls the whole org back.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { DbService } from "../../../services/db.service.js";
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
});
