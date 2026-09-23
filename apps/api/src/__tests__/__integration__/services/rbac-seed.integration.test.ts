import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { SeedService } from "../../../services/seed.service.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("RBAC system-policy seed + backfill (#598 slice 2)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;

  const insertOrgOnly = async () => {
    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    return { orgId: org.id, actor: user.id };
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    ({ orgId } = await insertOrgOnly());
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Case 10: seed (new-org path) is idempotent ──────────────────────
  it("seeds 3 roles + 3 policies + attachments; a second call is a no-op", async () => {
    const seed = new SeedService();
    await seed.seedRbacSystemPolicies(orgId, db);

    const roles = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.organizationId, orgId));
    const policies = await db
      .select()
      .from(schema.permissionPolicies)
      .where(eq(schema.permissionPolicies.organizationId, orgId));
    const attachments = await db
      .select()
      .from(schema.policyAttachments)
      .where(eq(schema.policyAttachments.organizationId, orgId));
    const statements = await db
      .select()
      .from(schema.permissionStatements)
      .where(eq(schema.permissionStatements.organizationId, orgId));

    expect(roles.map((r) => r.name).sort()).toEqual([
      "admin",
      "member",
      "owner",
    ]);
    expect(policies.map((p) => p.name).sort()).toEqual([
      "AdminAccess",
      "FullAccess",
      "MemberAccess",
    ]);
    expect(attachments).toHaveLength(3);
    // FullAccess(1) + AdminAccess(3)
    // + MemberAccess(8 data types × 3 + station/pin × {delete,share} = 28,
    //   + read job (1) + view page × 3 = 32) = 36 (#621, #630)
    expect(statements).toHaveLength(36);
    expect(policies.every((p) => p.kind === "system")).toBe(true);

    // Second call: no duplication (idempotent via the owner-role early return).
    await seed.seedRbacSystemPolicies(orgId, db);
    const rolesAfter = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.organizationId, orgId));
    const stmtsAfter = await db
      .select()
      .from(schema.permissionStatements)
      .where(eq(schema.permissionStatements.organizationId, orgId));
    expect(rolesAfter).toHaveLength(3);
    expect(stmtsAfter).toHaveLength(36);
  });

  // ── #630: the member nav-view + job-read grants ─────────────────────
  it("MemberAccess seeds read:job + view page:{stations,pinned,jobs} and no admin-page view", async () => {
    await new SeedService().seedRbacSystemPolicies(orgId, db);
    const stmts = await db
      .select({
        verb: schema.permissionStatements.verb,
        resourceType: schema.permissionStatements.resourceType,
        resourceId: schema.permissionStatements.resourceId,
        condition: schema.permissionStatements.condition,
      })
      .from(schema.permissionStatements)
      .where(
        and(
          eq(schema.permissionStatements.organizationId, orgId),
          eq(
            schema.permissionStatements.policyId,
            `syspol:${orgId}:MemberAccess`
          )
        )
      );

    // Unconditional read on jobs (everyone sees the Jobs list).
    expect(
      stmts.some(
        (s) =>
          s.verb === "read" &&
          s.resourceType === "job" &&
          s.resourceId === null &&
          s.condition === null
      )
    ).toBe(true);

    // view page grants exactly on the member pages, none on admin pages.
    const viewPages = stmts
      .filter((s) => s.verb === "view" && s.resourceType === "page")
      .map((s) => s.resourceId)
      .sort();
    expect(viewPages).toEqual(["jobs", "pinned", "stations"]);
    expect(viewPages).not.toContain("connectors");
    expect(viewPages).not.toContain("connector_catalog");
  });

  it("owner resolves to FullAccess via the seeded role attachment", async () => {
    await new SeedService().seedRbacSystemPolicies(orgId, db);
    const ownerRole = await db
      .select()
      .from(schema.roles)
      .where(
        and(
          eq(schema.roles.organizationId, orgId),
          eq(schema.roles.name, "owner")
        )
      );
    const att = await db
      .select()
      .from(schema.policyAttachments)
      .where(eq(schema.policyAttachments.principalId, ownerRole[0].id));
    expect(att).toHaveLength(1);
    const pol = await db
      .select()
      .from(schema.permissionPolicies)
      .where(eq(schema.permissionPolicies.id, att[0].policyId));
    expect(pol[0].name).toBe("FullAccess");
  });

  // ── Case 11: the backfill migration reaches an existing org ─────────
  it("the 0102 backfill migration seeds an org that predates it", async () => {
    // `orgId` from beforeEach has NO rbac rows (created after global-setup
    // migrations ran against an empty DB) — it stands in for a pre-#598 org.
    const before = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.organizationId, orgId));
    expect(before).toHaveLength(0);

    // The 0102 backfill predates `roles.slug` (added by 0109). In the real
    // forward sequence 0102 runs before the column exists and 0109 backfills it;
    // replaying 0102 alone against the current (post-0109) schema would violate
    // slug NOT NULL. Inject the slug the 0109 backfill sets — for system roles
    // that is the role name — so the replay mirrors the fully-migrated state.
    const migrationSql = readFileSync(
      join(process.cwd(), "drizzle/0102_backfill-rbac-system-policies.sql"),
      "utf8"
    )
      .replace(
        '"organization_id", "name", "kind"\n)',
        '"organization_id", "name", "slug", "kind"\n)'
      )
      .replace("o.id, r.name, 'system'\n", "o.id, r.name, r.name, 'system'\n");
    await connection.unsafe(migrationSql);

    const roles = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.organizationId, orgId));
    const statements = await db
      .select()
      .from(schema.permissionStatements)
      .where(eq(schema.permissionStatements.organizationId, orgId));
    expect(roles.map((r) => r.name).sort()).toEqual([
      "admin",
      "member",
      "owner",
    ]);
    expect(statements).toHaveLength(28);

    // Idempotent: re-running the backfill changes nothing (ON CONFLICT).
    await connection.unsafe(migrationSql);
    const rolesAfter = await db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.organizationId, orgId));
    expect(rolesAfter).toHaveLength(3);
  });
});
