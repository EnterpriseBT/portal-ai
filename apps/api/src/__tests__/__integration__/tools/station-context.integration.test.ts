/**
 * Integration tests for `station_context`'s #1050 sections against the test
 * database: `organization` names the org and its plan, and `status` reports a
 * station's records as they land.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { DemoSeedService } from "../../../services/demo-seed.service.js";
import { SeedService } from "../../../services/seed.service.js";
import { StationContextTool } from "../../../tools/station-context.tool.js";
import {
  createUser,
  generateId,
  teardownOrg,
} from "../utils/application.util.js";

type Out = {
  organization: { name: string; plan: { slug: string; displayName: string } };
  status: { situation: string; hasRecords: boolean };
};

async function run(
  stationId: string,
  organizationId: string,
  userId: string
): Promise<Out> {
  const t = new StationContextTool().build(stationId, organizationId, userId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the AI SDK tool's execute signature isn't exported in a usable form
  return (await (t as any).execute(
    {},
    {
      toolCallId: "t",
      messages: [],
      abortSignal: new AbortController().signal,
    }
  )) as Out;
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

    const before = await run(stationId, organizationId, owner.id);
    expect(before.organization).toEqual({
      name,
      plan: { slug: "standard", displayName: expect.any(String) },
    });
    expect(before.status.hasRecords).toBe(false);

    await DemoSeedService.seed({ orgId: organizationId, stationId, rows: 0 });

    const after = await run(stationId, organizationId, owner.id);
    expect(after.status.hasRecords).toBe(true);
  }, 90000);
});
