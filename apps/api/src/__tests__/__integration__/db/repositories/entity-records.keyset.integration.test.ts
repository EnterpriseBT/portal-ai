/**
 * Integration tests for keyset seeking on the entity-record list (#433).
 *
 * Offset pagination cannot be made cheap at depth — measured on app-dev, a
 * keyset seek and an OFFSET jump to the same position, both ordering by an
 * already-indexed column, took 21ms and 24,457ms respectively. The planner
 * abandons the index once the offset is large and falls back to a
 * seq-scan hash join with a disk-spilling merge. So the list seeks.
 *
 * The mechanism itself — composite `(sortKey, id)` paging with no skips or
 * duplicates, even under concurrent inserts — is already proven by
 * `keyset-cursor-stability.integration.test.ts` (#129). What is new here,
 * and what these tests exist for, is the part that spike did not cover:
 *
 *  - a **nullable** sort column, where row-value comparison (`(col, id) >
 *    (v, i)`) is simply wrong. NULL comparisons yield NULL, so every row in
 *    the NULL region silently fails the predicate and vanishes from the walk.
 *  - **descending** order, where the seek and the tiebreaker both invert.
 *
 * The fixture mirrors the shape that made this real: on app-dev `c_city`
 * has 19 distinct values and 3,914 NULLs across 283,000 rows, so both heavy
 * ties and a populated NULL region are the normal case, not an edge case.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import {
  EntityRecordsRepository,
  type EntityRecordHydratedListItem,
} from "../../../../db/repositories/entity-records.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import { WideTableReconcilerService } from "../../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../../services/wide-table-statement.cache.js";
import { buildSortExpression } from "../../../../utils/filter-sql.util.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

/** Cities laid out to force ties AND a NULL region, like the real data. */
const CITY_FIXTURE: Array<string | null> = [
  "Boston",
  "Boston",
  "Boston",
  "Austin",
  "Austin",
  "Chicago",
  null,
  null,
  null,
  "Denver",
  "Austin",
  null,
];

