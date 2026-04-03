import { z } from "zod";

import { EntityGroupSchema } from "../models/entity-group.model.js";
import { EntityGroupMemberSchema } from "../models/entity-group-member.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

// ── Enriched schemas ─────────────────────────────────────────────────

export const EntityGroupMemberWithDetailsSchema =
  EntityGroupMemberSchema.extend({
    connectorEntityLabel: z.string(),
    linkFieldMappingSourceField: z.string(),
  });

export type EntityGroupMemberWithDetails = z.infer<
  typeof EntityGroupMemberWithDetailsSchema
>;

export const EntityGroupWithMembersSchema = EntityGroupSchema.extend({
  members: z.array(EntityGroupMemberWithDetailsSchema),
});

export type EntityGroupWithMembers = z.infer<
  typeof EntityGroupWithMembersSchema
>;

// ── List ──────────────────────────────────────────────────────────────

export const EntityGroupListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    search: z.string().optional(),
    sortBy: z.enum(["name", "created"]).optional().default("created"),
    include: z.string().optional(),
    connectorEntityId: z.string().optional(),
  });

export type EntityGroupListRequestQuery = z.infer<
  typeof EntityGroupListRequestQuerySchema
>;

export const EntityGroupListItemSchema = EntityGroupSchema.extend({
  memberCount: z.number(),
});

export type EntityGroupListItem = z.infer<typeof EntityGroupListItemSchema>;

export const EntityGroupListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    entityGroups: z.array(EntityGroupListItemSchema),
  });

export type EntityGroupListResponsePayload = z.infer<
  typeof EntityGroupListResponsePayloadSchema
>;

// ── Get ───────────────────────────────────────────────────────────────

export const EntityGroupGetResponsePayloadSchema = z.object({
  entityGroup: EntityGroupWithMembersSchema,
});

export type EntityGroupGetResponsePayload = z.infer<
  typeof EntityGroupGetResponsePayloadSchema
>;

// ── Create ────────────────────────────────────────────────────────────

export const EntityGroupCreateRequestBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export type EntityGroupCreateRequestBody = z.infer<
  typeof EntityGroupCreateRequestBodySchema
>;

export const EntityGroupCreateResponsePayloadSchema = z.object({
  entityGroup: EntityGroupSchema,
});

export type EntityGroupCreateResponsePayload = z.infer<
  typeof EntityGroupCreateResponsePayloadSchema
>;

// ── Update ────────────────────────────────────────────────────────────

export const EntityGroupUpdateRequestBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export type EntityGroupUpdateRequestBody = z.infer<
  typeof EntityGroupUpdateRequestBodySchema
>;

export const EntityGroupUpdateResponsePayloadSchema = z.object({
  entityGroup: EntityGroupSchema,
});

export type EntityGroupUpdateResponsePayload = z.infer<
  typeof EntityGroupUpdateResponsePayloadSchema
>;

// ── Delete ───────────────────────────────────────────────────────────

export const EntityGroupDeleteResponsePayloadSchema = z.object({
  id: z.string(),
  cascaded: z.object({
    entityGroupMembers: z.number(),
  }),
});

export type EntityGroupDeleteResponsePayload = z.infer<
  typeof EntityGroupDeleteResponsePayloadSchema
>;

// ── Impact ───────────────────────────────────────────────────────────

export const EntityGroupImpactResponsePayloadSchema = z.object({
  entityGroupMembers: z.number(),
});

export type EntityGroupImpactResponsePayload = z.infer<
  typeof EntityGroupImpactResponsePayloadSchema
>;
