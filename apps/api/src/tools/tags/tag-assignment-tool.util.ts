import { z } from "zod";

import type { TagTarget } from "@portalai/core/models";

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
