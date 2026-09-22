import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../../../../db/schema/index.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import { PermissionPoliciesRepository } from "../../../../db/repositories/permission-policies.repository.js";
import { PermissionStatementsRepository } from "../../../../db/repositories/permission-statements.repository.js";
import { PolicyAttachmentsRepository } from "../../../../db/repositories/policy-attachments.repository.js";
import { RolesRepository } from "../../../../db/repositories/roles.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("RBAC repositories Integration Tests (#598 slice 1)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let policies: PermissionPoliciesRepository;
  let statements: PermissionStatementsRepository;
  let attachments: PolicyAttachmentsRepository;
  let rolesRepo: RolesRepository;
  let orgId: string;
  let actor: string;

  const baseAudit = () => ({
    created: Date.now(),
    createdBy: actor,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  });

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    policies = new PermissionPoliciesRepository();
    statements = new PermissionStatementsRepository();
    attachments = new PolicyAttachmentsRepository();
    rolesRepo = new RolesRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);
    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    actor = user.id;
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;
  });

  afterEach(async () => {
    await connection.end();
  });

  it("round-trips a policy + finds it by name; soft-delete excludes it", async () => {
    const id = generateId();
    await policies.create(
      {
        id,
        organizationId: orgId,
        name: "FullAccess",
        kind: "system",
        description: null,
        ...baseAudit(),
      } as never,
      db
    );

    const found = await policies.findByName(orgId, "FullAccess", db);
    expect(found?.id).toBe(id);
    expect(found?.kind).toBe("system");

    await policies.softDelete(id, actor, db);
    expect(await policies.findByName(orgId, "FullAccess", db)).toBeUndefined();
  });

  it("round-trips a role + finds it by name", async () => {
    const id = generateId();
    await rolesRepo.create(
      {
        id,
        organizationId: orgId,
        name: "member",
        slug: "member",
        kind: "system",
        ...baseAudit(),
      } as never,
      db
    );
    const found = await rolesRepo.findByName(orgId, "member", db);
    expect(found?.id).toBe(id);
  });

  it("gathers statements by policy id (the engine's effective-set read)", async () => {
    const policyId = generateId();
    await policies.create(
      {
        id: policyId,
        organizationId: orgId,
        name: "MemberAccess",
        kind: "system",
        description: null,
        ...baseAudit(),
      } as never,
      db
    );
    for (const s of [
      { verb: "read", condition: "created_by_system" },
      { verb: "write", condition: "created_by_caller" },
    ]) {
      await statements.create(
        {
          id: generateId(),
          organizationId: orgId,
          policyId,
          effect: "allow",
          verb: s.verb,
          resourceType: "*",
          resourceId: null,
          condition: s.condition,
          ...baseAudit(),
        } as never,
        db
      );
    }
    const rows = await statements.findByPolicyIds([policyId], db);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.verb).sort()).toEqual(["read", "write"]);
    expect(await statements.findByPolicyIds([], db)).toEqual([]);
  });

  it("gathers attachments by principal (user + role) and enforces uniqueness", async () => {
    const policyId = generateId();
    await policies.create(
      {
        id: policyId,
        organizationId: orgId,
        name: "AdminAccess",
        kind: "system",
        description: null,
        ...baseAudit(),
      } as never,
      db
    );
    await attachments.create(
      {
        id: generateId(),
        organizationId: orgId,
        policyId,
        principalType: "role",
        principalId: "role-admin",
        ...baseAudit(),
      } as never,
      db
    );

    const found = await attachments.findByPrincipals(
      [{ principalType: "role", principalId: "role-admin" }],
      db
    );
    expect(found).toHaveLength(1);
    expect(found[0].policyId).toBe(policyId);

    // The partial-unique index rejects a duplicate live attachment.
    await expect(
      attachments.create(
        {
          id: generateId(),
          organizationId: orgId,
          policyId,
          principalType: "role",
          principalId: "role-admin",
          ...baseAudit(),
        } as never,
        db
      )
    ).rejects.toThrow();
  });
});
