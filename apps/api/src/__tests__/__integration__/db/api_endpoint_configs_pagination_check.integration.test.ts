/**
 * Verifies the phase-3 widening of the `api_endpoint_configs.pagination`
 * CHECK constraint. After migration 0058 the allowed values are the
 * closed set {none, pageOffset, cursor, linkHeader}; anything else is
 * rejected at the database layer.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|ci-test-pagination-check";

let connection!: ReturnType<typeof postgres>;
let db!: ReturnType<typeof drizzle>;
let orgId: string;
let userId: string;
let connectorEntityId: string;

async function seedEntity(): Promise<string> {
  // Seed a connector definition + instance + entity so the FK columns
  // on api_endpoint_configs are satisfied. The pagination CHECK fires
  // before the FK check, so the only thing that matters here is having
  // a real connector_entity_id to insert against.
  const defId = generateId();
  await db.insert(schema.connectorDefinitions).values({
    id: defId,
    slug: "rest-api",
    display: "REST API",
    category: "api",
    authType: "multi",
    configSchema: null,
    capabilityFlags: { sync: true, read: true },
    isActive: true,
    version: "0.1.0",
    iconUrl: null,
    created: Date.now(),
    createdBy: userId,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);

  const instanceId = generateId();
  await db.insert(schema.connectorInstances).values({
    id: instanceId,
    connectorDefinitionId: defId,
    organizationId: orgId,
    name: "Test",
    status: "active",
    config: { baseUrl: "https://api.example.com", auth: { mode: "none" } },
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
  } as never);

  const entityId = generateId();
  await db.insert(schema.connectorEntities).values({
    id: entityId,
    organizationId: orgId,
    connectorInstanceId: instanceId,
    key: `e-${entityId.slice(0, 8)}`,
    label: "Entity",
    created: Date.now(),
    createdBy: userId,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);

  return entityId;
}

async function insertConfig(pagination: string) {
  const id = generateId();
  await db.insert(schema.apiEndpointConfigs).values({
    id,
    organizationId: orgId,
    connectorEntityId,
    path: "/x",
    method: "GET",
    headers: null,
    queryParams: null,
    bodyTemplate: null,
    pagination,
    paginationConfig: null,
    recordsPath: "",
    idField: null,
    created: Date.now(),
    createdBy: userId,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);
  return id;
}

beforeEach(async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  connection = postgres(process.env.DATABASE_URL, { max: 1 });
  db = drizzle(connection, { schema });

  await teardownOrg(db);
  const seed = await seedUserAndOrg(db, AUTH0_ID);
  orgId = seed.organizationId;
  userId = seed.userId;
  connectorEntityId = await seedEntity();
});

afterEach(async () => {
  await connection.end();
});

describe("api_endpoint_configs_pagination_check (phase 3)", () => {
  it("accepts 'none' (phase 1 baseline)", async () => {
    await expect(insertConfig("none")).resolves.toBeDefined();
  });

  it("accepts 'pageOffset' (phase 3 widening)", async () => {
    await expect(insertConfig("pageOffset")).resolves.toBeDefined();
  });

  it("accepts 'cursor' (phase 3 widening)", async () => {
    await expect(insertConfig("cursor")).resolves.toBeDefined();
  });

  it("accepts 'linkHeader' (phase 3 widening)", async () => {
    await expect(insertConfig("linkHeader")).resolves.toBeDefined();
  });

  it("rejects unknown strategies", async () => {
    await expect(insertConfig("rfc5988")).rejects.toThrow();
  });

  it("the constraint is named api_endpoint_configs_pagination_check (phase-1 name removed)", async () => {
    const rows = await db.execute<{ conname: string }>(sql`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'api_endpoint_configs'::regclass
        AND contype = 'c'
        AND conname LIKE 'api_endpoint_configs_pagination%'
    `);
    const names = (rows as unknown as Array<{ conname: string }>).map(
      (r) => r.conname
    );
    expect(names).toContain("api_endpoint_configs_pagination_check");
    expect(names).not.toContain("api_endpoint_configs_pagination_phase1_check");
  });
});
