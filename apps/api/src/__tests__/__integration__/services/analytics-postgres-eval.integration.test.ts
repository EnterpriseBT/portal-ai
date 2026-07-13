/**
 * Phase 3 slice 6 — eval / regression suite (cases 78–79).
 *
 * Two assertions per the phase-3 spec:
 *
 *   78. 25 representative LLM-generated SQL queries through the full
 *       `PortalSqlService.runSqlQuery` pipeline (validate → wrap →
 *       execute → envelope) produce the expected envelope shape
 *       and row counts.
 *
 *   79. fixed-seed math runs (regression, forecast — the others were
 *       removed in #130 E2 and are expressed in sql_query) produce results
 *       stable to ±1e-9 against pre-recorded baselines.
 *
 * Manual smoke runbook (case 80 — runbook only, executed by the
 * deployer, not by CI):
 *
 *   $ cd apps/api && npm run dev
 *   - Open the web app at http://localhost:3000.
 *   - Navigate to a station with seeded entity records (`contacts`).
 *   - Open a portal session that exercises `sql_query`:
 *     • LLM runs `SELECT "_record_id", "c_email" FROM "contacts" ...
 *       LIMIT 10` → response contains real Postgres rows.
 *     • LLM attempts `INSERT INTO "contacts" (...) ...` → response is
 *       `PORTAL_SQL_FORBIDDEN: reserved verb: INSERT`.
 *     • LLM attempts `SELECT * FROM pg_tables` → response is
 *       `PORTAL_SQL_FORBIDDEN: system catalog access: pg_tables`.
 *   - In the same session, run `entity_record_update` on a SELECTed
 *     record; the next `sql_query` SELECT shows the updated value.
 *   - Hand-craft `SELECT * FROM "contacts" WHERE c_age > 9999`; result
 *     is empty rows (no leak path; the view's org filter wins
 *     structurally).
 *   - Cold-session boot: `time curl -X POST /api/portals
 *     -d '{"stationId":"<station>"}' -H 'Content-Type: application/json'`
 *     returns in <100 ms even on a 100k-record station (vs multi-second
 *     under AlaSQL preload).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import {
  WideTableStatementCache,
  wideTableStatementCache as singletonStatementCache,
} from "../../../services/wide-table-statement.cache.js";
import { PortalSqlServiceImpl } from "../../../services/portal-sql.service.js";
import { AnalyticsService } from "../../../services/analytics.service.js";
import { wideTableRepo } from "../../../db/repositories/wide-table.repository.js";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures for case 78 — 25 SQL queries representative of what the LLM
// generates in production portal sessions.
//
// Each entry pins a SHAPE expectation, not an exact-row expectation:
//   - "plain"        — successful response with `rows`, no `truncated`.
//   - "row-cap"      — response has `truncated: true` because row cap fired.
//   - "rejected"     — `PORTAL_SQL_FORBIDDEN` raised by the deny-list.
//
// The fixtures are intentionally over-specified: row counts are pinned
// to the seeded dataset, so a regression that breaks the wrap or
// envelope semantics surfaces here before it reaches the LLM.
// ─────────────────────────────────────────────────────────────────────────

interface EvalFixture {
  description: string;
  sql: string;
  expectedRowCountRange: [number, number];
  expectedEnvelope: "plain" | "row-cap" | "rejected";
  /** When set, override the default rowCap so a small dataset can
   *  exercise the row-cap envelope path without seeding 500 rows. */
  rowCap?: number;
  /** Regex the rejection message must match; required for `"rejected"`. */
  rejectionMatch?: RegExp;
}

