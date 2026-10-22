/**
 * #645: the view_management toolpack end to end. Tools are built exactly as
 * a portal session builds them (`ToolService.buildAnalyticsTools`), so the
 * input-character, permission, lock and cost gates are all real, and every
 * call runs CuratedViewService / GrantService against the real database.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { ToolService } from "../../../services/tools.service.js";
import { CuratedViewService } from "../../../services/curated-view.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  createOrganizationUser,
  seedRbacForOrg,
} from "../utils/application.util.js";

const TEST_TAG = "VIEW_TOOLS_TEST";

const base = (createdBy: string) => ({
  created: Date.now(),
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

type Result = Record<string, unknown> & {
  error?: { code: string; message: string };
};

describe("view_management tools — integration (#645)", () => {
  let connection!: ReturnType<typeof postgres>;
  let d!: ReturnType<typeof drizzle>;
  let orgId: string;
  let ownerId: string;
  let memberId: string;
  let memberEmail: string;
  let stationId: string;
  let entityId: string;
  let portalId: string;

  /** A tier with only the view pack; `advancedViewFilters` per test. */
  async function useTier(advancedViewFilters: boolean): Promise<void> {
    const slug = `vt-${generateId().slice(0, 8)}`;
    await d.insert(schema.tiers).values({
      id: generateId(),
      ...base(TEST_TAG),
      slug,
      displayName: "View tools test",
      builtinToolpacks: ["view_management"],
      advancedViewFilters,
    } as never);
    await d
      .update(schema.organizations)
      .set({ tier: slug })
      .where(eq(schema.organizations.id, orgId));
  }

  async function seedEntity(): Promise<void> {
    const defId = generateId();
    await d.insert(schema.connectorDefinitions).values({
      id: defId,
      slug: `cd-${defId.slice(0, 8)}`,
      display: "CD",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, write: true, sync: false },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);
    const instanceId = generateId();
    await d.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: defId,
      organizationId: orgId,
      name: "Accounts source",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      // Read-only: the view tools are control-plane and must still appear.
      enabledCapabilityFlags: { read: true, write: false, sync: false },
      ...base(ownerId),
    } as never);
    await d.insert(schema.stationInstances).values({
      id: generateId(),
      stationId,
      connectorInstanceId: instanceId,
      ...base(ownerId),
    } as never);

    entityId = generateId();
    await d.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId: instanceId,
      key: `accounts_${generateId().replace(/-/g, "").slice(0, 6)}`,
      label: "Accounts",
      ...base(ownerId),
    } as never);
    for (const [key, type] of [
      ["name", "string"],
      ["region", "string"],
    ] as const) {
      const colId = generateId();
      await d.insert(schema.columnDefinitions).values({
        id: colId,
        organizationId: orgId,
        key: `${key}_${generateId().replace(/-/g, "").slice(0, 6)}`,
        label: key,
        type,
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        ...base(ownerId),
      } as never);
      await d.insert(schema.fieldMappings).values({
        id: generateId(),
        organizationId: orgId,
        connectorEntityId: entityId,
        columnDefinitionId: colId,
        sourceField: key,
        isPrimaryKey: false,
        normalizedKey: key,
        required: false,
        defaultValue: null,
        format: null,
        enumValues: null,
        ...base(ownerId),
      } as never);
    }
    wideTableStatementCache.clear();
    await wideTableReconcilerService.reconcileEntity(
      entityId,
      d as unknown as DbClient
    );
  }

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 4 });
    d = drizzle(connection, { schema });
    await teardownOrg(d);

    const owner = createUser(`auth0|owner-${generateId()}`);
    const member = createUser(`auth0|member-${generateId()}`);
    await d.insert(schema.users).values([owner, member] as never);
    ownerId = owner.id;
    memberId = member.id;
    memberEmail = member.email as string;
    const org = createOrganization(owner.id);
    await d.insert(schema.organizations).values(org as never);
    orgId = org.id;
    await seedRbacForOrg(d as never, orgId);
    await d
      .insert(schema.organizationUsers)
      .values([
        createOrganizationUser(orgId, ownerId, { role: "owner", lastLogin: 0 }),
        createOrganizationUser(orgId, memberId, {
          role: "member",
          lastLogin: 0,
        }),
      ] as never);
    await useTier(false);

    stationId = generateId();
    await d.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Views station",
      description: null,
      ...base(ownerId),
    } as never);
    await d.insert(schema.stationToolpacks).values({
      id: generateId(),
      stationId,
      builtinSlug: "view_management",
      organizationToolpackId: null,
      ...base(ownerId),
    } as never);
    portalId = generateId();
    await d.insert(schema.portals).values({
      id: portalId,
      organizationId: orgId,
      stationId,
      name: "Portal",
      ...base(ownerId),
    } as never);
    await seedEntity();
  });

  afterEach(async () => {
    try {
      await wideTableReconcilerService.dropTable(
        entityId,
        d as unknown as DbClient
      );
    } catch {
      /* ignore */
    }
    await teardownOrg(d);
    await d.delete(schema.tiers).where(eq(schema.tiers.createdBy, TEST_TAG));
    await connection.end();
  });

  /** Run one tool as `userId`, built as a portal session builds it. */
  async function run(
    userId: string,
    name: string,
    input: unknown
  ): Promise<Result> {
    const tools = await ToolService.buildAnalyticsTools(
      orgId,
      stationId,
      userId,
      portalId
    );
    const t = tools[name] as {
      execute: (i: unknown, o: unknown) => Promise<Result>;
    };
    expect(t).toBeDefined();
    return t.execute(input, {
      toolCallId: "t",
      messages: [],
      abortSignal: new AbortController().signal,
    });
  }

  const asOwner = (name: string, input: unknown) => run(ownerId, name, input);
  const asMember = (name: string, input: unknown) => run(memberId, name, input);

  async function createView(overrides: Record<string, unknown> = {}) {
    const r = await asOwner("curated_view_create", {
      connectorEntityId: entityId,
      key: `ne_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "NE accounts",
      filter: {
        combinator: "and",
        conditions: [{ field: "region", operator: "eq", value: "NE" }],
      },
      columns: ["name", "region"],
      ...overrides,
    });
    expect(r.error).toBeUndefined();
    return (r.curatedView as { id: string; key: string }).id;
  }

  const shareWithMember = (viewId: string, access: string) =>
    asOwner("curated_view_share", {
      curatedViewId: viewId,
      grantee: { type: "user", userId: memberId },
      access,
    });

  it("the tools are present on a station whose connectors are read-only", async () => {
    const tools = await ToolService.buildAnalyticsTools(
      orgId,
      stationId,
      ownerId,
      portalId
    );
    for (const name of [
      "curated_view_list",
      "curated_view_get",
      "curated_view_create",
      "curated_view_update",
      "curated_view_delete",
      "curated_view_share",
      "member_list",
    ]) {
      expect(tools[name]).toBeDefined();
    }
  });

  it("an owner creates a view the Views page lists, owned by them, from this session", async () => {
    const id = await createView();
    const listed = await CuratedViewService.list(
      { userId: ownerId, organizationId: orgId, roles: ["owner"] },
      {
        limit: 20,
        offset: 0,
        sortBy: "created",
        sortOrder: "asc",
      } as never
    );
    const row = listed.curatedViews.find((v) => v.id === id);
    expect(row).toMatchObject({
      createdBy: ownerId,
      sourcePortalId: portalId,
      filtered: true,
      projected: true,
    });

    const got = await asOwner("curated_view_get", { curatedViewId: id });
    const cols = (
      got.curatedView as { columns: { key: string }[] }
    ).columns.map((c) => c.key);
    expect(cols.sort()).toEqual(["name", "region"]);
  });

  it("an owner edits the label, columns and filter", async () => {
    const id = await createView();
    const r = await asOwner("curated_view_update", {
      curatedViewId: id,
      label: "North-east",
      columns: ["name"],
      filter: {
        combinator: "and",
        conditions: [{ field: "region", operator: "eq", value: "N" }],
      },
    });
    expect(r.error).toBeUndefined();
    const got = (await asOwner("curated_view_get", { curatedViewId: id }))
      .curatedView as {
      label: string;
      columns: { key: string }[];
      filter: { conditions: { value: string }[] };
    };
    expect(got.label).toBe("North-east");
    expect(got.columns.map((c) => c.key)).toEqual(["name"]);
    expect(got.filter.conditions[0].value).toBe("N");
  });

  it("a member can't create a view (TOOL_PERMISSION_DENIED)", async () => {
    const r = await asMember("curated_view_create", {
      connectorEntityId: entityId,
      key: "member_view",
      label: "Mine",
    });
    expect(r.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);
  });

  it("a view a member can't read is not found for them", async () => {
    const id = await createView();
    for (const [name, input] of [
      ["curated_view_get", { curatedViewId: id }],
      ["curated_view_update", { curatedViewId: id, label: "x" }],
      ["curated_view_delete", { curatedViewId: id }],
    ] as const) {
      const r = await asMember(name, input);
      expect(`${name}:${r.error?.code}`).toBe(
        `${name}:${ApiCode.TOOL_TARGET_NOT_FOUND}`
      );
    }
  });

  it("a member with read sees no filter or shares, and can't edit, delete or share", async () => {
    const id = await createView();
    expect((await shareWithMember(id, "read")).error).toBeUndefined();

    const got = await asMember("curated_view_get", { curatedViewId: id });
    expect(got.error).toBeUndefined();
    expect((got.curatedView as { filter: unknown }).filter).toBeNull();
    expect(got.grants).toBeUndefined();

    for (const [name, input] of [
      ["curated_view_update", { curatedViewId: id, label: "x" }],
      ["curated_view_delete", { curatedViewId: id }],
      [
        "curated_view_share",
        { curatedViewId: id, grantee: { type: "team" }, access: "read-write" },
      ],
    ] as const) {
      const r = await asMember(name, input);
      expect(`${name}:${r.error?.code}`).toBe(
        `${name}:${ApiCode.TOOL_PERMISSION_DENIED}`
      );
    }
  });

  it("a SQL filter needs advanced view filters; the structured filter doesn't", async () => {
    const refused = await asOwner("curated_view_create", {
      connectorEntityId: entityId,
      key: "sql_view",
      label: "SQL",
      filterSql: "region = 'NE'",
    });
    expect(refused.error?.code).toBe(
      ApiCode.CURATED_VIEW_FILTER_SQL_NOT_ENTITLED
    );
    await createView({ key: "structured_view" });
  });

  it("a SQL filter saves on a tier with advanced view filters", async () => {
    await useTier(true);
    const r = await asOwner("curated_view_create", {
      connectorEntityId: entityId,
      key: "sql_view_ok",
      label: "SQL",
      filterSql: "region = 'NE'",
    });
    expect(r.error).toBeUndefined();
    expect((r.curatedView as { filterSql: string }).filterSql).toBe(
      "region = 'NE'"
    );
  });

  it("deleting a view detaches it from its station and drops its shares", async () => {
    const id = await createView();
    await d.insert(schema.stationViews).values({
      id: generateId(),
      organizationId: orgId,
      stationId,
      curatedViewId: id,
      ...base(ownerId),
    } as never);
    await shareWithMember(id, "read");

    const r = await asOwner("curated_view_delete", { curatedViewId: id });
    expect(r).toMatchObject({
      success: true,
      id,
      cascaded: { stationViews: 1, grants: 1, fieldMappings: 2 },
    });
    expect(
      (await asOwner("curated_view_get", { curatedViewId: id })).error?.code
    ).toBe(ApiCode.TOOL_TARGET_NOT_FOUND);
  });

  it("finds a member with member_list, shares with them, then stops sharing", async () => {
    const id = await createView();
    const roster = (await asOwner("member_list", {})).members as {
      userId: string;
      email: string;
    }[];
    const jane = roster.find((m) => m.email === memberEmail)!;
    expect(jane.userId).toBe(memberId);

    const shared = await asOwner("curated_view_share", {
      curatedViewId: id,
      grantee: { type: "user", userId: jane.userId },
      access: "read",
    });
    expect(shared).toMatchObject({ success: true, grant: { access: "read" } });
    expect(
      (await asMember("curated_view_get", { curatedViewId: id })).error
    ).toBeUndefined();

    const revoked = await asOwner("curated_view_share", {
      curatedViewId: id,
      grantee: { type: "user", userId: jane.userId },
      access: "none",
    });
    expect(revoked).toEqual({ success: true, revoked: true });
    expect(
      (await asMember("curated_view_get", { curatedViewId: id })).error?.code
    ).toBe(ApiCode.TOOL_TARGET_NOT_FOUND);
  });

  it("shares a view with the whole team", async () => {
    const id = await createView();
    const r = await asOwner("curated_view_share", {
      curatedViewId: id,
      grantee: { type: "team" },
      access: "read",
    });
    expect(r).toMatchObject({
      success: true,
      grant: { principalLabel: "The team", access: "read" },
    });
    expect(
      (await asMember("curated_view_get", { curatedViewId: id })).error
    ).toBeUndefined();
  });

  it("a duplicate key keeps its own code", async () => {
    await createView({ key: "dup_key" });
    const r = await asOwner("curated_view_create", {
      connectorEntityId: entityId,
      key: "dup_key",
      label: "Again",
    });
    expect(r.error?.code).toBe(ApiCode.CURATED_VIEW_DUPLICATE_KEY);
  });

  it("an unknown column key is refused, naming it", async () => {
    const r = await asOwner("curated_view_create", {
      connectorEntityId: entityId,
      key: "bad_cols",
      label: "Bad",
      columns: ["name", "revenue"],
    });
    expect(r.error?.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    expect(r.error?.message).toContain('"revenue"');
  });

  it("another organization's view is not found", async () => {
    const other = createUser(`auth0|other-${generateId()}`);
    await d.insert(schema.users).values(other as never);
    const otherOrg = createOrganization(other.id);
    await d.insert(schema.organizations).values(otherOrg as never);
    const foreignViewId = generateId();
    // A foreign view row is enough: lookup is org-scoped before anything else.
    const foreignEntity = generateId();
    const foreignDef = generateId();
    await d.insert(schema.connectorDefinitions).values({
      id: foreignDef,
      slug: `cd-${foreignDef.slice(0, 8)}`,
      display: "CD",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);
    const foreignInstance = generateId();
    await d.insert(schema.connectorInstances).values({
      id: foreignInstance,
      connectorDefinitionId: foreignDef,
      organizationId: otherOrg.id,
      name: "Other",
      status: "active",
      config: {},
      credentials: null,
      ...base(other.id),
    } as never);
    await d.insert(schema.connectorEntities).values({
      id: foreignEntity,
      organizationId: otherOrg.id,
      connectorInstanceId: foreignInstance,
      key: "other",
      label: "Other",
      ...base(other.id),
    } as never);
    await d.insert(schema.curatedViews).values({
      id: foreignViewId,
      organizationId: otherOrg.id,
      connectorEntityId: foreignEntity,
      key: "foreign",
      label: "Foreign",
      ...base(other.id),
    } as never);

    for (const [name, input] of [
      ["curated_view_get", { curatedViewId: foreignViewId }],
      ["curated_view_update", { curatedViewId: foreignViewId, label: "x" }],
      ["curated_view_delete", { curatedViewId: foreignViewId }],
      [
        "curated_view_share",
        {
          curatedViewId: foreignViewId,
          grantee: { type: "team" },
          access: "read",
        },
      ],
    ] as const) {
      const r = await asOwner(name, input);
      expect(`${name}:${r.error?.code}`).toBe(
        `${name}:${ApiCode.TOOL_TARGET_NOT_FOUND}`
      );
    }
  });
});
