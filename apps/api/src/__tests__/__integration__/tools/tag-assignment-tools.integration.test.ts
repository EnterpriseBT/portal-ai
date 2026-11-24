/**
 * #1071: tag_assign / tag_unassign end to end, built as a portal session
 * builds them (`ToolService.buildAnalyticsTools`), so every gate is real and
 * every call runs TagAssignmentService against the real database.
 *
 * A bulk call is all-or-nothing at pre-flight: one target the user can't
 * write (or read), or one tag they can't read, refuses the whole call and
 * applies nothing. A repeat assign or an absent unassign is a no-op status,
 * never an error.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNull } from "drizzle-orm";

import { TAG_TARGET_TYPES, type TagTargetType } from "@portalai/core/models";

import { ToolService } from "../../../services/tools.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import * as schema from "../../../db/schema/index.js";
import {
  allowForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

const TEST_TAG = "TAG_ASSIGN_TOOLS_TEST";

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
  results?: { type: string; id: string; tagId: string; status: string }[];
};

describe("tag_management assignment tools — integration (#1071)", () => {
  let connection!: ReturnType<typeof postgres>;
  let d!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;
  let stationId!: string;
  let portalId!: string;
  let finance!: string;
  let q4!: string;
  /** Objects of every type the member owns, so may write. */
  let mine!: Record<TagTargetType, string>;
  /** Objects of every type the owner owns. */
  let owners!: Record<TagTargetType, string>;

  const grant = async (
    verb: "read" | "write",
    resourceType: "tag" | "station"
  ) =>
    allowForUser(d, {
      organizationId: fx.orgId,
      userId: fx.memberId,
      verb,
      resourceType,
    });

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 4 });
    d = drizzle(connection, { schema });
    await teardownOrg(d);
    fx = await seedTenancyFixture(d, {
      owner: `auth0|tag-assign-owner-${generateId()}`,
      member: `auth0|tag-assign-member-${generateId()}`,
      otherOwner: `auth0|tag-assign-other-${generateId()}`,
    });

    const slug = `ta-${generateId().slice(0, 8)}`;
    await d.insert(schema.tiers).values({
      id: generateId(),
      ...base(TEST_TAG),
      slug,
      displayName: "Tag assign tools test",
      builtinToolpacks: [],
    } as never);
    await d
      .update(schema.organizations)
      .set({ tier: slug })
      .where(eq(schema.organizations.id, fx.orgId));

    stationId = generateId();
    await d.insert(schema.stations).values({
      id: stationId,
      organizationId: fx.orgId,
      name: "Tags station",
      description: null,
      ...base(fx.ownerId),
    } as never);
    await d.insert(schema.stationToolpacks).values({
      id: generateId(),
      stationId,
      builtinSlug: "tag_management",
      organizationToolpackId: null,
      ...base(fx.ownerId),
    } as never);
    portalId = generateId();
    await d.insert(schema.portals).values({
      id: portalId,
      organizationId: fx.orgId,
      stationId,
      name: "Portal",
      ...base(fx.ownerId),
    } as never);

    finance = await seedTag(d, fx.orgId, fx.ownerId, "Finance");
    q4 = await seedTag(d, fx.orgId, fx.ownerId, "Q4");
    mine = await seedTagTargets(d, fx.orgId, fx.memberId, "mine");
    owners = await seedTagTargets(d, fx.orgId, fx.ownerId, "owners");
    // A member holds no tag permission by default.
    await grant("read", "tag");
  });

  afterEach(async () => {
    await teardownOrg(d);
    await d.delete(schema.tiers).where(eq(schema.tiers.createdBy, TEST_TAG));
    await connection.end();
  });

  async function run(
    userId: string,
    name: string,
    input: unknown
  ): Promise<Result> {
    const tools = await ToolService.buildAnalyticsTools(
      fx.orgId,
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
  const asOwner = (name: string, input: unknown) =>
    run(fx.ownerId, name, input);
  const asMember = (name: string, input: unknown) =>
    run(fx.memberId, name, input);

  /** The live tag ids on one object. */
  const tagsOn = async (type: TagTargetType, id: string) => {
    const column = {
      entity: schema.entityTagAssignments.connectorEntityId,
      station: schema.entityTagAssignments.stationId,
      pin: schema.entityTagAssignments.portalResultId,
      connector_instance: schema.entityTagAssignments.connectorInstanceId,
      curated_view: schema.entityTagAssignments.curatedViewId,
    }[type];
    const rows = await d
      .select()
      .from(schema.entityTagAssignments)
      .where(and(eq(column, id), isNull(schema.entityTagAssignments.deleted)));
    return rows.map((r) => r.entityTagId).sort();
  };

  const liveCount = async () =>
    (
      await d
        .select()
        .from(schema.entityTagAssignments)
        .where(isNull(schema.entityTagAssignments.deleted))
    ).length;

  it.each(TAG_TARGET_TYPES)(
    "assigns and unassigns a tag on a %s",
    async (type) => {
      const target = { type, id: owners[type] };

      const added = await asOwner("tag_assign", {
        tagIds: [finance],
        targets: [target],
      });
      expect(added).toEqual({
        success: true,
        results: [
          { type, id: owners[type], tagId: finance, status: "assigned" },
        ],
      });
      expect(await tagsOn(type, owners[type])).toEqual([finance]);

      const removed = await asOwner("tag_unassign", {
        tagIds: [finance],
        targets: [target],
      });
      expect(removed).toEqual({
        success: true,
        results: [
          { type, id: owners[type], tagId: finance, status: "removed" },
        ],
      });
      expect(await tagsOn(type, owners[type])).toEqual([]);
    }
  );

  it("applies several tags to several types in one call", async () => {
    const r = await asOwner("tag_assign", {
      tagIds: [finance, q4],
      targets: [
        { type: "entity", id: owners.entity },
        { type: "curated_view", id: owners.curated_view },
      ],
    });

    expect(r.results).toHaveLength(4);
    expect(r.results!.every((x) => x.status === "assigned")).toBe(true);
    expect(await tagsOn("entity", owners.entity)).toEqual([finance, q4].sort());
    expect(await tagsOn("curated_view", owners.curated_view)).toEqual(
      [finance, q4].sort()
    );
  });

  it("reports a repeat assign as already_assigned, not an error", async () => {
    const target = { type: "station", id: owners.station };
    await asOwner("tag_assign", { tagIds: [finance], targets: [target] });

    const again = await asOwner("tag_assign", {
      tagIds: [finance, q4],
      targets: [target],
    });

    expect(again.results).toEqual([
      { ...target, tagId: finance, status: "already_assigned" },
      { ...target, tagId: q4, status: "assigned" },
    ]);
    expect(await tagsOn("station", owners.station)).toEqual(
      [finance, q4].sort()
    );
  });

  it("reports an absent unassign as not_assigned, not an error", async () => {
    const r = await asOwner("tag_unassign", {
      tagIds: [finance],
      targets: [{ type: "pin", id: owners.pin }],
    });
    expect(r.results).toEqual([
      { type: "pin", id: owners.pin, tagId: finance, status: "not_assigned" },
    ]);
  });

  it("dedupes repeated tags and targets", async () => {
    const target = { type: "station", id: owners.station };
    const r = await asOwner("tag_assign", {
      tagIds: [finance, finance],
      targets: [target, target],
    });
    expect(r.results).toEqual([
      { ...target, tagId: finance, status: "assigned" },
    ]);
  });

  it("lets a member tag objects they own", async () => {
    const r = await asMember("tag_assign", {
      tagIds: [finance],
      targets: [{ type: "station", id: mine.station }],
    });
    expect(r.success).toBe(true);
    expect(await tagsOn("station", mine.station)).toEqual([finance]);
  });

  it("refuses the whole call when one target is read-only, applying nothing", async () => {
    // The member reads every station but writes only their own.
    await grant("read", "station");
    const before = await liveCount();

    const r = await asMember("tag_assign", {
      tagIds: [finance],
      targets: [
        { type: "station", id: mine.station },
        { type: "station", id: owners.station },
      ],
    });

    expect(r.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);
    expect(await liveCount()).toBe(before);
    expect(await tagsOn("station", mine.station)).toEqual([]);
  });

  it("refuses the whole call when one target is unreadable, applying nothing", async () => {
    const before = await liveCount();

    const r = await asMember("tag_assign", {
      tagIds: [finance],
      targets: [
        { type: "station", id: mine.station },
        { type: "curated_view", id: owners.curated_view },
      ],
    });

    expect(r.error?.code).toBe(ApiCode.TOOL_TARGET_NOT_FOUND);
    expect(await liveCount()).toBe(before);
  });

  it("answers another org's object as not found", async () => {
    const foreign = await seedTagTargets(
      d,
      fx.otherOrgId,
      fx.otherOwnerId,
      "foreign"
    );
    const r = await asOwner("tag_assign", {
      tagIds: [finance],
      targets: [{ type: "station", id: foreign.station }],
    });
    expect(r.error?.code).toBe(ApiCode.TOOL_TARGET_NOT_FOUND);
    expect(await tagsOn("station", foreign.station)).toEqual([]);
  });

  it("answers a tag the user can't read as not found, applying nothing", async () => {
    const elsewhere = await seedTag(d, fx.otherOrgId, fx.otherOwnerId, "X");
    const before = await liveCount();

    const r = await asOwner("tag_assign", {
      tagIds: [finance, elsewhere],
      targets: [{ type: "station", id: owners.station }],
    });

    expect(r.error?.code).toBe(ApiCode.TOOL_TARGET_NOT_FOUND);
    expect(await liveCount()).toBe(before);
  });

  it("refuses a read-only unassign, leaving the tag", async () => {
    await asOwner("tag_assign", {
      tagIds: [finance],
      targets: [{ type: "station", id: owners.station }],
    });
    await grant("read", "station");

    const r = await asMember("tag_unassign", {
      tagIds: [finance],
      targets: [{ type: "station", id: owners.station }],
    });

    expect(r.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);
    expect(await tagsOn("station", owners.station)).toEqual([finance]);
  });

  it("rejects more than 10 tags or 50 targets", async () => {
    const tools = await ToolService.buildAnalyticsTools(
      fx.orgId,
      stationId,
      fx.ownerId,
      portalId
    );
    expect(tools.tag_assign).toBeDefined();
    const { TagAssignTool } =
      await import("../../../tools/tags/tag-assign.tool.js");
    const schema_ = new TagAssignTool().schema;
    const target = { type: "station", id: owners.station };
    expect(
      schema_.safeParse({
        tagIds: Array.from({ length: 11 }, (_, i) => `t${i}`),
        targets: [target],
      }).success
    ).toBe(false);
    expect(
      schema_.safeParse({
        tagIds: [finance],
        targets: Array.from({ length: 51 }, (_, i) => ({
          type: "station",
          id: `s${i}`,
        })),
      }).success
    ).toBe(false);
    expect(schema_.safeParse({ tagIds: [], targets: [target] }).success).toBe(
      false
    );
  });
});