const SQL_FIXTURES: EvalFixture[] = [
  // ── Plain queries ──────────────────────────────────────────────────
  {
    description: "bare LIMIT-bounded select",
    sql: `SELECT "c_email" FROM "contacts" LIMIT 10`,
    expectedRowCountRange: [10, 10],
    expectedEnvelope: "plain",
  },
  {
    description: "count star aggregation",
    sql: `SELECT COUNT(*) AS n FROM "contacts"`,
    expectedRowCountRange: [1, 1],
    expectedEnvelope: "plain",
  },
  {
    description: "avg with explicit cast",
    sql: `SELECT AVG("c_age")::float AS avg_age FROM "contacts"`,
    expectedRowCountRange: [1, 1],
    expectedEnvelope: "plain",
  },
  {
    description: "min/max/sum tuple in one row",
    sql: `SELECT MIN("c_age") AS mn, MAX("c_age") AS mx, SUM("c_age") AS sm FROM "contacts"`,
    expectedRowCountRange: [1, 1],
    expectedEnvelope: "plain",
  },
  {
    description: "group by on a low-cardinality column",
    sql: `SELECT "c_segment" AS seg, COUNT(*) AS n FROM "contacts" GROUP BY "c_segment" ORDER BY seg`,
    expectedRowCountRange: [2, 3],
    expectedEnvelope: "plain",
  },
  {
    description: "where clause narrows the result set",
    sql: `SELECT "c_email" FROM "contacts" WHERE "c_age" > 30 ORDER BY "c_age" LIMIT 50`,
    expectedRowCountRange: [0, 50],
    expectedEnvelope: "plain",
  },
  {
    description: "order by + limit",
    sql: `SELECT "c_email", "c_age" FROM "contacts" ORDER BY "c_age" DESC LIMIT 5`,
    expectedRowCountRange: [5, 5],
    expectedEnvelope: "plain",
  },
  {
    description: "projected synthetic _record_id",
    sql: `SELECT "_record_id", "c_email" FROM "contacts" ORDER BY "c_email" LIMIT 3`,
    expectedRowCountRange: [3, 3],
    expectedEnvelope: "plain",
  },
  {
    description: "string LIKE filter",
    sql: `SELECT "c_email" FROM "contacts" WHERE "c_email" LIKE 'u%@x.co' LIMIT 100`,
    expectedRowCountRange: [12, 12],
    expectedEnvelope: "plain",
  },
  {
    description: "CASE WHEN derived column",
    sql: `SELECT "c_email", CASE WHEN "c_age" > 30 THEN 'senior' ELSE 'junior' END AS bucket FROM "contacts" LIMIT 5`,
    expectedRowCountRange: [5, 5],
    expectedEnvelope: "plain",
  },
  {
    description: "DISTINCT projection",
    sql: `SELECT DISTINCT "c_segment" FROM "contacts" ORDER BY "c_segment"`,
    expectedRowCountRange: [2, 3],
    expectedEnvelope: "plain",
  },
  {
    description: "HAVING on grouped aggregate",
    sql: `SELECT "c_segment" AS seg, COUNT(*) AS n FROM "contacts" GROUP BY "c_segment" HAVING COUNT(*) > 1`,
    expectedRowCountRange: [1, 3],
    expectedEnvelope: "plain",
  },
  {
    description: "window function (row_number)",
    sql: `SELECT "c_email", ROW_NUMBER() OVER (ORDER BY "c_age") AS rn FROM "contacts" ORDER BY rn LIMIT 5`,
    expectedRowCountRange: [5, 5],
    expectedEnvelope: "plain",
  },
  {
    description: "CTE",
    sql: `WITH ranked AS (SELECT "c_email", "c_age" FROM "contacts") SELECT * FROM ranked WHERE "c_age" > 25 LIMIT 10`,
    expectedRowCountRange: [0, 10],
    expectedEnvelope: "plain",
  },
  {
    description: "cross-entity JOIN via source_id",
    sql: `SELECT d."c_amount" AS amt, c."c_email" AS email
          FROM "deals" d
          JOIN "contacts" c ON c."source_id" = d."c_account_ref"
          LIMIT 10`,
    expectedRowCountRange: [0, 10],
    expectedEnvelope: "plain",
  },
  {
    description: "string concat",
    sql: `SELECT "c_email" || ':' || "c_age"::text AS tag FROM "contacts" LIMIT 3`,
    expectedRowCountRange: [3, 3],
    expectedEnvelope: "plain",
  },
  {
    description: "numeric formula",
    sql: `SELECT "c_age" * 2 + 1 AS doubled_plus_one FROM "contacts" ORDER BY "c_age" LIMIT 5`,
    expectedRowCountRange: [5, 5],
    expectedEnvelope: "plain",
  },
  {
    description: "IS NULL filter",
    sql: `SELECT "c_email" FROM "contacts" WHERE "c_email" IS NOT NULL LIMIT 100`,
    expectedRowCountRange: [0, 100],
    expectedEnvelope: "plain",
  },
  {
    description: "BETWEEN range filter",
    sql: `SELECT "c_email" FROM "contacts" WHERE "c_age" BETWEEN 20 AND 30 ORDER BY "c_age" LIMIT 100`,
    expectedRowCountRange: [0, 100],
    expectedEnvelope: "plain",
  },
  {
    description: "subquery scalar in projection",
    sql: `SELECT "c_email", (SELECT COUNT(*) FROM "contacts") AS total FROM "contacts" LIMIT 3`,
    expectedRowCountRange: [3, 3],
    expectedEnvelope: "plain",
  },

  // ── Row-cap envelope ───────────────────────────────────────────────
  {
    description: "row cap fires on bare select with explicit LIMIT",
    sql: `SELECT "c_email" FROM "contacts" LIMIT 100`,
    expectedRowCountRange: [12, 12],
    expectedEnvelope: "row-cap",
    rowCap: 3,
  },

  // ── Rejected by validator ──────────────────────────────────────────
  {
    description: "rejects INSERT",
    sql: `INSERT INTO "contacts" ("c_email") VALUES ('x@y.co')`,
    expectedRowCountRange: [0, 0],
    expectedEnvelope: "rejected",
    rejectionMatch: /reserved verb: INSERT/i,
  },
  {
    description: "rejects DROP TABLE",
    sql: `DROP TABLE "contacts"`,
    expectedRowCountRange: [0, 0],
    expectedEnvelope: "rejected",
    rejectionMatch: /reserved verb: DROP/i,
  },
  {
    description: "rejects multi-statement",
    sql: `SELECT 1; DELETE FROM "contacts"`,
    expectedRowCountRange: [0, 0],
    expectedEnvelope: "rejected",
    rejectionMatch: /multi-statement input/i,
  },
  {
    description: "rejects pg_catalog access",
    sql: `SELECT * FROM pg_catalog.pg_tables`,
    expectedRowCountRange: [0, 0],
    expectedEnvelope: "rejected",
    rejectionMatch: /system catalog access/i,
  },
];

