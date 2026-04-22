/**
 * Integration tests for the C2 schema change — `connector_entities`
 * carries a partial unique index on `(organization_id, key)` where
 * `deleted IS NULL`. The tests assert the DB-layer guarantees so that
 * repository/service tests can rely on them.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

type Db = ReturnType<typeof drizzle>;

const now = Date.now();

async function seedConnectorDefinition(db: Db): Promise<string> {
  const id = generateId();
  await db.insert(schema.connectorDefinitions).values({
    id,
    slug: `c2-schema-${id.slice(0, 8)}`,
    display: "C2 Schema",
    category: "file",
    authType: "none",
    configSchema: {},
    capabilityFlags: { read: true },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);
  return id;
}

async function seedConnectorInstance(
  db: Db,
  organizationId: string,
  definitionId: string,
  name: string
): Promise<string> {
  const id = generateId();
  await db.insert(schema.connectorInstances).values({
    id,
    organizationId,
    connectorDefinitionId: definitionId,
    name,
    status: "active",
    enabledCapabilityFlags: { read: true },
    config: null,
    credentials: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);
  return id;
}

function entityRow(
  organizationId: string,
  connectorInstanceId: string,
  key: string,
  deleted: number | null = null
) {
  return {
    id: generateId(),
    organizationId,
    connectorInstanceId,
    key,
    label: key,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted,
    deletedBy: null,
  };
}

describe("connector_entities — C2 org-wide unique key", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set — setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("rejects two live rows with the same (organization_id, key) in different connectors", async () => {
    const seed = await seedUserAndOrg(db, `auth0|${generateId()}`);
    const defId = await seedConnectorDefinition(db);
    const instA = await seedConnectorInstance(
      db,
      seed.organizationId,
      defId,
      "A"
    );
    const instB = await seedConnectorInstance(
      db,
      seed.organizationId,
      defId,
      "B"
    );
    await db
      .insert(schema.connectorEntities)
      .values(entityRow(seed.organizationId, instA, "contacts") as never);
    // Drizzle wraps the underlying PG error; assert by PG SQLSTATE 23505
    // (unique_violation) on the cause rather than the wrapper message.
    try {
      await db
        .insert(schema.connectorEntities)
        .values(entityRow(seed.organizationId, instB, "contacts") as never);
      throw new Error("expected unique-violation but insert succeeded");
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause;
      expect(cause?.code).toBe("23505");
    }
  });

  it("allows the same key across different organizations", async () => {
    const seedA = await seedUserAndOrg(db, `auth0|${generateId()}`);
    const seedB = await seedUserAndOrg(db, `auth0|${generateId()}`);
    const defId = await seedConnectorDefinition(db);
    const instA = await seedConnectorInstance(
      db,
      seedA.organizationId,
      defId,
      "A"
    );
    const instB = await seedConnectorInstance(
      db,
      seedB.organizationId,
      defId,
      "B"
    );
    await db
      .insert(schema.connectorEntities)
      .values(entityRow(seedA.organizationId, instA, "contacts") as never);
    await db
      .insert(schema.connectorEntities)
      .values(entityRow(seedB.organizationId, instB, "contacts") as never);
    // No throw — cross-org collisions are fine.
  });

  it("permits reusing a key whose prior owner is soft-deleted", async () => {
    const seed = await seedUserAndOrg(db, `auth0|${generateId()}`);
    const defId = await seedConnectorDefinition(db);
    const instA = await seedConnectorInstance(
      db,
      seed.organizationId,
      defId,
      "A"
    );
    const instB = await seedConnectorInstance(
      db,
      seed.organizationId,
      defId,
      "B"
    );
    await db
      .insert(schema.connectorEntities)
      .values(entityRow(seed.organizationId, instA, "reusable", now) as never);
    await db
      .insert(schema.connectorEntities)
      .values(entityRow(seed.organizationId, instB, "reusable") as never);
    // No throw — partial index ignores soft-deleted rows.
  });
});
