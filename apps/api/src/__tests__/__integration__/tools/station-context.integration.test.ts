/**
 * Integration tests for `station_context`'s #1050 sections against the test
 * database: the readable-stations list honours the caller's visibility (#621),
 * and `status` reports a station's records as they land.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { StationModelFactory } from "@portalai/core/models";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { DbService } from "../../../services/db.service.js";
import { DemoSeedService } from "../../../services/demo-seed.service.js";
import { SeedService } from "../../../services/seed.service.js";
import type { PermissionContext } from "../../../services/permission.service.js";
import { StationContextTool } from "../../../tools/station-context.tool.js";
import {
  createUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
} from "../utils/application.util.js";

type Out = {
  organization: { name: string; plan: { slug: string; displayName: string } };
  status: { situation: string; hasRecords: boolean };
  stations?: { items: Array<{ name: string }>; totalCount: number };
};

async function run(
  stationId: string,
  ctx: PermissionContext,
  include?: string[]
): Promise<Out> {
  const t = new StationContextTool().build(
    stationId,
    ctx.organizationId,
    ctx.userId,
    ctx
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the AI SDK tool's execute signature isn't exported in a usable form
  return (await (t as any).execute(include ? { include } : {}, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  })) as Out;
}

describe("station_context (integration, #1050)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await new SeedService().seedConnectorDefinitions(db);
  });

  afterEach(async () => {
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  async function station(
    organizationId: string,
    createdBy: string,
    name: string
  ) {
    return DbService.repository.stations.create(
      new StationModelFactory()
        .create(createdBy)
        .update({ organizationId, name, description: `${name} station` })
        .parse()
    );
  }

  it("lists only the stations the caller can read", async () => {
    const f = await seedTenancyFixture(db as ReturnType<typeof drizzle>, {
      owner: `auth0|${generateId()}`,
      member: `auth0|${generateId()}`,
      otherOwner: `auth0|${generateId()}`,
    });
    const ownerPrivate = await station(f.orgId, f.ownerId, "Owner Private");
    const memberOwn = await station(f.orgId, f.memberId, "Member Own");
    await station(f.otherOrgId, f.otherOwnerId, "Other Org");

    const asMember = await run(
      memberOwn.id,
      { userId: f.memberId, organizationId: f.orgId, roles: ["member"] },
      ["stations"]
    );
    const memberNames = asMember.stations!.items.map((s) => s.name);
    expect(memberNames).toContain("Member Own");
    expect(memberNames).not.toContain("Owner Private");
    expect(memberNames).not.toContain("Other Org");

    const asOwner = await run(
      ownerPrivate.id,
      { userId: f.ownerId, organizationId: f.orgId, roles: ["owner"] },
      ["stations"]
    );
    const ownerNames = asOwner.stations!.items.map((s) => s.name);
    expect(ownerNames).toEqual(
      expect.arrayContaining(["Owner Private", "Member Own"])
    );
    expect(ownerNames).not.toContain("Other Org");
    expect(asOwner.stations!.totalCount).toBe(asOwner.stations!.items.length);
  });

  it("reports the organization, and whether the station has records as they land", async () => {
    const owner = createUser(`auth0|${generateId()}`);
    await db.insert(schema.users).values(owner as never);
    const name = `Status ${generateId()}`;
    const { organizationId, stationId } =
      await ApplicationService.createDemoOrganization({
        ownerEmail: owner.email,
        name,
        tier: "standard",
      });
    const ctx: PermissionContext = {
      userId: owner.id,
      organizationId,
      roles: ["owner"],
    };

    const before = await run(stationId, ctx);
    expect(before.organization).toEqual({
      name,
      plan: { slug: "standard", displayName: expect.any(String) },
    });
    expect(before.status.hasRecords).toBe(false);
    expect(before.stations).toBeUndefined();

    await DemoSeedService.seed({ orgId: organizationId, stationId, rows: 0 });

    const after = await run(stationId, ctx);
    expect(after.status.hasRecords).toBe(true);
  }, 90000);
});