describe("EntityRecords keyset seeking (#433)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: EntityRecordsRepository;
  let reconciler: WideTableReconcilerService;
  let orgId: string;
  let entityId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new EntityRecordsRepository();
    reconciler = new WideTableReconcilerService();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const dbTyped = db as ReturnType<typeof drizzle>;
    const now = Date.now();

    const user = createUser(`auth0|${generateId()}`);
    await dbTyped.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await dbTyped.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `keyset-${generateId().slice(0, 8)}`,
      display: "Keyset",
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

    const ciId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: ciId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Keyset",
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
    await dbTyped.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId: ciId,
      key: `parcels_${generateId().slice(0, 6)}`,
      label: "Parcels",
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // One nullable string column: `city`.
    const cdCity = generateId();
    await dbTyped.insert(schema.columnDefinitions).values({
      id: cdCity,
      organizationId: orgId,
      key: "city",
      label: "City",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      system: false,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    await dbTyped.insert(schema.fieldMappings).values({
      id: generateId(),
      organizationId: orgId,
      connectorEntityId: entityId,
      columnDefinitionId: cdCity,
      sourceField: "City",
      isPrimaryKey: false,
      normalizedKey: "city",
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    await reconciler.reconcileEntity(entityId, db);
    await seedRecords();
  });

  afterEach(async () => {
    await reconciler.dropTable(entityId, db).catch(() => undefined);
    wideTableStatementCache.clear();
    await connection.end();
  });

  /**
   * Insert the fixture. All rows share one `created` value so the
   * `created`-ordered walk exercises a fully tied sort key too.
   */
  async function seedRecords(): Promise<void> {
    const dbTyped = db as ReturnType<typeof drizzle>;
    const tied = Date.now();
    for (let i = 0; i < CITY_FIXTURE.length; i++) {
      const id = generateId();
      const sourceId = `src-${String(i).padStart(3, "0")}`;
      await dbTyped.insert(schema.entityRecords).values({
        id,
        organizationId: orgId,
        connectorEntityId: entityId,
        data: {},
        sourceId,
        checksum: "c",
        syncedAt: tied,
        origin: "sync",
        validationErrors: null,
        isValid: true,
        created: tied,
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
      await dbTyped.execute(
        sql`INSERT INTO ${sql.identifier(`er__${entityId}`)}
            ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_city")
            VALUES (${id}, ${orgId}, ${tied}, true, ${sourceId}, ${CITY_FIXTURE[i]})`
      );
    }
  }

  async function cityColumn() {
    const stmt = await wideTableStatementCache.get(entityId, db);
    const expr = buildSortExpression(stmt, "city");
    if (!expr) throw new Error("city column not resolvable");
    return expr;
  }

  /**
   * Walk the whole entity by keyset, `pageSize` rows at a time, returning
   * the ids in the order they were seen. `readValue` pulls the sort key's
   * value off a row — that value plus the row's id is the cursor.
   */
  async function drain(opts: {
    column:
      | Awaited<ReturnType<typeof cityColumn>>
      | typeof schema.entityRecords.created;
    nullable: boolean;
    direction: "asc" | "desc";
    pageSize: number;
    readValue: (row: Record<string, unknown>) => string | number | null;
  }): Promise<string[]> {
    const seen: string[] = [];
    let anchor: { value: string | number | null; id: string } | null = null;

    for (;;) {
      const page: EntityRecordHydratedListItem[] = await repo.findHydratedMany(
        entityId,
        {
          limit: opts.pageSize,
          orderBy: { column: opts.column, direction: opts.direction },
          includeData: false,
          keyset: anchor
            ? {
                column: opts.column,
                value: anchor.value,
                id: anchor.id,
                nullable: opts.nullable,
              }
            : undefined,
        },
        db
      );
      if (page.length === 0) break;
      seen.push(...page.map((r) => r.id));
      const last = page[page.length - 1];
      anchor = {
        value: opts.readValue(last as unknown as Record<string, unknown>),
        id: last.id,
      };
      if (page.length < opts.pageSize) break;
    }
    return seen;
  }

  /** The same walk done with OFFSET, as the reference sequence. */
  async function drainByOffset(opts: {
    column:
      | Awaited<ReturnType<typeof cityColumn>>
      | typeof schema.entityRecords.created;
    direction: "asc" | "desc";
  }): Promise<string[]> {
    const rows = await repo.findHydratedMany(
      entityId,
      {
        orderBy: { column: opts.column, direction: opts.direction },
        includeData: false,
      },
      db
    );
    return rows.map((r) => r.id);
  }

  const readCity = (row: Record<string, unknown>) =>
    ((row.normalizedData as Record<string, unknown>)?.city ?? null) as
      | string
      | null;
  const readCreated = (row: Record<string, unknown>) => row.created as number;

  // ── Non-nullable sort key ────────────────────────────────────────

  it("walks a NOT NULL sort column exactly once, ascending", async () => {
    const expected = await drainByOffset({
      column: schema.entityRecords.created,
      direction: "asc",
    });
    const seen = await drain({
      column: schema.entityRecords.created,
      nullable: false,
      direction: "asc",
      pageSize: 5,
      readValue: readCreated,
    });

    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(CITY_FIXTURE.length);
  });

  it("walks a NOT NULL sort column exactly once, descending", async () => {
    const expected = await drainByOffset({
      column: schema.entityRecords.created,
      direction: "desc",
    });
    const seen = await drain({
      column: schema.entityRecords.created,
      nullable: false,
      direction: "desc",
      pageSize: 5,
      readValue: readCreated,
    });

    expect(seen).toEqual(expected);
  });

  // ── Nullable sort key — the regression case ──────────────────────

  it("walks a nullable sort column exactly once, ascending across the NULL boundary", async () => {
    const column = await cityColumn();
    const expected = await drainByOffset({ column, direction: "asc" });
    const seen = await drain({
      column,
      nullable: true,
      direction: "asc",
      pageSize: 5,
      readValue: readCity,
    });

    // Every row, once — nothing lost in the NULL region.
    expect(new Set(seen).size).toBe(CITY_FIXTURE.length);
    expect(seen).toHaveLength(CITY_FIXTURE.length);
    expect(seen).toEqual(expected);
  });

  it("walks a nullable sort column exactly once, descending across the NULL boundary", async () => {
    const column = await cityColumn();
    const expected = await drainByOffset({ column, direction: "desc" });
    const seen = await drain({
      column,
      nullable: true,
      direction: "desc",
      pageSize: 5,
      readValue: readCity,
    });

    expect(new Set(seen).size).toBe(CITY_FIXTURE.length);
    expect(seen).toEqual(expected);
  });

  it("reaches the NULL rows at all — they are not silently dropped", async () => {
    const column = await cityColumn();
    const seen = await drain({
      column,
      nullable: true,
      direction: "asc",
      pageSize: 3,
      readValue: readCity,
    });

    // This is the failure mode row-value comparison produces: `(col, id) >
    // (v, i)` is NULL for every NULL-city row, so they never satisfy the
    // predicate and the walk ends early with them missing.
    const nullCount = CITY_FIXTURE.filter((c) => c === null).length;
    expect(nullCount).toBeGreaterThan(0);
    expect(seen).toHaveLength(CITY_FIXTURE.length);
  });

  it("agrees with offset pagination page for page", async () => {
    const column = await cityColumn();
    const pageSize = 4;
    const byKeyset = await drain({
      column,
      nullable: true,
      direction: "asc",
      pageSize,
      readValue: readCity,
    });

    const byOffset: string[] = [];
    for (let offset = 0; offset < CITY_FIXTURE.length; offset += pageSize) {
      const page = await repo.findHydratedMany(
        entityId,
        {
          limit: pageSize,
          offset,
          orderBy: { column, direction: "asc" },
          includeData: false,
        },
        db
      );
      byOffset.push(...page.map((r) => r.id));
    }

    expect(byKeyset).toEqual(byOffset);
  });
});
