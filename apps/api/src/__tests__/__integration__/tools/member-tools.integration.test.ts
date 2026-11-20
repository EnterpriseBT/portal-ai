/**
 * Integration tests for the member_management toolpack (#847).
 *
 * Each tool is built as `buildAnalyticsTools` builds it and wrapped by the
 * per-caller permission gate, then run against the real DB and the real
 * SeatService, so the tools refuse what Settings → Members refuses:
 *  - a caller without the permission gets the typed TOOL_PERMISSION_DENIED,
 *    and nothing is written;
 *  - other refusals come back with Settings' message and their code;
 *  - no invite link reaches a tool result.
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
import { SeatService } from "../../../services/seat.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  InvitationShowTool,
  MemberInviteTool,
} from "../../../tools/rbac/invitation.tool.js";
import {
  MemberRemoveTool,
  SeatUsageTool,
} from "../../../tools/rbac/member.tool.js";
import {
  generateId,
  createUser,
  createOrganization,
  createOrganizationUser,
  teardownOrg,
  seedRbacForOrg,
} from "../utils/application.util.js";
import { atLeast, eventually } from "../utils/eventually.util.js";

type Executable = { execute: (i: unknown, o: unknown) => Promise<unknown> };
type Buildable = { build: (ctx: PermissionContext) => unknown };

describe("member_management tools — integration (#847)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let orgId: string;
  let ownerId: string;
  let memberId: string;
  let owner: PermissionContext;
  let member: PermissionContext;

  const asDrizzle = () => db as ReturnType<typeof drizzle>;

  /** The tool wrapped by the per-caller gate, as `buildAnalyticsTools` does
   *  (no descriptor: the gate only turns a service 403 into the refusal). */
  async function gated(
    tool: Buildable,
    ctx: PermissionContext
  ): Promise<Executable> {
    const set = await PermissionService.loadSet(ctx);
    const tools: Record<string, GateableTool> = {
      t: tool.build(ctx) as GateableTool,
    };
    wrapWithPermissionGate(
      tools,
      set,
      { organizationId: ctx.organizationId, userId: ctx.userId },
      () => undefined
    );
    return tools.t as unknown as Executable;
  }

  const invitations = () =>
    asDrizzle()
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.organizationId, orgId));

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 6 });
    db = drizzle(connection, { schema });
    await teardownOrg(asDrizzle());

    const o = createUser(`auth0|${generateId()}`);
    const m = createUser(`auth0|${generateId()}`);
    await asDrizzle()
      .insert(schema.users)
      .values([o, m] as never);
    ownerId = o.id;
    memberId = m.id;

    const org = createOrganization(o.id);
    orgId = org.id;
    await asDrizzle()
      .insert(schema.organizations)
      .values(org as never);
    await seedRbacForOrg(asDrizzle(), orgId);
    await asDrizzle()
      .insert(schema.organizationUsers)
      .values([
        createOrganizationUser(orgId, ownerId, { role: "owner" }),
        createOrganizationUser(orgId, memberId, { role: "member" }),
      ] as never);

    owner = { userId: ownerId, organizationId: orgId, roles: ["owner"] };
    member = { userId: memberId, organizationId: orgId, roles: ["member"] };
  });

  afterEach(async () => {
    // Invite and remove write their audit rows unawaited; let them land.
    await new Promise((r) => setTimeout(r, 150));
    await teardownOrg(asDrizzle());
    await connection.end({ timeout: 5 });
  });

  it("an owner's member_invite creates the invitation Settings would, and the result has no link", async () => {
    const tool = await gated(new MemberInviteTool(), owner);
    const result = (await tool.execute(
      { email: "alice@example.com", role: "member" },
      {}
    )) as Record<string, unknown>;

    const rows = await invitations();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: "alice@example.com",
      role: "member",
      status: "pending",
      invitedByUserId: ownerId,
    });
    expect(result).toEqual({
      type: "invitation",
      invitationId: rows[0].id,
      email: "alice@example.com",
      role: "member",
      status: "pending",
      expiresAt: rows[0].expiresAt,
    });
    expect(JSON.stringify(result)).not.toMatch(/token|https?:/);
  });

  it("a second invite to the same email is refused with INVITATION_ALREADY_PENDING", async () => {
    const tool = await gated(new MemberInviteTool(), owner);
    await tool.execute({ email: "alice@example.com", role: "member" }, {});
    const again = (await tool.execute(
      { email: "alice@example.com", role: "member" },
      {}
    )) as { error?: string; code?: string };

    expect(again.code).toBe(ApiCode.INVITATION_ALREADY_PENDING);
    expect(again.error).toBeDefined();
    expect(await invitations()).toHaveLength(1);
  });

  it("a member without member.invite gets the typed refusal, and nothing is written", async () => {
    const tool = await gated(new MemberInviteTool(), member);
    const result = (await tool.execute(
      { email: "bob@example.com", role: "member" },
      {}
    )) as { error?: { code?: string } };

    expect(result.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);
    expect(await invitations()).toHaveLength(0);
  });

  it("member_remove refuses the last owner with Settings' refusal", async () => {
    const tool = await gated(new MemberRemoveTool(), owner);
    const result = (await tool.execute({ userId: ownerId }, {})) as {
      error?: string;
      code?: string;
    };
    expect(result.code).toBe(ApiCode.LAST_OWNER_REMOVAL);
  });

  it("seat_usage reports what Settings → Members reports", async () => {
    await SeatService.invite(
      owner,
      { email: "carol@example.com", role: "member" },
      { sourceIp: null, userAgent: "test" }
    );
    const tool = await gated(new SeatUsageTool(), member);
    expect(await tool.execute({}, {})).toEqual(
      await SeatService.seatUsage(owner)
    );
    expect(await tool.execute({}, {})).toMatchObject({ used: 3 });
  });

  it("invitation_show can't reach another organization's invitation", async () => {
    const o2 = createUser(`auth0|${generateId()}`);
    await asDrizzle()
      .insert(schema.users)
      .values(o2 as never);
    const org2 = createOrganization(o2.id);
    await asDrizzle()
      .insert(schema.organizations)
      .values(org2 as never);
    await seedRbacForOrg(asDrizzle(), org2.id);
    await asDrizzle()
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(org2.id, o2.id, { role: "owner" }) as never
      );
    const theirs = await SeatService.invite(
      { userId: o2.id, organizationId: org2.id, roles: ["owner"] },
      { email: "dave@example.com", role: "member" },
      { sourceIp: null, userAgent: "test" }
    );

    const tool = await gated(new InvitationShowTool(), owner);
    const result = (await tool.execute({ invitationId: theirs.id }, {})) as {
      code?: string;
    };
    expect(result.code).toBe(ApiCode.INVITATION_NOT_FOUND);
  });

  it("an agent invite is audited with the agent stamp", async () => {
    const tool = await gated(new MemberInviteTool(), owner);
    await tool.execute({ email: "erin@example.com", role: "admin" }, {});

    const rows = await eventually(
      () =>
        asDrizzle()
          .select()
          .from(schema.auditLog)
          .where(
            and(
              eq(schema.auditLog.organizationId, orgId),
              eq(schema.auditLog.action, "member.invite" as never)
            )
          ),
      atLeast(1)
    );
    expect(rows[0].userId).toBe(ownerId);
    expect(rows[0].userAgent).toBe("portal-agent");
  });
});
