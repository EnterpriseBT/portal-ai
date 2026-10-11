import { z } from "zod";

import { withCapabilities } from "./capabilities.contract.js";

import { ConnectorEntitySchema } from "../models/connector-entity.model.js";
import { EntityTagSchema } from "../models/entity-tag.model.js";
import { EntityTagAssignmentSchema } from "../models/entity-tag-assignment.model.js";
import { PaginatedResponsePayloadSchema } from "./pagination.contract.js";

// ── Create ────────────────────────────────────────────────────────────

// #745: an unknown key is a 400 naming it, not silently dropped.
export const EntityTagAssignmentCreateRequestBodySchema = z
  .object({
    entityTagId: z.string(),
  })
  .strict();

export type EntityTagAssignmentCreateRequestBody = z.infer<
  typeof EntityTagAssignmentCreateRequestBodySchema
>;

export const EntityTagAssignmentCreateResponsePayloadSchema = z.object({
  entityTagAssignment: EntityTagAssignmentSchema,
});

export type EntityTagAssignmentCreateResponsePayload = z.infer<
  typeof EntityTagAssignmentCreateResponsePayloadSchema
>;

// ── List ──────────────────────────────────────────────────────────────

export const AssignedEntityTagSchema = EntityTagSchema.extend({
  assignmentId: z.string(),
});

export type AssignedEntityTag = z.infer<typeof AssignedEntityTagSchema>;

export const EntityTagAssignmentListResponsePayloadSchema = z.object({
  tags: z.array(AssignedEntityTagSchema),
});

export type EntityTagAssignmentListResponsePayload = z.infer<
  typeof EntityTagAssignmentListResponsePayloadSchema
>;

// ── Enriched connector entity schemas ─────────────────────────────────

export const ConnectorEntityWithTagsSchema = ConnectorEntitySchema.extend({
  tags: z.array(EntityTagSchema),
});

export type ConnectorEntityWithTags = z.infer<
  typeof ConnectorEntityWithTagsSchema
>;

export const ConnectorEntityListWithTagsResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    /** #688: each row with the caller's capabilities. */
    connectorEntities: z.array(withCapabilities(ConnectorEntityWithTagsSchema)),
  });

export type ConnectorEntityListWithTagsResponsePayload = z.infer<
  typeof ConnectorEntityListWithTagsResponsePayloadSchema
>;
