import { z } from "zod";

import type { PermissionResourceType } from "./permission.model.js";

/**
 * The object types a tag can be assigned to (#1070). Each name is also the
 * object's permission resource type, so assigning a tag checks `resource.write`
 * on exactly the object it lands on.
 */
export const TAG_TARGET_TYPES = [
  "entity",
  "station",
  "pin",
  "connector_instance",
  "curated_view",
] as const;

export const TagTargetTypeSchema = z.enum(TAG_TARGET_TYPES);
export type TagTargetType = z.infer<typeof TagTargetTypeSchema>;

/** One object a tag is (or will be) assigned to. */
export const TagTargetSchema = z.object({
  type: TagTargetTypeSchema,
  id: z.string(),
});
export type TagTarget = z.infer<typeof TagTargetSchema>;

/** The permission resource type checked for each target type. */
export const TAG_TARGET_PERMISSION_TYPE: Record<
  TagTargetType,
  PermissionResourceType
> = {
  entity: "entity",
  station: "station",
  pin: "pin",
  connector_instance: "connector_instance",
  curated_view: "curated_view",
};
