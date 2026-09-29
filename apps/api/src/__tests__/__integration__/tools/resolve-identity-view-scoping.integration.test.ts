/**
 * #658: `resolve_identity` must resolve through the caller's granted curated
 * views — never the raw wide tables. Seeded from the reproduction that showed a
 * member reading a projected-out column and an ungranted entity's rows.
 *
 * Fixture: `customers` (customer_id, name) + `orders` (customer_id, amount),
 * joined by the "Customer Orders" entity group on `customer_id`, on a station
 * with the `data_query` pack. Tools are built exactly as a portal session does
 * (`ToolService.buildAnalyticsTools`), so the cost + permission gates wrap them.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";

import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import {
  WideTableStatementCache,
  wideTableStatementCache as singletonStatementCache,
} from "../../../services/wide-table-statement.cache.js";
import { ToolService } from "../../../services/tools.service.js";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
  createOrganizationUser,
  seedRbacForOrg,
  attachCuratedView,
} from "../utils/application.util.js";

const base = (createdBy: string) => ({
  created: Date.now(),
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

interface Match {
  viewKey: string;
  entityKey: string;
  isPrimary: boolean;
  records: Record<string, unknown>[];
  truncated: boolean;
}

describe("resolve_identity resolves through the caller's curated views (#658)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let d!: ReturnType<typeof drizzle>;
  let reconciler: WideTableReconcilerService;
  let orgId: string, ownerId: string, memberId: string, stationId: string;
  let customersId: string, ordersId: string;
  let fm: Record<
    "custLink" | "custName" | "ordLink" | "ordAmount",
    { id: string }
  >;

  /** A granted view over `entityId`; `projection` = field-mapping ids (none = all). */
  async function view(
    entityId: string,
    key: string,
    opts: {
      projection?: string[];
      grantTo?: string | null;
      filter?: Parameters<typeof attachCuratedView>[1]["filter"];
    } = {}
  ): Promise<string> {
    const viewId = await attachCuratedView(d as never, {
      stationId,
      organizationId: orgId,
      connectorEntityId: entityId,
      key,
      label: key,
      createdBy: ownerId,
      grantToUserId: opts.grantTo === null ? undefined : memberId,
      filter: opts.filter ?? null,
    });
    for (const fieldMappingId of opts.projection ?? []) {
      await d.insert(schema.curatedViewFieldMappings).values({
        id: generateId(),
        organizationId: orgId,
        curatedViewId: viewId,
        fieldMappingId,
        ...base(ownerId),
      } as never);
    }
    return viewId;
  }

  async function seedRow(entityId: string, extras: Record<string, unknown>) {
    const id = generateId();
    await d.insert(schema.entityRecords).values({
      id,
      organizationId: orgId,
      connectorEntityId: entityId,
      sourceId: `src-${id}`,
      isValid: true,
      validationErrors: null,
      normalizedData: {},
      syncedAt: Date.now(),
      data: {},
      checksum: `c-${id}`,
      origin: "sync",
      ...base("SYSTEM_TEST"),
    } as never);
    const keys = [
      "entity_record_id",
      "organization_id",
      "synced_at",
      "is_valid",
      "source_id",
      ...Object.keys(extras),
    ];
    const vals = [
      id,
      orgId,
      Date.now(),
      true,
      `src-${id}`,
      ...Object.values(extras),
    ];
    await connection.unsafe(
      `INSERT INTO "er__${entityId}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(",")})`,
      vals as never
    );
    return id;
  }

  async function resolveAs(userId: string, linkValue = "C001") {
    const tools = await ToolService.buildAnalyticsTools(
      orgId,
      stationId,
      userId
    );
    return { tools, run: () => call(tools, linkValue) };
  }

  async function call(
    tools: Awaited<ReturnType<typeof ToolService.buildAnalyticsTools>>,
    linkValue = "C001"
  ): Promise<{ matches: Match[] }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (tools.resolve_identity as any).execute(
      { entityGroupName: "Customer Orders", linkValue },
      {
        toolCallId: "t",
        messages: [],
        abortSignal: new AbortController().signal,
      }
    );
  }

  const byView = (res: { matches: Match[] }) =>
    Object.fromEntries(res.matches.map((m) => [m.viewKey, m]));

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 4 });
    db = drizzle(connection, { schema });
    d = db as ReturnType<typeof drizzle>;
    reconciler = new WideTableReconcilerService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new WideTableStatementCache()
    );
    singletonStatementCache.clear();
    await teardownOrg(d);

    const owner = createUser(`auth0|owner-${generateId()}`);
    const member = createUser(`auth0|member-${generateId()}`);
    await d.insert(schema.users).values([owner, member] as never);
    ownerId = owner.id;
    memberId = member.id;
    const org = createOrganization(owner.id);
    await d.insert(schema.organizations).values(org as never);
    orgId = org.id;
    const tierSlug = `ri-${generateId().slice(0, 8)}`;
    await d.insert(schema.tiers).values({
      id: generateId(),
      ...base("RESOLVE_IDENTITY_TEST"),
      slug: tierSlug,
      displayName: "Resolve identity test",
      builtinToolpacks: ["data_query"],
    } as never);
    await d
      .update(schema.organizations)
      .set({ tier: tierSlug })
      .where(eq(schema.organizations.id, orgId));
    await seedRbacForOrg(d as never, orgId);
    await d
      .insert(schema.organizationUsers)
      .values([
        createOrganizationUser(orgId, ownerId, { role: "owner", lastLogin: 0 }),
        createOrganizationUser(orgId, memberId, { role: "member" }),
      ] as never);

    const defId = generateId();
    await d.insert(schema.connectorDefinitions).values({
      id: defId,
      slug: `cd-${defId.slice(0, 8)}`,
      display: "CD",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { read: true, write: true, sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);
    const instId = generateId();
    await d.insert(schema.connectorInstances).values({
      id: instId,
      connectorDefinitionId: defId,
      organizationId: orgId,
      name: "Inst",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true, sync: true },
      ...base(ownerId),
    } as never);
    customersId = generateId();
    ordersId = generateId();
    await d.insert(schema.connectorEntities).values([
      {
        id: customersId,
        organizationId: orgId,
        connectorInstanceId: instId,
        key: "customers",
        label: "Customers",
        ...base(ownerId),
      },
      {
        id: ordersId,
        organizationId: orgId,
        connectorInstanceId: instId,
        key: "orders",
        label: "Orders",
        ...base(ownerId),
      },
    ] as never);

    const colDef = (key: string, label: string, type: string) => ({
      id: generateId(),
      organizationId: orgId,
      key,
      label,
      type,
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      system: false,
      ...base("SYSTEM_TEST"),
    });
    const cdCust = colDef("customer_id", "Customer ID", "string");
    const cdName = colDef("name", "Name", "string");
    const cdAmount = colDef("amount", "Amount", "number");
    await d
      .insert(schema.columnDefinitions)
      .values([cdCust, cdName, cdAmount] as never);
    const mapping = (entityId: string, colId: string, nk: string) => ({
      id: generateId(),
      organizationId: orgId,
      connectorEntityId: entityId,
      columnDefinitionId: colId,
      sourceField: nk,
      isPrimaryKey: false,
      normalizedKey: nk,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
      ...base(ownerId),
    });
    fm = {
      custLink: mapping(customersId, cdCust.id, "customer_id"),
      custName: mapping(customersId, cdName.id, "name"),
      ordLink: mapping(ordersId, cdCust.id, "customer_id"),
      ordAmount: mapping(ordersId, cdAmount.id, "amount"),
    };
    await d.insert(schema.fieldMappings).values(Object.values(fm) as never);
    await reconciler.reconcileEntity(customersId, db);
    await reconciler.reconcileEntity(ordersId, db);

    await seedRow(customersId, {
      c_customer_id: "C001",
      c_name: "Alice (secret)",
    });
    await seedRow(customersId, { c_customer_id: "C001", c_name: "Bob" });
    await seedRow(ordersId, { c_customer_id: "C001", c_amount: 999 });

    const groupId = generateId();
    await d.insert(schema.entityGroups).values({
      id: groupId,
      organizationId: orgId,
      name: "Customer Orders",
      description: null,
      ...base(ownerId),
    } as never);
    await d.insert(schema.entityGroupMembers).values([
      {
        id: generateId(),
        organizationId: orgId,
        entityGroupId: groupId,
        connectorEntityId: customersId,
        linkFieldMappingId: fm.custLink.id,
        isPrimary: true,
        ...base(ownerId),
      },
      {
        id: generateId(),
        organizationId: orgId,
        entityGroupId: groupId,
        connectorEntityId: ordersId,
        linkFieldMappingId: fm.ordLink.id,
        isPrimary: false,
        ...base(ownerId),
      },
    ] as never);

    stationId = generateId();
    await d.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Resolve Identity Station",
      description: null,
      ...base(ownerId),
    } as never);
    await d.insert(schema.stationInstances).values({
      id: generateId(),
      stationId,
      connectorInstanceId: instId,
      ...base(ownerId),
    } as never);
    await d.insert(schema.stationToolpacks).values({
      id: generateId(),
      stationId,
      builtinSlug: "data_query",
      organizationToolpackId: null,
      ...base(ownerId),
    } as never);
  });

  afterEach(async () => {
    for (const id of [customersId, ordersId]) {
      try {
        await reconciler.dropTable(id, db);
      } catch {
        /* ignore */
      }
    }
    singletonStatementCache.clear();
    await teardownOrg(d);
    await d
      .delete(schema.tiers)
      .where(eq(schema.tiers.createdBy, "RESOLVE_IDENTITY_TEST"));
    await connection.end();
  });

  it("never returns a column the member's view projects out", async () => {
    await view(customersId, "customer_ids", { projection: [fm.custLink.id] });
    await view(ordersId, "order_lines"); // full projection
    const res = await (await resolveAs(memberId)).run();

    const cust = byView(res).customer_ids;
    expect(cust.entityKey).toBe("customers");
    expect(cust.records).toHaveLength(2);
    for (const r of cust.records) {
      expect(Object.keys(r).sort()).toEqual(
        ["_record_id", "c_customer_id", "source_id"].sort()
      );
    }
    expect(JSON.stringify(res)).not.toContain("Alice (secret)");
    // The granted orders view answers with its own readable columns.
    expect(byView(res).order_lines.records[0].c_amount).toBeDefined();
  });

  it("an entity with no granted view is never reached: the group isn't offered", async () => {
    // Only customers is granted — the group's `orders` member is ungranted, so
    // (#648) the group is invisible and the tool is not registered at all.
    await view(customersId, "customers_full");
    const { tools } = await resolveAs(memberId);
    expect(tools.resolve_identity).toBeUndefined();
  });

  it("applies each view's row filter, one match per granted view", async () => {
    await view(customersId, "customer_ids", { projection: [fm.custLink.id] });
    await view(customersId, "vip_customers", {
      filter: {
        combinator: "and",
        conditions: [{ field: "name", operator: "eq", value: "Bob" }],
      },
    });
    await view(ordersId, "order_lines");
    const res = await (await resolveAs(memberId)).run();

    expect(res.matches.map((m) => m.viewKey).sort()).toEqual([
      "customer_ids",
      "order_lines",
      "vip_customers",
    ]);
    const vip = byView(res).vip_customers;
    expect(vip.records.map((r) => r.c_name)).toEqual(["Bob"]);
    // Primary entity first.
    expect(res.matches[0].isPrimary).toBe(true);
  });

  it("skips a view that cannot read the link column; with no readable link the group is not found", async () => {
    await view(customersId, "customer_ids", { projection: [fm.custLink.id] });
    // The only orders view projects `amount` but NOT the join column.
    await view(ordersId, "order_amounts", { projection: [fm.ordAmount.id] });
    const { tools } = await resolveAs(memberId);
    // Scoped out at registration (the group's link column is unreadable).
    expect(tools.resolve_identity).toBeUndefined();

    // And a grant that disappears mid-session makes the call answer not-found
    // rather than falling back to a raw read.
    const orderLinesId = await view(ordersId, "order_lines");
    const withGroup = await resolveAs(memberId);
    expect(withGroup.tools.resolve_identity).toBeDefined();
    await d
      .delete(schema.permissionGrants)
      .where(
        and(
          eq(schema.permissionGrants.resourceType, "curated_view"),
          eq(schema.permissionGrants.resourceId, orderLinesId)
        )
      );
    await expect(withGroup.run()).rejects.toThrow(/Entity group not found/);
  });

  it("re-resolves grants on every call (a revoked view drops out on the next call)", async () => {
    await view(customersId, "customer_ids", { projection: [fm.custLink.id] });
    const vipId = await view(customersId, "vip_customers");
    await view(ordersId, "order_lines");
    const { run } = await resolveAs(memberId);

    expect((await run()).matches.map((m) => m.viewKey)).toContain(
      "vip_customers"
    );
    await d
      .delete(schema.permissionGrants)
      .where(
        and(
          eq(schema.permissionGrants.resourceType, "curated_view"),
          eq(schema.permissionGrants.resourceId, vipId)
        )
      );
    const after = await run();
    expect(after.matches.map((m) => m.viewKey)).not.toContain("vip_customers");
    expect(after.matches.map((m) => m.viewKey)).toContain("customer_ids");
  });

  it("an owner resolves through every attached view, each with its own projection", async () => {
    await view(customersId, "customer_ids", {
      projection: [fm.custLink.id],
      grantTo: null,
    });
    await view(customersId, "customers_full", { grantTo: null });
    await view(ordersId, "order_lines", { grantTo: null });
    const res = await (await resolveAs(ownerId)).run();

    expect(res.matches.map((m) => m.viewKey).sort()).toEqual([
      "customer_ids",
      "customers_full",
      "order_lines",
    ]);
    // The full view carries `name`; the projected view still does not.
    expect(
      byView(res)
        .customers_full.records.map((r) => r.c_name)
        .sort()
    ).toEqual(["Alice (secret)", "Bob"]);
    expect(byView(res).customer_ids.records[0].c_name).toBeUndefined();
  });

  it("reports truncated: false for matches under the per-match cap", async () => {
    // The cap + truncation itself is covered on queryViewRowsByColumn
    // (portal-sql.service.integration); here: the flag is carried through.
    await view(customersId, "customer_ids", { projection: [fm.custLink.id] });
    await view(ordersId, "order_lines");
    const res = await (await resolveAs(memberId)).run();
    expect(res.matches.length).toBeGreaterThan(0);
    for (const m of res.matches) expect(m.truncated).toBe(false);
  });

  it("returns matches with no records for a link value nothing shares", async () => {
    await view(customersId, "customer_ids", { projection: [fm.custLink.id] });
    await view(ordersId, "order_lines");
    const { tools } = await resolveAs(memberId);
    const res = await call(tools, "NO-SUCH-ID");
    expect(res.matches.map((m) => m.viewKey).sort()).toEqual([
      "customer_ids",
      "order_lines",
    ]);
    for (const m of res.matches) expect(m.records).toEqual([]);
  });

  it("rejects an unknown group name", async () => {
    await view(customersId, "customer_ids", { projection: [fm.custLink.id] });
    await view(ordersId, "order_lines");
    const { tools } = await resolveAs(memberId);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tools.resolve_identity as any).execute(
        { entityGroupName: "Nope", linkValue: "C001" },
        {
          toolCallId: "t",
          messages: [],
          abortSignal: new AbortController().signal,
        }
      )
    ).rejects.toThrow(/Entity group not found: Nope/);
  });
});
