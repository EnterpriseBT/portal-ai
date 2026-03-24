import { z } from "zod";

import { EntityGroupMemberSchema } from "../models/entity-group-member.model.js";
import { EntityRecordSchema } from "../models/entity-record.model.js";

// ── Create ────────────────────────────────────────────────────────────

export const EntityGroupMemberCreateRequestBodySchema = z.object({
  connectorEntityId: z.string(),
  linkFieldMappingId: z.string(),
  isPrimary: z.boolean().optional().default(false),
});

export type EntityGroupMemberCreateRequestBody = z.infer<
  typeof EntityGroupMemberCreateRequestBodySchema
>;

export const EntityGroupMemberCreateResponsePayloadSchema = z.object({
  entityGroupMember: EntityGroupMemberSchema,
});

export type EntityGroupMemberCreateResponsePayload = z.infer<
  typeof EntityGroupMemberCreateResponsePayloadSchema
>;

// ── Update ────────────────────────────────────────────────────────────

export const EntityGroupMemberUpdateRequestBodySchema = z
  .object({
    linkFieldMappingId: z.string().optional(),
    isPrimary: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: "At least one field must be provided",
  });

export type EntityGroupMemberUpdateRequestBody = z.infer<
  typeof EntityGroupMemberUpdateRequestBodySchema
>;

export const EntityGroupMemberUpdateResponsePayloadSchema = z.object({
  entityGroupMember: EntityGroupMemberSchema,
});

export type EntityGroupMemberUpdateResponsePayload = z.infer<
  typeof EntityGroupMemberUpdateResponsePayloadSchema
>;

// ── Overlap ───────────────────────────────────────────────────────────

export const EntityGroupMemberOverlapRequestQuerySchema = z.object({
  targetConnectorEntityId: z.string(),
  targetLinkFieldMappingId: z.string(),
});

export type EntityGroupMemberOverlapRequestQuery = z.infer<
  typeof EntityGroupMemberOverlapRequestQuerySchema
>;

export const EntityGroupMemberOverlapResponsePayloadSchema = z.object({
  overlapPercentage: z.number().min(0).max(100),
  sourceRecordCount: z.number(),
  targetRecordCount: z.number(),
  matchingRecordCount: z.number(),
});

export type EntityGroupMemberOverlapResponsePayload = z.infer<
  typeof EntityGroupMemberOverlapResponsePayloadSchema
>;

// ── Resolve ───────────────────────────────────────────────────────────

export const EntityGroupResolveRequestQuerySchema = z.object({
  linkValue: z.string(),
});

export type EntityGroupResolveRequestQuery = z.infer<
  typeof EntityGroupResolveRequestQuerySchema
>;

export const EntityGroupResolveResponsePayloadSchema = z.object({
  results: z.array(
    z.object({
      connectorEntityId: z.string(),
      connectorEntityLabel: z.string(),
      isPrimary: z.boolean(),
      records: z.array(EntityRecordSchema),
    })
  ),
});

export type EntityGroupResolveResponsePayload = z.infer<
  typeof EntityGroupResolveResponsePayloadSchema
>;
