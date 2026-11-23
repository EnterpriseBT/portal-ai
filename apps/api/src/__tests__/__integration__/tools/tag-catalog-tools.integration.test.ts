/**
 * #1071: the tag_management catalog tools end to end. Tools are built exactly
 * as a portal session builds them (`ToolService.buildAnalyticsTools`), so the
 * input-character, permission, lock and cost gates are all real, and every
 * call runs EntityTagService against the real database.
 *
 * The test tier lists no built-in packs at all: tag_management reaches the
 * station through ALWAYS_ENTITLED_PACKS, as it does on every plan.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { TAG_TARGET_TYPES, type TagTargetType } from "@portalai/core/models";

import { ToolService } from "../../../services/tools.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { EntityTagAssignmentsRepository } from "../../../db/repositories/entity-tag-assignments.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  allowForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";
import { seedTag, seedTagTargets } from "../utils/tag-targets.util.js";

const TEST_TAG = "TAG_TOOLS_TEST";

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

const ALL = (n: number) =>
  Object.fromEntries(TAG_TARGET_TYPES.map((t) => [t, n])) as Record<
    TagTargetType,
    number
  >;

describe("tag_management catalog tools — integration (#1071)", () => {
  let connection!: ReturnType<typeof postgres>;
  let d!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;
  let stationId!: string;
  let portalId!: string;
  const repo = new EntityTagAssignmentsRepository();

  const grantMember = async (
    ...verbs: ("read" | "write" | "delete")[]
  ): Promise<void> => {
    for (const verb of verbs) {
      await allowForUser(d, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb,
        resourceType: "tag",
      });
    }
  };

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 4 });
    d = drizzle(connection, { schema });
    await teardownOrg(d);
    fx = await seedTenancyFixture(d, {
      owner: `auth0|tag-tools-owner-${generateId()}`,
      member: `auth0|tag-tools-member-${generateId()}`,
      otherOwner: `auth0|tag-tools-other-${generateId()}`,
    });

    const slug = `tt-${generateId().slice(0, 8)}`;
    await d.insert(schema.tiers).values({
      id: generateId(),
      ...base(TEST_TAG),
      slug,
      displayName: "Tag tools test",
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
  });

  afterEach(async () => {
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

  const tagRow = async (id: string) => {
    const [row] = await d
      .select()
      .from(schema.entityTags)
      .where(eq(schema.entityTags.id, id));
    return row;
  };

  // ── tag_list ─────────────────────────────────────────────────────────

  it("lists the org's tags by name, never another org's", async () => {
    await seedTag(d, fx.orgId, fx.ownerId, "Sales");
    await seedTag(d, fx.orgId, fx.ownerId, "Finance");
    await seedTag(d, fx.otherOrgId, fx.otherOwnerId, "Elsewhere");

    const r = await asOwner("tag_list", {});

    expect(r.total).toBe(2);
    expect((r.tags as { name: string }[]).map((t) => t.name)).toEqual([
      "Finance",
      "Sales",
    ]);
  });

  it("lists nothing to a member without tag read", async () => {
    await seedTag(d, fx.orgId, fx.ownerId, "Finance");
    const r = await asMember("tag_list", {});
    expect(r).toEqual({ tags: [], total: 0 });
  });

  it("lists one object's tags, and answers an unreadable object as not found", async () => {
    const tag = await seedTag(d, fx.orgId, fx.ownerId, "Finance");
    const targets = await seedTagTargets(d, fx.orgId, fx.ownerId, "o");
    await repo.insertIfAbsent(
      { type: "station", id: targets.station },
      tag,
      {
        id: generateId(),
        organizationId: fx.orgId,
        ...base("SYSTEM_TEST"),
      } as never,
      d as DbClient
    );

    const mine = await asOwner("tag_list", {
      target: { type: "station", id: targets.station },
    });
    expect((mine.tags as { id: string }[]).map((t) => t.id)).toEqual([tag]);

    await grantMember("read");
    const hidden = await asMember("tag_list", {
      target: { type: "station", id: targets.station },
    });
    expect(hidden.error?.code).toBe(ApiCode.TOOL_TARGET_NOT_FOUND);
  });

  // ── tag_create ───────────────────────────────────────────────────────

  it("creates a tag that records this session", async () => {
    const r = await asOwner("tag_create", { name: "Q4", color: "#2563EB" });

    expect(r.success).toBe(true);
    const created = r.entityTag as { id: string };
    const row = await tagRow(created.id);
    expect(row).toMatchObject({
      name: "Q4",
      color: "#2563EB",
      createdBy: fx.ownerId,
      sourcePortalId: portalId,
    });
  });

  it("refuses a member without class write (TOOL_PERMISSION_DENIED)", async () => {
    const r = await asMember("tag_create", { name: "Q4" });
    expect(r.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);
  });

  it("refuses a duplicate name with its own code", async () => {
    await seedTag(d, fx.orgId, fx.ownerId, "Q4");
    const r = await asOwner("tag_create", { name: "Q4" });
    expect(r.error?.code).toBe(ApiCode.ENTITY_TAG_DUPLICATE_NAME);
  });

  // ── tag_update ───────────────────────────────────────────────────────

  it("edits a tag the user may write", async () => {
    const id = await seedTag(d, fx.orgId, fx.ownerId, "Q4");
    const r = await asOwner("tag_update", { tagId: id, name: "Q4 Revenue" });
    expect(r.success).toBe(true);
    expect((await tagRow(id)).name).toBe("Q4 Revenue");
  });

  it("answers an unreadable tag as not found, a read-only one as denied", async () => {
    const id = await seedTag(d, fx.orgId, fx.ownerId, "Q4");

    const unseen = await asMember("tag_update", { tagId: id, name: "X" });
    expect(unseen.error?.code).toBe(ApiCode.TOOL_TARGET_NOT_FOUND);

    await grantMember("read");
    const readOnly = await asMember("tag_update", { tagId: id, name: "X" });
    expect(readOnly.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);
    expect((await tagRow(id)).name).toBe("Q4");
  });

  it("answers another org's tag as not found", async () => {
    const foreign = await seedTag(d, fx.otherOrgId, fx.otherOwnerId, "Q4");
    const r = await asOwner("tag_update", { tagId: foreign, name: "Mine" });
    expect(r.error?.code).toBe(ApiCode.TOOL_TARGET_NOT_FOUND);
    expect((await tagRow(foreign)).name).toBe("Q4");
  });

  // ── tag_delete ───────────────────────────────────────────────────────

  it("deletes a tag everywhere and counts only what the user can read", async () => {
    const id = await seedTag(d, fx.orgId, fx.ownerId, "Q4");
    for (const owner of [fx.memberId, fx.ownerId]) {
      const targets = await seedTagTargets(d, fx.orgId, owner, owner);
      for (const type of TAG_TARGET_TYPES) {
        await repo.insertIfAbsent(
          { type, id: targets[type] },
          id,
          {
            id: generateId(),
            organizationId: fx.orgId,
            ...base("SYSTEM_TEST"),
          } as never,
          d as DbClient
        );
      }
    }
    await grantMember("read", "delete");

    const r = await asMember("tag_delete", { tagId: id });

    expect(r).toEqual({ success: true, id, removedFrom: ALL(1) });
    expect((await tagRow(id)).deleted).not.toBeNull();
    const live = await d
      .select()
      .from(schema.entityTagAssignments)
      .where(eq(schema.entityTagAssignments.entityTagId, id));
    expect(live.filter((a) => a.deleted === null)).toEqual([]);
  });

  it("refuses a read-only member's delete and leaves the tag", async () => {
    const id = await seedTag(d, fx.orgId, fx.ownerId, "Q4");
    await grantMember("read");
    const r = await asMember("tag_delete", { tagId: id });
    expect(r.error?.code).toBe(ApiCode.TOOL_PERMISSION_DENIED);
    expect((await tagRow(id)).deleted).toBeNull();
  });
});
