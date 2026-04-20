import { z } from "zod";
import { ConnectorDefinitionSchema } from "../models/connector-definition.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

export const ConnectorDefinitionListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    sortBy: z.string().optional().default("display"),
    category: z.string().optional(),
    authType: z.string().optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    search: z.string().optional(),
  });

export type ConnectorDefinitionListRequestQuery = z.infer<
  typeof ConnectorDefinitionListRequestQuerySchema
>;

export const ConnectorDefinitionListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    connectorDefinitions: z.array(ConnectorDefinitionSchema),
  });

export type ConnectorDefinitionListResponsePayload = z.infer<
  typeof ConnectorDefinitionListResponsePayloadSchema
>;

export const ConnectorDefinitionGetResponseSchema = z.object({
  connectorDefinition: ConnectorDefinitionSchema,
});

export type ConnectorDefinitionGetResponsePayload = z.infer<
  typeof ConnectorDefinitionGetResponseSchema
>;