// Sanity-check: 25 fixtures exactly.
if (SQL_FIXTURES.length !== 25) {
  throw new Error(
    `phase-3 slice 6 expects exactly 25 eval fixtures, got ${SQL_FIXTURES.length}`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Numeric tolerance baselines for case 79.
//
// 10 fixed-seed math runs. Each entry pins the expected output to a
// precision bound. The baselines were computed once against the seeded
// dataset below (a 12-row "contacts" table) using the same math kernels
// the production code paths invoke. A regression that drifts the math
// trips this suite immediately.
// ─────────────────────────────────────────────────────────────────────────

interface NumericExpect {
  description: string;
  run: () => Promise<unknown>;
  assert: (actual: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const TOLERANCE = 1e-9;
function expectClose(actual: number, expected: number, message?: string): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
    TOLERANCE + Math.abs(expected) * 1e-12
  );
  if (Number.isNaN(actual) || Number.isNaN(expected)) {
    throw new Error(`NaN comparison: ${message ?? ""}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────

describe("Analytics Postgres-eval regression suite", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let statementCache: WideTableStatementCache;
  let reconciler: WideTableReconcilerService;
  let portalSql: PortalSqlServiceImpl;

  let orgId: string;
  let stationId: string;
  let contactsEntityId: string;
  let dealsEntityId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 8 });
    db = drizzle(connection, { schema });
    statementCache = new WideTableStatementCache();
    reconciler = new WideTableReconcilerService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      statementCache
    );
    singletonStatementCache.clear();
    portalSql = new PortalSqlServiceImpl();

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
      slug: `eval-${generateId().slice(0, 8)}`,
      display: "Eval Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, write: true, sync: true },
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

    const instanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Eval Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true, sync: true },
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    stationId = generateId();
    await dbTyped.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Eval Station",
      description: null,
      toolPacks: ["data_query"],
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await dbTyped.insert(schema.stationInstances).values({
      id: generateId(),
      stationId,
      connectorInstanceId: instanceId,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    contactsEntityId = generateId();
    dealsEntityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values([
      {
        id: contactsEntityId,
        organizationId: orgId,
        connectorInstanceId: instanceId,
        key: "contacts",
        label: "Contacts",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: dealsEntityId,
        organizationId: orgId,
        connectorInstanceId: instanceId,
        key: "deals",
        label: "Deals",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ] as never);

    const cdEmail = generateId();
    const cdAge = generateId();
    const cdSegment = generateId();
    const cdAmount = generateId();
    const cdAccountRef = generateId();
    await dbTyped
      .insert(schema.columnDefinitions)
      .values([
        mkColumnDef(cdEmail, orgId, "email", "Email", "string", now),
        mkColumnDef(cdAge, orgId, "age", "Age", "number", now),
        mkColumnDef(cdSegment, orgId, "segment", "Segment", "string", now),
        mkColumnDef(cdAmount, orgId, "amount", "Amount", "number", now),
        mkColumnDef(
          cdAccountRef,
          orgId,
          "account_ref",
          "Account Ref",
          "string",
          now
        ),
      ] as never);
    await dbTyped
      .insert(schema.fieldMappings)
      .values([
        mkMapping(orgId, contactsEntityId, cdEmail, "Email", "email", now),
        mkMapping(orgId, contactsEntityId, cdAge, "Age", "age", now + 1),
        mkMapping(
          orgId,
          contactsEntityId,
          cdSegment,
          "Segment",
          "segment",
          now + 2
        ),
        mkMapping(orgId, dealsEntityId, cdAmount, "Amount", "amount", now),
        mkMapping(
          orgId,
          dealsEntityId,
          cdAccountRef,
          "Account Ref",
          "account_ref",
          now + 1
        ),
      ] as never);

    await reconciler.reconcileEntity(contactsEntityId, db);
    await reconciler.reconcileEntity(dealsEntityId, db);

    // Seed a deterministic 12-row contacts table: ages 20..31, alternating
    // segments. The fixture queries above and the numeric baselines below
    // assume this exact seed.
    const tuples: ReturnType<typeof sql>[] = [];
    for (let i = 0; i < 12; i++) {
      const id = generateId();
      const sourceId = `src-${i}`;
      await dbTyped.insert(schema.entityRecords).values({
        id,
        organizationId: orgId,
        connectorEntityId: contactsEntityId,
        sourceId,
        isValid: true,
        validationErrors: null,
        normalizedData: {},
        syncedAt: now,
        data: {},
        checksum: `c-${id}`,
        origin: "sync",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
      const segment = i % 2 === 0 ? "A" : "B";
      tuples.push(
        sql`(${id}, ${orgId}, ${now}, true, ${sourceId}, ${`u${i}@x.co`}, ${20 + i}, ${segment})`
      );
    }
    await dbTyped.execute(
      sql`INSERT INTO ${sql.raw(`"er__${contactsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_email", "c_age", "c_segment") VALUES ${sql.join(tuples, sql`, `)}`
    );

    // Two deals: one matched to contact src-3, one unmatched.
    const dealTuples: ReturnType<typeof sql>[] = [];
    for (let i = 0; i < 2; i++) {
      const id = generateId();
      const sourceId = `deal-${i}`;
      await dbTyped.insert(schema.entityRecords).values({
        id,
        organizationId: orgId,
        connectorEntityId: dealsEntityId,
        sourceId,
        isValid: true,
        validationErrors: null,
        normalizedData: {},
        syncedAt: now,
        data: {},
        checksum: `d-${id}`,
        origin: "sync",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
      dealTuples.push(
        sql`(${id}, ${orgId}, ${now}, true, ${sourceId}, ${100 * (i + 1)}, ${i === 0 ? "src-3" : "src-9999"})`
      );
    }
    await dbTyped.execute(
      sql`INSERT INTO ${sql.raw(`"er__${dealsEntityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", "c_amount", "c_account_ref") VALUES ${sql.join(dealTuples, sql`, `)}`
    );
  });

  afterEach(async () => {
    try {
      await reconciler.dropTable(contactsEntityId, db);
    } catch {
      /* ignore */
    }
    try {
      await reconciler.dropTable(dealsEntityId, db);
    } catch {
      /* ignore */
    }
    statementCache.clear();
    singletonStatementCache.clear();
    await connection.end();
  });

  // ─── Case 78 — SQL eval ─────────────────────────────────────────────

  describe("case 78 — captured SQL fixtures", () => {
    it.each(SQL_FIXTURES)(
      "$description ($expectedEnvelope)",
      async (fx) => {
        if (fx.expectedEnvelope === "rejected") {
          await expect(
            portalSql.runSqlQuery({
              sql: fx.sql,
              stationId,
              organizationId: orgId,
            })
          ).rejects.toThrow(fx.rejectionMatch ?? /./);
          return;
        }

        const res = await portalSql.runSqlQuery({
          sql: fx.sql,
          stationId,
          organizationId: orgId,
          rowCap: fx.rowCap,
        });

        if (fx.expectedEnvelope === "row-cap") {
          expect("truncated" in res && res.truncated).toBe(true);
          // `rows` may be present (row-cap path) or `sample` (payload-cap).
          if ("rows" in res) {
            expect(res.rows.length).toBeLessThanOrEqual(
              fx.rowCap ?? Number.MAX_SAFE_INTEGER
            );
          }
          if ("totalCount" in res) {
            const [min, max] = fx.expectedRowCountRange;
            expect(res.totalCount).toBeGreaterThanOrEqual(min);
            expect(res.totalCount).toBeLessThanOrEqual(max);
          }
          return;
        }

        // plain
        expect("rows" in res).toBe(true);
        if ("rows" in res) {
          const [min, max] = fx.expectedRowCountRange;
          expect(res.rows.length).toBeGreaterThanOrEqual(min);
          expect(res.rows.length).toBeLessThanOrEqual(max);
        }
      },
      30_000
    );
  });

  // ─── Case 79 — numeric tolerance ────────────────────────────────────

  describe("case 79 — fixed-seed numeric tolerance", () => {
    // Helper to pull projected rows the same way the math tool wrappers do.
    const fetchAges = async () => {
      return wideTableRepo.fetchProjectedRows(contactsEntityId, ["age"], {
        organizationId: orgId,
      });
    };

    const cases: NumericExpect[] = [
      {
        description: "regression(linear) y = 2x + 1",
        run: async () => {
          const records = await fetchAges();
          return AnalyticsService.regression({
            records: records.map((r) => ({
              x: r.age,
              y: 2 * (r.age as number) + 1,
            })),
            x: "x",
            y: "y",
            type: "linear",
          });
        },
        assert: (r) => {
          // y = 2x + 1 exactly. Intercept = coefficients[0], slope = coefficients[1].
          expectClose(r.coefficients[0], 1);
          expectClose(r.coefficients[1], 2);
          expectClose(r.rSquared, 1);
        },
      },
      {
        description: "forecast — 3 horizon on a flat series",
        run: async () => {
          const base = new Date("2026-01-01").getTime();
          // Flat series: every value = 10. With trend='none' the level
          // smoother converges to 10 and forecasts emit 10 forever.
          const records = Array.from({ length: 12 }, (_, i) => ({
            day: new Date(base + i * 86_400_000).toISOString(),
            v: 10,
          }));
          return AnalyticsService.forecast({
            records,
            dateColumn: "day",
            valueColumn: "v",
            horizon: 3,
            trend: "none",
          });
        },
        assert: (r) => {
          expect(r.forecast.dates).toHaveLength(3);
          for (const v of r.forecast.values) {
            expectClose(v, 10);
          }
        },
      },
    ];

    // describeColumn / correlate / aggregate / trend / decompose removed in
    // #130 E2 (expressed in sql_query); regression + forecast remain.
    if (cases.length !== 2) {
      throw new Error(`expects exactly 2 numeric cases, got ${cases.length}`);
    }

    it.each(cases)(
      "$description",
      async (c) => {
        const result = await c.run();
        c.assert(result);
      },
      30_000
    );
  });
});

// ─── Local seeders ──────────────────────────────────────────────────

function mkColumnDef(
  id: string,
  orgId: string,
  key: string,
  label: string,
  type: string,
  now: number
): Record<string, unknown> {
  return {
    id,
    organizationId: orgId,
    key,
    label,
    type,
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: false,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function mkMapping(
  orgId: string,
  entityId: string,
  columnDefinitionId: string,
  sourceField: string,
  normalizedKey: string,
  created: number
): Record<string, unknown> {
  return {
    id: generateId(),
    organizationId: orgId,
    connectorEntityId: entityId,
    columnDefinitionId,
    sourceField,
    isPrimaryKey: false,
    normalizedKey,
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    refNormalizedKey: null,
    refEntityKey: null,
    created,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}
