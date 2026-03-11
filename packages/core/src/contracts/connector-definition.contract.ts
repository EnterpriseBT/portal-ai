import { z } from "zod";
import { ConnectorDefinitionSchema } from "../models/connector-definition.model.js";
import { PaginatedResponsePayloadSchema, PaginationRequestQuerySchema } from "./pagination.contract.js";


export const ConnectorDefinitionListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  category: z.string().optional(),
  authType: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
});

export type ConnectorDefinitionListRequestQuery = z.infer<typeof ConnectorDefinitionListRequestQuerySchema>;

export const ConnectorDefinitionListResponsePayloadSchema = PaginatedResponsePayloadSchema.extend({
  connectorDefinitions: z.array(ConnectorDefinitionSchema)
});

export type ConnectorDefinitionListResponsePayload = z.infer<typeof ConnectorDefinitionListResponsePayloadSchema>;

export const ConnectorDefinitionGetResponseSchema = z.object({
  connectorDefinition: ConnectorDefinitionSchema,
});

export type ConnectorDefinitionGetResponsePayload = z.infer<
  typeof ConnectorDefinitionGetResponseSchema
>;
