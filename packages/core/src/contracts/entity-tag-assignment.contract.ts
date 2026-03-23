import { z } from "zod";

import { ConnectorEntitySchema } from "../models/connector-entity.model.js";
import { EntityTagSchema } from "../models/entity-tag.model.js";
import { EntityTagAssignmentSchema } from "../models/entity-tag-assignment.model.js";
import { PaginatedResponsePayloadSchema } from "./pagination.contract.js";

// ── Create ────────────────────────────────────────────────────────────

export const EntityTagAssignmentCreateRequestBodySchema = z.object({
  entityTagId: z.string(),
});

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

export const EntityTagAssignmentListResponsePayloadSchema = z.object({
  tags: z.array(EntityTagSchema),
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
    connectorEntities: z.array(ConnectorEntityWithTagsSchema),
  });

export type ConnectorEntityListWithTagsResponsePayload = z.infer<
  typeof ConnectorEntityListWithTagsResponsePayloadSchema
>;
