/**
 * #848: the two stations every new org is provisioned with, exercised the way
 * a portal session uses them. Tools are built exactly as a session builds them
 * (`ToolService.buildAnalyticsTools`), so the permission, lock, input and cost
 * gates are all real.
 *
 * - **Administrate** (the default): access tools, no data.
 * - **Playground**: the Sandbox connector plus the packs to build entities and
 *   views, attach a view and query it in one session (#1036).
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import pino from "pino";
import { and, eq, isNull } from "drizzle-orm";

import { ApplicationService } from "../../../services/application.service.js";
import { ToolService } from "../../../services/tools.service.js";
import { SeedService } from "../../../services/seed.service.js";
import { EntitlementService } from "../../../services/entitlement.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { PROVISIONED_STATIONS } from "../../../constants/provisioned-stations.constants.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { requestContext } from "../../../utils/request-context.util.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganizationUser,
  provisionTestOrg,
} from "../utils/application.util.js";

const TEST_TAG = "PROVISIONED_STATIONS_TEST";

type Result = Record<string, unknown> & {
  error?: { code: string; message: string };
};

describe("provisioned stations in a portal session — integration (#848)", () => {
  let connection!: ReturnType<typeof postgres>;
  let d!: ReturnType<typeof drizzle>;
  let orgId: string;
  let ownerId: string;
  let memberId: string;
  let administrateId: string;
  let playgroundId: string;
  let sandboxId: string;
  const createdEntityIds: string[] = [];

  /** A tier that includes exactly `builtinToolpacks`, set on the org. */
  async function useTier(builtinToolpacks: string[]): Promise<void> {
    const slug = `ps-${generateId().slice(0, 8)}`;
    await d.insert(schema.tiers).values({
      id: generateId(),
      created: Date.now(),
      createdBy: TEST_TAG,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      slug,
      displayName: "Provisioned stations test",
      builtinToolpacks,
    } as never);
    await d
      .update(schema.organizations)
      .set({ tier: slug })
      .where(eq(schema.organizations.id, orgId));
  }

  const stationNamed = async (name: string) => {
    const [row] = await d
      .select()
      .from(schema.stations)
      .where(
        and(
          eq(schema.stations.organizationId, orgId),
          eq(schema.stations.name, name),
          isNull(schema.stations.deleted)
        )
      );
    return row;
  };

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 4 });
    d = drizzle(connection, { schema });
    await teardownOrg(d);
    await new SeedService().seedConnectorDefinitions(d as unknown as DbClient);

    // The real provisioning path: user row, org, both stations, RBAC roles.
    const owner = createUser(`auth0|owner-${generateId()}`);
    const provisioned = await provisionTestOrg(owner as never);
    ownerId = provisioned.user.id;
    orgId = provisioned.organization.id;

    const member = createUser(`auth0|member-${generateId()}`);
    await d.insert(schema.users).values(member as never);
    memberId = member.id;
    await d.insert(schema.organizationUsers).values(
      createOrganizationUser(orgId, memberId, {
        role: "member",
        lastLogin: 0,
      }) as never
    );

    administrateId = (await stationNamed("Administrate")).id;
    playgroundId = (await stationNamed("Playground")).id;
    const [sandbox] = await d
      .select()
      .from(schema.connectorInstances)
      .where(eq(schema.connectorInstances.organizationId, orgId));
    sandboxId = sandbox.id;
    createdEntityIds.length = 0;
  });

  afterEach(async () => {
    for (const id of createdEntityIds) {
      try {
        await wideTableReconcilerService.dropTable(
          id,
          d as unknown as DbClient
        );
      } catch {
        /* ignore */
      }
    }
    await teardownOrg(d);
    await d.delete(schema.tiers).where(eq(schema.tiers.createdBy, TEST_TAG));
    await connection.end();
  });

  /** The tools a portal session on `stationId` gets for `userId`. */
  async function sessionTools(stationId: string, userId: string) {
    const tools = await ToolService.buildAnalyticsTools(
      orgId,
      stationId,
      userId
    );
    return {
      names: Object.keys(tools),
      call: (name: string, input: unknown) => {
        const t = tools[name] as {
          execute: (i: unknown, o: unknown) => Promise<Result>;
        };
        expect(t).toBeDefined();
        return t.execute(input, {
          toolCallId: "t",
          messages: [],
          abortSignal: new AbortController().signal,
        });
      },
    };
  }

  it("provisions Administrate and Playground (with the Sandbox)", async () => {
    expect(administrateId).toBeDefined();

    for (const expected of PROVISIONED_STATIONS) {
      const station = await stationNamed(expected.name);
      expect(station.description).toBe(expected.description);
      const packs = await d
        .select()
        .from(schema.stationToolpacks)
        .where(
          and(
            eq(schema.stationToolpacks.stationId, station.id),
            isNull(schema.stationToolpacks.deleted)
          )
        );
      expect(packs.map((p) => p.builtinSlug).sort()).toEqual(
        [...expected.builtinSlugs].sort()
      );
      const links = await d
        .select()
        .from(schema.stationInstances)
        .where(eq(schema.stationInstances.stationId, station.id));
      expect(links.map((l) => l.connectorInstanceId)).toEqual(
        expected.attachSandbox ? [sandboxId] : []
      );
    }
  });

  // #1114: `portalai org create --json` reports stationIds[0] as `stationId`.
  it("provisioning returns Administrate's id first", async () => {
    const result = await ApplicationService.provisionOrganizationFor(ownerId, {
      name: "Second org",
    });
    const [first] = await d
      .select()
      .from(schema.stations)
      .where(eq(schema.stations.id, result.stationIds[0]!));
    expect(first?.name).toBe(PROVISIONED_STATIONS[0]!.name);
    expect(first?.organizationId).toBe(result.organization.id);
    expect(result.stationIds).toHaveLength(PROVISIONED_STATIONS.length);
  });

  it("a pack the tier lacks is attached all the same and reported as unentitled", async () => {
    // Provisioning never checks entitlement. On a tier without
    // view_management the pack stays attached to Playground and reads as
    // inactive, rather than failing the org's creation.
    await useTier(["data_query", "entity_management"]);
    const packs = await EntitlementService.resolveStationPacks(
      playgroundId,
      orgId
    );
    expect(packs.unentitled).toContain("view_management");
    // Help is always entitled (#1050), so it stays effective even here.
    expect(packs.effective.sort()).toEqual([
      "data_query",
      "entity_management",
      "help",
    ]);
  });

  it("both stations carry the Help pack, active on a tier whose list lacks it (#1044)", async () => {
    await useTier(["rbac_management", "data_query"]);
    for (const stationId of [administrateId, playgroundId]) {
      const packs = await EntitlementService.resolveStationPacks(
        stationId,
        orgId
      );
      expect(packs.effective).toContain("help");
      expect(packs.unentitled).not.toContain("help");
    }
  });

  it("Administrate carries the Members pack, active on a tier whose list lacks it (#847)", async () => {
    await useTier(["rbac_management"]);
    const packs = await EntitlementService.resolveStationPacks(
      administrateId,
      orgId
    );
    expect(packs.effective).toContain("member_management");
    expect(packs.unentitled).not.toContain("member_management");
  });

  it("Administrate carries the Tags pack, active on a tier whose list lacks it (#1071)", async () => {
    await useTier(["rbac_management"]);
    const packs = await EntitlementService.resolveStationPacks(
      administrateId,
      orgId
    );
    expect(packs.effective).toContain("tag_management");
    expect(packs.unentitled).not.toContain("tag_management");
  });

  it("a member on Administrate gets a typed refusal from an access tool", async () => {
    await useTier(["rbac_management"]);
    const { call } = await sessionTools(administrateId, memberId);
    const r = await call("grant_share", {
      resourceType: "station",
      resourceId: administrateId,
      grantee: { type: "team" },
      access: "read",
    });
    expect(r.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);
  });

  it("a member on Playground gets typed refusals for writes on the system-owned Sandbox and station", async () => {
    await useTier(["data_query", "entity_management", "view_management"]);
    const { call } = await sessionTools(playgroundId, memberId);

    const create = await call("connector_entity_create", {
      items: [
        { connectorInstanceId: sandboxId, key: "widgets", label: "Widgets" },
      ],
    });
    expect(create.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);

    const attach = await call("curated_view_attach", {
      curatedViewIds: [generateId()],
    });
    expect(attach.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);

    const entities = await d
      .select()
      .from(schema.connectorEntities)
      .where(eq(schema.connectorEntities.organizationId, orgId));
    expect(entities).toHaveLength(0);
  });

  it("the owner builds an entity and a view on Playground, attaches it and queries it in one turn", async () => {
    await useTier(["data_query", "entity_management", "view_management"]);
    const [nameDef] = await d
      .select()
      .from(schema.columnDefinitions)
      .where(
        and(
          eq(schema.columnDefinitions.organizationId, orgId),
          eq(schema.columnDefinitions.key, "name")
        )
      );
    expect(nameDef).toBeDefined();

    // One portal turn: every call shares one request store, as a turn does.
    await requestContext.run({ log: pino({ level: "silent" }) }, async () => {
      const { call } = await sessionTools(playgroundId, ownerId);

      const entity = await call("connector_entity_create", {
        items: [
          { connectorInstanceId: sandboxId, key: "widgets", label: "Widgets" },
        ],
      });
      expect(entity.error).toBeUndefined();
      const entityId = (entity.items as { entityId: string }[])[0].entityId;
      createdEntityIds.push(entityId);

      const mapping = await call("field_mapping_create", {
        items: [
          {
            connectorEntityId: entityId,
            columnDefinitionId: nameDef.id,
            sourceField: "name",
            normalizedKey: "name",
          },
        ],
      });
      expect(mapping.error).toBeUndefined();

      const records = await call("entity_record_create", {
        items: [
          { connectorEntityId: entityId, data: { name: "Acme" } },
          { connectorEntityId: entityId, data: { name: "Bolt" } },
        ],
      });
      expect(records.error).toBeUndefined();

      const view = await call("curated_view_create", {
        connectorEntityId: entityId,
        key: "all_widgets",
        label: "All widgets",
      });
      expect(view.error).toBeUndefined();
      const viewId = (view.curatedView as { id: string }).id;

      const attached = await call("curated_view_attach", {
        curatedViewIds: [viewId],
      });
      expect(attached).toMatchObject({
        success: true,
        stationId: playgroundId,
        isSessionStation: true,
        added: [viewId],
      });

      const rows = await call("sql_query", {
        sql: 'SELECT "c_name" FROM "all_widgets" ORDER BY "c_name"',
      });
      expect(rows.error).toBeUndefined();
      expect(JSON.stringify(rows)).toContain("Acme");
      expect(JSON.stringify(rows)).toContain("Bolt");
    });
  });
});
