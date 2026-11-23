import { z } from "zod";

import { descriptionField, nameField } from "./text-limits.contract.js";

import { withCapabilities } from "./capabilities.contract.js";

import { EntityTagSchema } from "../models/entity-tag.model.js";
import { TagTargetTypeSchema } from "../models/tag-target.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── Usage (#1070) ─────────────────────────────────────────────────────

/**
 * How many objects of each type carry a tag, counting only objects the
 * caller can read. Every type is present, zero included.
 */
export const TagUsageSchema = z.record(
  TagTargetTypeSchema,
  z.number().int().min(0)
);

export type TagUsage = z.infer<typeof TagUsageSchema>;

/** A tag list row: the tag, plus its usage with `include=usage`. */
export const EntityTagWithUsageSchema = EntityTagSchema.extend({
  usage: TagUsageSchema.optional(),
});

export type EntityTagWithUsage = z.infer<typeof EntityTagWithUsageSchema>;

// ── List ──────────────────────────────────────────────────────────────

export const EntityTagListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    sortBy: z.enum(["name", "created"]).optional().default("created"),
    /** #1070: `usage` adds each tag's per-type counts. */
    include: z.string().optional(),
  });

export type EntityTagListRequestQuery = z.infer<
  typeof EntityTagListRequestQuerySchema
>;

export const EntityTagListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    /** #688: each row with the caller's capabilities. */
    entityTags: z.array(withCapabilities(EntityTagWithUsageSchema)),
  });

export type EntityTagListResponsePayload = z.infer<
  typeof EntityTagListResponsePayloadSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const EntityTagGetResponsePayloadSchema = z.object({
  entityTag: withCapabilities(EntityTagSchema),
});

export type EntityTagGetResponsePayload = z.infer<
  typeof EntityTagGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

// #745: an unknown key is a 400 naming it, not silently dropped.
export const EntityTagCreateRequestBodySchema = z
  .object({
    name: nameField(),
    color: z.string().optional(),
    description: descriptionField().optional(),
  })
  .strict();

export type EntityTagCreateRequestBody = z.infer<
  typeof EntityTagCreateRequestBodySchema
>;

export const EntityTagCreateResponsePayloadSchema = z.object({
  entityTag: EntityTagSchema,
});

export type EntityTagCreateResponsePayload = z.infer<
  typeof EntityTagCreateResponsePayloadSchema
>;

// ── Update ────────────────────────────────────────────────────────────

// #745: an unknown key is a 400 naming it, not silently dropped.
export const EntityTagUpdateRequestBodySchema = z
  .object({
    name: nameField().optional(),
    color: z.string().optional(),
    description: descriptionField().optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export type EntityTagUpdateRequestBody = z.infer<
  typeof EntityTagUpdateRequestBodySchema
>;

export const EntityTagUpdateResponsePayloadSchema = z.object({
  entityTag: EntityTagSchema,
});

export type EntityTagUpdateResponsePayload = z.infer<
  typeof EntityTagUpdateResponsePayloadSchema
>;
