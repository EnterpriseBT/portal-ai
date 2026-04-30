import { z } from "zod";
import { ConnectorDefinitionSchema } from "../models/connector-definition.model.js";
import { ConnectorInstanceSchema } from "../models/connector-instance.model.js";
import {
  PaginatedResponsePayloadSchema,
  PaginationRequestQuerySchema,
} from "./pagination.contract.js";

/**
 * Connector-defined public projection of a credential blob.
 *
 * Adapters opt into surfacing fields by implementing
 * `ConnectorAdapter.toPublicAccountInfo`. The `identity` field is the
 * one-line summary the connector card chip renders (typically an email
 * or workspace name); `metadata` is a free-form bag of additional public
 * fields the detail view renders generically. Primitive-only values in
 * `metadata` so the UI can humanize keys + stringify values without
 * recursion.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-A.plan.md` §Slice 9.
 */
export const PublicAccountInfoSchema = z.object({
  identity: z.string().nullable(),
  metadata: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean()])
  ),
});

export type PublicAccountInfo = z.infer<typeof PublicAccountInfoSchema>;

export const EMPTY_ACCOUNT_INFO: PublicAccountInfo = {
  identity: null,
  metadata: {},
};

/**
 * API-facing schema for connector instances. The repository decrypts
 * `credentials` on read; the API layer redacts it before responding and
 * surfaces only the connector-defined `accountInfo` projection.
 */
export const ConnectorInstanceApiSchema = ConnectorInstanceSchema.omit({
  credentials: true,
}).extend({
  accountInfo: PublicAccountInfoSchema,
  /**
   * Whether this instance can run a manual sync. `true` if it has a
   * committed plan with stable identity strategies (`column`/`composite`);
   * `false` if it has no plan or a plan using `rowPosition` identity
   * (positional ids shift on every row insert/delete, making sync
   * pathological). `undefined` on list endpoints to avoid n+1 plan
   * lookups — the UI's sync affordance reads from the detail view only.
   *
   * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-D.plan.md` §Slice 5.
   */
  syncEligible: z.boolean().optional(),
});

export type ConnectorInstanceApi = z.infer<typeof ConnectorInstanceApiSchema>;

export const ConnectorInstanceListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    connectorDefinitionId: z.string().optional(),
    status: z.string().optional(),
    include: z.string().optional(),
    capability: z.string().optional(),
  });

export type ConnectorInstanceListRequestQuery = z.infer<
  typeof ConnectorInstanceListRequestQuerySchema
>;

/** API schema for connector instances with their associated definition attached. */
export const ConnectorInstanceWithDefinitionApiSchema =
  ConnectorInstanceApiSchema.extend({
    connectorDefinition: ConnectorDefinitionSchema.nullable(),
  });

export type ConnectorInstanceWithDefinitionApi = z.infer<
  typeof ConnectorInstanceWithDefinitionApiSchema
>;

export const ConnectorInstanceListResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    connectorInstances: z.array(ConnectorInstanceApiSchema),
  });

export type ConnectorInstanceListResponsePayload = z.infer<
  typeof ConnectorInstanceListResponsePayloadSchema
>;

export const ConnectorInstanceListWithDefinitionResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    connectorInstances: z.array(ConnectorInstanceWithDefinitionApiSchema),
  });

export type ConnectorInstanceListWithDefinitionResponsePayload = z.infer<
  typeof ConnectorInstanceListWithDefinitionResponsePayloadSchema
>;

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
  status: z.enum(["active", "inactive", "error", "pending"]),
  /**
   * Per-instance capability overrides. When omitted, the server copies
   * `definition.capabilityFlags` so the instance inherits whatever the
   * connector type supports. Callers only send this field when they
   * want to opt out of one or more capabilities at creation time
   * (e.g. read-only against a write-capable connector).
   */
  enabledCapabilityFlags: z
    .object({
      sync: z.boolean().optional(),
      read: z.boolean().optional(),
      write: z.boolean().optional(),
      push: z.boolean().optional(),
    })
    .optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  credentials: z.record(z.string(), z.unknown()).nullable().optional(),
});

export type ConnectorInstanceCreateRequestBody = z.infer<
  typeof ConnectorInstanceCreateRequestBodySchema
>;

export const ConnectorInstanceCreateResponseSchema = z.object({
  connectorInstance: ConnectorInstanceApiSchema,
});

export type ConnectorInstanceCreateResponsePayload = z.infer<
  typeof ConnectorInstanceCreateResponseSchema
>;

export const ConnectorInstancePatchRequestBodySchema = z.object({
  name: z.string().min(1, "Name is required"),
  enabledCapabilityFlags: z
    .object({
      sync: z.boolean().optional(),
      read: z.boolean().optional(),
      write: z.boolean().optional(),
      push: z.boolean().optional(),
    })
    .nullable()
    .optional(),
});

export type ConnectorInstancePatchRequestBody = z.infer<
  typeof ConnectorInstancePatchRequestBodySchema
>;

export const ConnectorInstanceImpactResponseSchema = z.object({
  connectorEntities: z.number(),
  entityRecords: z.number(),
  fieldMappings: z.number(),
  entityTagAssignments: z.number(),
  entityGroupMembers: z.number(),
  stations: z.number(),
});

export type ConnectorInstanceImpact = z.infer<
  typeof ConnectorInstanceImpactResponseSchema
>;
