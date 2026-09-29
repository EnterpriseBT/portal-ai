/**
 * Integration tests for the orphan per-scope dissolve reap (#643).
 *
 * Per-user view-scoping makes `map_dissolve_geometries` content-addressed by
 * `scope_hash`; entitlement churn strands the superseded scope's coverage. The
 * reap drops any scope not served within `DISSOLVE_SCOPE_TTL_MS`, except the
 * most-recently-served scope of each `(owner, column, band)` — so a live pin
 * always keeps at least its current scope. These tests seed
 * `map_dissolve_geometries` rows directly (geom stays null — the reap never
 * touches it) against real pin owners and assert the keep/reap decision.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { dissolveScopeRetentionPurgeProcessor } from "../../../queues/processors/dissolve-scope-retention-purge.processor.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("dissolve-scope retention purge (#643)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;
  let stationId: string;

  const t = Date.now();

  const createPin = async (): Promise<string> => {
    const pinId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.portalResults)
      .values({
        id: pinId,
        organizationId: orgId,
        stationId,
        portalId: null,
        messageId: null,
        blockIndex: null,
        name: "Choropleth",
        type: "geo",
        content: {},
        snapshotUpdatedAt: null,
        created: t,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    return pinId;
  };

  /** Seed one dissolve row for a pin owner. `value` distinguishes rows within a
   *  scope; a scope is the set of rows sharing `scopeHash`. */
  const seedRow = async (args: {
    pinId: string;
    columnName: string;
    band: number;
    scopeHash: string;
    value: string;
    lastServedAt: number | null;
    created?: number;
  }): Promise<void> => {
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.mapDissolveGeometries)
      .values({
        id: generateId(),
        organizationId: orgId,
        portalResultId: args.pinId,
        messageId: null,
        blockIndex: null,
        columnName: args.columnName,
        value: args.value,
        zoomBand: args.band,
        featureCount: 1,
        merged: false,
        scopeHash: args.scopeHash,
        lastServedAt: args.lastServedAt,
        created: args.created ?? t,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
  };

  const scopesFor = async (pinId: string): Promise<string[]> => {
    const r = (await connection.unsafe(
      `SELECT DISTINCT scope_hash FROM map_dissolve_geometries
       WHERE portal_result_id = $1 AND deleted IS NULL ORDER BY scope_hash`,
      [pinId]
    )) as unknown as Array<{ scope_hash: string }>;
    return r.map((x) => x.scope_hash);
  };

  const countFor = async (pinId: string): Promise<number> => {
    const r = (await connection.unsafe(
      `SELECT count(*)::int AS n FROM map_dissolve_geometries
       WHERE portal_result_id = $1 AND deleted IS NULL`,
      [pinId]
    )) as unknown as Array<{ n: number }>;
    return r[0].n;
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    const dbTyped = db as ReturnType<typeof drizzle>;

    const user = createUser(`auth0|${generateId()}`);
    await dbTyped.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    stationId = generateId();
    await dbTyped.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Station",
      description: null,
      toolPacks: ["data_query"],
      created: t,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("reaps a superseded aged-out scope but keeps the group's freshest scope", async () => {
    const pinId = await createPin();
    // Two scopes for one (owner, column, band). The old one is past the TTL and
    // is NOT the freshest → reaped. The new one is fresh → the winner, kept.
    await seedRow({
      pinId,
      columnName: "c_t",
      band: 0,
      scopeHash: "old_scope_aaaaaaaaaaaaaaaaaaaa",
      value: "x",
      lastServedAt: t - 60 * DAY_MS,
    });
    await seedRow({
      pinId,
      columnName: "c_t",
      band: 0,
      scopeHash: "old_scope_aaaaaaaaaaaaaaaaaaaa",
      value: "y",
      lastServedAt: t - 60 * DAY_MS,
    });
    await seedRow({
      pinId,
      columnName: "c_t",
      band: 0,
      scopeHash: "new_scope_bbbbbbbbbbbbbbbbbbbb",
      value: "x",
      lastServedAt: t - 1 * DAY_MS,
    });
    await seedRow({
      pinId,
      columnName: "c_t",
      band: 0,
      scopeHash: "new_scope_bbbbbbbbbbbbbbbbbbbb",
      value: "y",
      lastServedAt: t - 1 * DAY_MS,
    });

    const summary = await dissolveScopeRetentionPurgeProcessor({ now: t });

    expect(summary.purged).toBe(2);
    expect(await scopesFor(pinId)).toEqual(["new_scope_bbbbbbbbbbbbbbbbbbbb"]);
  });

  it("never reaps the freshest scope of a group even when it is itself aged out (a live pin keeps its only scope)", async () => {
    const pinId = await createPin();
    // A single scope, itself past the TTL. As the rank-1 (freshest) scope of its
    // group it is never reaped — the pin must never fall back to raw because the
    // reap got ahead of it. A never-served fresh scope (created now) is also kept.
    await seedRow({
      pinId,
      columnName: "c_t",
      band: 0,
      scopeHash: "lone_scope_cccccccccccccccccccc",
      value: "x",
      lastServedAt: t - 90 * DAY_MS,
    });
    await seedRow({
      pinId,
      columnName: "c_t",
      band: 1,
      scopeHash: "fresh_unserved_dddddddddddddddddd",
      value: "x",
      lastServedAt: null,
      created: t,
    });

    const summary = await dissolveScopeRetentionPurgeProcessor({ now: t });

    expect(summary.purged).toBe(0);
    expect(await countFor(pinId)).toBe(2);
  });

  it("returns a run summary and is a no-op when nothing is stale", async () => {
    const pinId = await createPin();
    await seedRow({
      pinId,
      columnName: "c_t",
      band: 0,
      scopeHash: "s1_eeeeeeeeeeeeeeeeeeeeeeeeeeee",
      value: "x",
      lastServedAt: t - 2 * DAY_MS,
    });
    await seedRow({
      pinId,
      columnName: "c_t",
      band: 0,
      scopeHash: "s2_ffffffffffffffffffffffffffff",
      value: "x",
      lastServedAt: t - 3 * DAY_MS,
    });

    const summary = await dissolveScopeRetentionPurgeProcessor({ now: t });

    expect(summary).toEqual({
      purged: 0,
      batches: 0,
      cutoff: new Date(t - 30 * DAY_MS).toISOString(),
    });
    expect(await countFor(pinId)).toBe(2);
  });
});
