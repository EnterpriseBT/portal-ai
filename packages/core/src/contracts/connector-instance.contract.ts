import { z } from "zod";
import { ConnectorDefinitionSchema } from "../models/connector-definition.model.js";
import { ConnectorInstanceSchema } from "../models/connector-instance.model.js";
import { PaginatedResponsePayloadSchema, PaginationRequestQuerySchema } from "./pagination.contract.js";

/**
 * API-facing schema for connector instances.
 * Overrides `credentials` from the DB-layer `string | null` back to the
 * decrypted `Record<string, unknown> | null` that API consumers expect.
 */
export const ConnectorInstanceApiSchema = ConnectorInstanceSchema.extend({
  credentials: z.record(z.string(), z.unknown()).nullable(),
});

export type ConnectorInstanceApi = z.infer<typeof ConnectorInstanceApiSchema>;

export const ConnectorInstanceListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  connectorDefinitionId: z.string().optional(),
  status: z.string().optional(),
  include: z.string().optional(),
});

export type ConnectorInstanceListRequestQuery = z.infer<typeof ConnectorInstanceListRequestQuerySchema>;

/** API schema for connector instances with their associated definition attached. */
export const ConnectorInstanceWithDefinitionApiSchema = ConnectorInstanceApiSchema.extend({
  connectorDefinition: ConnectorDefinitionSchema.nullable(),
});

export type ConnectorInstanceWithDefinitionApi = z.infer<typeof ConnectorInstanceWithDefinitionApiSchema>;

export const ConnectorInstanceListResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  connectorInstances: z.array(ConnectorInstanceApiSchema),
});

export type ConnectorInstanceListResponsePayload = z.infer<typeof ConnectorInstanceListResponsePayloadSchema>;

export const ConnectorInstanceListWithDefinitionResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  connectorInstances: z.array(ConnectorInstanceWithDefinitionApiSchema),
});

export type ConnectorInstanceListWithDefinitionResponsePayload = z.infer<typeof ConnectorInstanceListWithDefinitionResponsePayloadSchema>;

export const ConnectorInstanceGetResponseSchema = z.object({
  connectorInstance: ConnectorInstanceWithDefinitionApiSchema,
});

export type ConnectorInstanceGetResponsePayload = z.infer<
  typeof ConnectorInstanceGetResponseSchema
>;

export const ConnectorInstanceCreateRequestBodySchema = z.object({
  connectorDefinitionId: z.string(),
  organizationId: z.string(),
  name: z.string().min(1),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  credentials: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type ConnectorInstanceCreateRequestBody = z.infer<typeof ConnectorInstanceCreateRequestBodySchema>;

export const ConnectorInstanceCreateResponseSchema = z.object({
  connectorInstance: ConnectorInstanceApiSchema,
});

export type ConnectorInstanceCreateResponsePayload = z.infer<
  typeof ConnectorInstanceCreateResponseSchema
>;
