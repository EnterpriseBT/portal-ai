import { z } from "zod";
import { inArray } from "drizzle-orm";

import type { TagTarget } from "@portalai/core/models";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { entityTags } from "../../db/schema/index.js";
import { DbService } from "../../services/db.service.js";
import { ApiError } from "../../services/http.service.js";
import { ObjectAccessService } from "../../services/object-access.service.js";
import { PermissionService } from "../../services/permission.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { TagAssignmentService } from "../../services/tag-assignment.service.js";
import { TagTargetInputSchema } from "./tag-tool.util.js";

/** #1071: at most this many tags and objects in one assign or unassign. */
export const MAX_TAGS_PER_CALL = 10;
export const MAX_TARGETS_PER_CALL = 50;

/** `tag_assign` / `tag_unassign` input: tags by id, objects by type and id. */
export const TagAssignmentInputSchema = z
  .object({
    tagIds: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_TAGS_PER_CALL)
      .describe("Ids of the tags, from tag_list (1-10)"),
    targets: z
      .array(TagTargetInputSchema)
      .min(1)
      .max(MAX_TARGETS_PER_CALL)
      .describe("The objects, each { type, id } (1-50)"),
  })
  .strict();

export type TagAssignmentInput = z.infer<typeof TagAssignmentInputSchema>;

/** The input with repeated tags and objects removed, order kept. */
export function dedupeAssignment(input: TagAssignmentInput): {
  tagIds: string[];
  targets: TagTarget[];
} {
  const seen = new Set<string>();
  const targets = input.targets.filter((t) => {
    const key = `${t.type}:${t.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { tagIds: [...new Set(input.tagIds)], targets };
}

/**
 * #1071: check every object and tag before changing anything, so a refused
 * bulk call applies nothing. Each object must be readable (else its own 404)
 * and writable (else 403), the same check as each object's tag route; each
 * tag must be in the caller's org and readable (else 404). Throws on the
 * first failure.
 */
export async function preflightAssignment(
  ctx: PermissionContext,
  tagIds: string[],
  targets: TagTarget[]
): Promise<void> {
  for (const target of targets) {
    await TagAssignmentService.loadTarget(ctx, target, "write");
  }
  const set = await PermissionService.loadSet(ctx);
  const tags = await DbService.repository.entityTags.findMany(
    inArray(entityTags.id, tagIds)
  );
  const readable = new Set(
    tags
      .filter((tag) =>
        ObjectAccessService.readableInOrg(set, ctx.organizationId, "tag", tag)
      )
      .map((tag) => tag.id)
  );
  for (const tagId of tagIds) {
    if (!readable.has(tagId)) {
      throw new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Tag not found");
    }
  }
}
