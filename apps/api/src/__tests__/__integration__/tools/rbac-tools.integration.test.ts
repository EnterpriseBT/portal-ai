/**
 * Integration tests for the rbac_management toolpack (#629 slice 3).
 *
 * Exercises the full agent write path against the real DB + real RBAC services:
 * a tool built exactly as `buildAnalyticsTools` builds it, wrapped by the
 * per-caller tool-authorization gate. Proves the two ends of #629's contract —
 *  1. a caller who lacks the capability gets the **typed** `TOOL_PERMISSION_DENIED`
 *     refusal (the service 403 propagates through the tool and the gate converts
 *     it), and no write happens; and
 *  2. an admitted caller's mutation succeeds and is **audited** (the agent stamp).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { PermissionService } from "../../../services/permission.service.js";
import type { PermissionContext } from "../../../services/permission.service.js";
import { wrapWithPermissionGate } from "../../../services/permission-gate.service.js";
import type { GateableTool } from "../../../services/cost-gate.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { PolicyCreateTool } from "../../../tools/rbac/policy.tool.js";
import {
  generateId,
  createUser,
  createOrganization,
  createOrganizationUser,
  teardownOrg,
  seedRbacForOrg,
} from "../utils/application.util.js";

type Executable = { execute: (i: unknown, o: unknown) => Promise<unknown> };

describe("rbac_management tools — integration (#629)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;
  let ownerId: string;
  let memberId: string;
  let tierSlug: string;

  const asDrizzle = () => db as ReturnType<typeof drizzle>;

  /** Build `policy_create` and wrap it with the per-caller gate — the exact
   *  composition `buildAnalyticsTools` produces (rbac tools carry no descriptor,
   *  so the gate only catches a service-thrown 403). */
  async function gatedPolicyCreate(
    ctx: PermissionContext
  ): Promise<Executable> {
    const set = await PermissionService.loadSet(ctx);
    const tools: Record<string, GateableTool> = {
      policy_create: new PolicyCreateTool().build(ctx) as GateableTool,
    };
    wrapWithPermissionGate(
      tools,
      set,
      { organizationId: ctx.organizationId, userId: ctx.userId },
      () => undefined
    );
    return tools.policy_create as unknown as Executable;
  }

  const validInput = {
    name: `agent-policy-${generateId()}`,
    statements: [
      {
        effect: "allow",
        verb: "read",
        resourceType: "station",
        resourceId: null,
        condition: null,
      },
    ],
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 6 });
    db = drizzle(connection, { schema });
    await teardownOrg(asDrizzle());

    const owner = createUser(`auth0|${generateId()}`);
    const member = createUser(`auth0|${generateId()}`);
    await asDrizzle()
      .insert(schema.users)
      .values([owner, member] as never);
    ownerId = owner.id;
    memberId = member.id;

    const org = createOrganization(owner.id);
    orgId = org.id;
    await asDrizzle()
      .insert(schema.organizations)
      .values(org as never);
    await seedRbacForOrg(asDrizzle(), orgId);

    // A dedicated tier that DOES include custom-RBAC entitlement, so the member
    // denial below is specifically the capability gate, not the entitlement gate.
    tierSlug = `rbac-tools-test-${generateId()}`;
    await asDrizzle()
      .insert(schema.tiers)
      .values({
        id: generateId(),
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        slug: tierSlug,
        displayName: "RBAC Tools Test Tier",
        customRbac: true,
      } as never);
    await asDrizzle()
      .update(schema.organizations)
      .set({ tier: tierSlug })
      .where(eq(schema.organizations.id, orgId));

    await asDrizzle()
      .insert(schema.organizationUsers)
      .values([
        createOrganizationUser(orgId, ownerId, { role: "owner" }),
        createOrganizationUser(orgId, memberId, { role: "member" }),
      ] as never);
  });

  afterEach(async () => {
    await teardownOrg(asDrizzle());
    await asDrizzle()
      .delete(schema.tiers)
      .where(eq(schema.tiers.slug, tierSlug));
    await connection.end({ timeout: 5 });
  });

  const policyCount = async () =>
    (
      await asDrizzle()
        .select()
        .from(schema.permissionPolicies)
        .where(eq(schema.permissionPolicies.organizationId, orgId))
    ).length;

  it("denies a member without member.role.assign with the typed refusal, and writes nothing", async () => {
    const before = await policyCount();
    const tool = await gatedPolicyCreate({
      userId: memberId,
      organizationId: orgId,
      roles: ["member"],
    });

    const result = (await tool.execute(validInput, {})) as {
      error?: { code?: string };
    };

    expect(result.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);
    expect(await policyCount()).toBe(before);
  });

  it("lets an owner create a policy and records an audit row with the agent stamp", async () => {
    const tool = await gatedPolicyCreate({
      userId: ownerId,
      organizationId: orgId,
      roles: ["owner"],
    });

    const result = (await tool.execute(validInput, {})) as {
      success?: boolean;
      policy?: { id: string; name: string };
    };

    expect(result.success).toBe(true);
    expect(result.policy?.name).toBe(validInput.name);

    // The audit write is fire-and-forget (`void AuditService.record`); give it a
    // beat to flush, then assert the agent-stamped row.
    await new Promise((r) => setTimeout(r, 80));
    const rows = await asDrizzle()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.organizationId, orgId),
          eq(schema.auditLog.action, "policy.create" as never)
        )
      );
    expect(rows.length).toBe(1);
    expect(rows[0].userId).toBe(ownerId);
    expect(rows[0].userAgent).toBe("portal-agent");
    expect(rows[0].sourceIp).toBeNull();
  });
});
