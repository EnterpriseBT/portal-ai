/**
 * Integration tests for `OrganizationUpdateService.apply` (#907): only the
 * fields sent are written, the replaced name comes back, and a deleted org is
 * a 404. The concurrent-rename case lives with the route
 * (`organization.router.integration.test.ts`).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { OrganizationUpdateService } from "../../../services/organization-update.service.js";
import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

type Db = ReturnType<typeof drizzle>;

describe("OrganizationUpdateService.apply (#907)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let orgId!: string;
  let userId!: string;
  let stationId!: string;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
  });

  afterAll(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  beforeEach(async () => {
    await teardownOrg(db);
    ({ organizationId: orgId, userId } = await seedUserAndOrg(
      db,
      "auth0|org-update"
    ));
    stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Default station",
      description: null,
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await db
      .update(schema.organizations)
      .set({ name: "Acme", defaultStationId: stationId })
      .where(eq(schema.organizations.id, orgId));
  });

  it("writes a name alone, leaving the default station, and returns the replaced name", async () => {
    const { organization, previousName } =
      await OrganizationUpdateService.apply(
        orgId,
        { name: "Acme Corp" },
        userId
      );
    expect(previousName).toBe("Acme");
    expect(organization.name).toBe("Acme Corp");
    expect(organization.defaultStationId).toBe(stationId);
    expect(organization.updatedBy).toBe(userId);
  });

  it("writes a station alone, leaving the name", async () => {
    const { organization } = await OrganizationUpdateService.apply(
      orgId,
      { defaultStationId: null },
      userId
    );
    expect(organization.name).toBe("Acme");
    expect(organization.defaultStationId).toBeNull();
  });

  it("answers 404 for a deleted organization", async () => {
    await db
      .update(schema.organizations)
      .set({ deleted: Date.now() })
      .where(eq(schema.organizations.id, orgId));
    const error = await OrganizationUpdateService.apply(
      orgId,
      { name: "Acme Corp" },
      userId
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(ApiCode.ORGANIZATION_NOT_FOUND);
  });
});
