import { z } from "zod";

import { withCapabilities } from "./capabilities.contract.js";

import { EntityTagSchema } from "../models/entity-tag.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── List ──────────────────────────────────────────────────────────────

export const EntityTagListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    sortBy: z.enum(["name", "created"]).optional().default("created"),
  });

export type EntityTagListRequestQuery = z.infer<
  typeof EntityTagListRequestQuerySchema
>;

export const EntityTagListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    /** #688: each row with the caller's capabilities. */
    entityTags: z.array(withCapabilities(EntityTagSchema)),
  });

export type EntityTagListResponsePayload = z.infer<
  typeof EntityTagListResponsePayloadSchema
>;

// ── Enriched schema (tag + assignment count) ──────────────────────────

export const EntityTagWithAssignmentCountSchema = EntityTagSchema.extend({
  assignmentCount: z.number().int().min(0),
});

export type EntityTagWithAssignmentCount = z.infer<
  typeof EntityTagWithAssignmentCountSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const EntityTagGetResponsePayloadSchema = z.object({
  entityTag: withCapabilities(EntityTagSchema),
});

export type EntityTagGetResponsePayload = z.infer<
  typeof EntityTagGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

export const EntityTagCreateRequestBodySchema = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  description: z.string().optional(),
});

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

export const EntityTagUpdateRequestBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().optional(),
    description: z.string().optional(),
  })
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
