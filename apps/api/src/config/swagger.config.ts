import swaggerJsdoc from "swagger-jsdoc";
import { z } from "zod";

import {
  ApiColumnSuggestionSchema,
  ApiEndpointEntityWireSchema,
  ApiEndpointListResponsePayloadSchema,
  ApiEndpointWireSchema,
  ColumnBindingSchema,
  CreateApiEndpointRequestBodySchema,
  DeleteApiEndpointResponsePayloadSchema,
  DiscoverColumnsRequestBodySchema,
  DiscoverColumnsResultSchema,
  DiscoveredColumnWithSuggestionSchema,
  DriftReportSchema,
  HeaderStrategySchema,
  IdentityStrategySchema,
  InterpretInputSchema,
  InterpretRequestBodySchema,
  InterpretResponsePayloadSchema,
  LayoutPlanCommitDraftRequestBodySchema,
  LayoutPlanCommitDraftResponsePayloadSchema,
  LayoutPlanCommitResultSchema,
  LayoutPlanInterpretDraftResponsePayloadSchema,
  LayoutPlanSchema,
  PatchApiEndpointRequestBodySchema,
  RegionHintSchema,
  RegionSchema,
  SkipRuleSchema,
  TestConnectionRequestBodySchema,
  TestConnectionResultSchema,
  WarningSchema,
  OrganizationUsageGetResponseSchema,
  OrganizationGetResponseSchema,
  UserMembershipsGetResponseSchema,
  OrganizationSwitchRequestSchema,
  OrganizationDeleteRequestSchema,
  OrganizationDeleteResponseSchema,
  BillingTiersGetResponseSchema,
  BillingCheckoutRequestSchema,
  BillingCheckoutResponseSchema,
  BillingPortalRequestSchema,
  BillingPortalResponseSchema,
  UsageLedgerListResponseSchema,
  MaintenanceStatusResponseSchema,
  PublicSitePriceSchema,
  PublicSiteTierSchema,
  PublicSiteConfigResponseSchema,
  DeltaEventSchema,
  ToolCallEventSchema,
  ToolCallEndEventSchema,
  ToolResultEventSchema,
  DoneEventSchema,
  StreamErrorEventSchema,
  EntityRecordListResponsePayloadSchema,
  ConnectorInstanceCreateResponseSchema,
  EntityRecordCountResponsePayloadSchema,
  EntityRecordGetResponsePayloadSchema,
  EntityRecordImportRequestBodySchema,
  EntityRecordImportResponsePayloadSchema,
  ConnectorInstanceGetResponseSchema,
  ConnectorInstanceListResponsePayloadSchema,
  FileUploadSheetSliceResponsePayloadSchema,
  PreviewEndpointPageRequestBodySchema,
  PreviewEndpointPageResponseSchema,
  ProbeEndpointDraftRequestBodySchema,
  SuggestTransformRequestBodySchema,
  SuggestTransformResponseSchema,
} from "@portalai/core/contracts";
import {
  EntityRecordListItemSchema,
  EntityTagAssignmentSchema,
  OrganizationSchema,
} from "@portalai/core/models";
import {
  ApiAuthConfigSchema,
  ApiCredentialsSchema,
  ApiEndpointConfigSchema,
  PaginationConfigSchema,
  RestApiInstanceConfigSchema,
  ToolUsageLedgerEntrySchema,
} from "@portalai/core/models";

import { environment } from "../environment.js";

/**
 * Spreadsheet-parsing schemas re-exported from `@portalai/core/contracts` and
 * emitted as JSON Schema via `z.toJSONSchema` so the parser module stays the
 * single source of truth. Any new schema added here must be mirrored in the
 * round-trip test at `src/__tests__/config/swagger.config.test.ts`.
 *
 * `unrepresentable: "any"` lets Zod emit `{}` for JSON-incompatible leaves
 * (notably `z.date()` inside `WorkbookCell.value`); OpenAPI consumers treat
 * these as free-form, which matches the spec's "serialised as ISO 8601 strings
 * on the wire" guarantee.
 */
const JSON_SCHEMA_OPTS = { unrepresentable: "any" as const };
const spreadsheetParsingSchemas: Record<string, unknown> = {
  LayoutPlan: z.toJSONSchema(LayoutPlanSchema, JSON_SCHEMA_OPTS),
  Region: z.toJSONSchema(RegionSchema, JSON_SCHEMA_OPTS),
  ColumnBinding: z.toJSONSchema(ColumnBindingSchema, JSON_SCHEMA_OPTS),
  SkipRule: z.toJSONSchema(SkipRuleSchema, JSON_SCHEMA_OPTS),
  HeaderStrategy: z.toJSONSchema(HeaderStrategySchema, JSON_SCHEMA_OPTS),
  IdentityStrategy: z.toJSONSchema(IdentityStrategySchema, JSON_SCHEMA_OPTS),
  Warning: z.toJSONSchema(WarningSchema, JSON_SCHEMA_OPTS),
  DriftReport: z.toJSONSchema(DriftReportSchema, JSON_SCHEMA_OPTS),
  InterpretInput: z.toJSONSchema(InterpretInputSchema, JSON_SCHEMA_OPTS),
  RegionHint: z.toJSONSchema(RegionHintSchema, JSON_SCHEMA_OPTS),
  // Endpoint-level aliases — `InterpretRequestBody` is the explicit request
  // body name referenced by the interpret route's JSDoc, `InterpretResponsePayload`
  // is the wrapped plan + trace response.
  InterpretRequestBody: z.toJSONSchema(
    InterpretRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  InterpretResponsePayload: z.toJSONSchema(
    InterpretResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
  LayoutPlanCommitResult: z.toJSONSchema(
    LayoutPlanCommitResultSchema,
    JSON_SCHEMA_OPTS
  ),
  LayoutPlanInterpretDraftResponsePayload: z.toJSONSchema(
    LayoutPlanInterpretDraftResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
  LayoutPlanCommitDraftRequestBody: z.toJSONSchema(
    LayoutPlanCommitDraftRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  LayoutPlanCommitDraftResponsePayload: z.toJSONSchema(
    LayoutPlanCommitDraftResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * REST API connector schemas — phase 1-4. Sourced from
 * `@portalai/core/{models,contracts}` so the route layer's JSDoc can
 * reference one canonical schema per shape.
 */
const restApiConnectorSchemas: Record<string, unknown> = {
  // Referenced by connector-instance.router.ts's probe / preview / transform
  // routes. These were $ref'd before they were registered (#420), so Swagger UI
  // rendered an empty schema where the body and payload should be.
  ProbeEndpointDraftRequestBody: z.toJSONSchema(
    ProbeEndpointDraftRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  PreviewEndpointPageRequestBody: z.toJSONSchema(
    PreviewEndpointPageRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  PreviewEndpointPageResponse: z.toJSONSchema(
    PreviewEndpointPageResponseSchema,
    JSON_SCHEMA_OPTS
  ),
  SuggestTransformRequestBody: z.toJSONSchema(
    SuggestTransformRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  SuggestTransformResponse: z.toJSONSchema(
    SuggestTransformResponseSchema,
    JSON_SCHEMA_OPTS
  ),
  ApiAuthConfig: z.toJSONSchema(ApiAuthConfigSchema, JSON_SCHEMA_OPTS),
  ApiCredentials: z.toJSONSchema(ApiCredentialsSchema, JSON_SCHEMA_OPTS),
  PaginationConfig: z.toJSONSchema(PaginationConfigSchema, JSON_SCHEMA_OPTS),
  RestApiInstanceConfig: z.toJSONSchema(
    RestApiInstanceConfigSchema,
    JSON_SCHEMA_OPTS
  ),
  ApiEndpointConfig: z.toJSONSchema(ApiEndpointConfigSchema, JSON_SCHEMA_OPTS),
  ApiEndpointEntity: z.toJSONSchema(
    ApiEndpointEntityWireSchema,
    JSON_SCHEMA_OPTS
  ),
  ApiEndpoint: z.toJSONSchema(ApiEndpointWireSchema, JSON_SCHEMA_OPTS),
  ApiEndpointListResponse: z.toJSONSchema(
    ApiEndpointListResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
  CreateApiEndpointRequestBody: z.toJSONSchema(
    CreateApiEndpointRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  PatchApiEndpointRequestBody: z.toJSONSchema(
    PatchApiEndpointRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  DeleteApiEndpointResponse: z.toJSONSchema(
    DeleteApiEndpointResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
  ApiColumnSuggestion: z.toJSONSchema(
    ApiColumnSuggestionSchema,
    JSON_SCHEMA_OPTS
  ),
  DiscoveredColumnWithSuggestion: z.toJSONSchema(
    DiscoveredColumnWithSuggestionSchema,
    JSON_SCHEMA_OPTS
  ),
  DiscoverColumnsResult: z.toJSONSchema(
    DiscoverColumnsResultSchema,
    JSON_SCHEMA_OPTS
  ),
  DiscoverColumnsRequestBody: z.toJSONSchema(
    DiscoverColumnsRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  TestConnectionRequestBody: z.toJSONSchema(
    TestConnectionRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  TestConnectionResult: z.toJSONSchema(
    TestConnectionResultSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Connector-instance response shapes. The `$ref`s in
 * `connector-instance.router.ts` predated any registration (#420); the list
 * component drops the contract's `Payload` suffix because that is the name the
 * route JSDoc already uses.
 */
const connectorInstanceSchemas: Record<string, unknown> = {
  ConnectorInstanceCreateResponse: z.toJSONSchema(
    ConnectorInstanceCreateResponseSchema,
    JSON_SCHEMA_OPTS
  ),
  ConnectorInstanceGetResponse: z.toJSONSchema(
    ConnectorInstanceGetResponseSchema,
    JSON_SCHEMA_OPTS
  ),
  ConnectorInstanceListResponse: z.toJSONSchema(
    ConnectorInstanceListResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Domain models a route returns directly, rather than wrapped in a
 * feature-specific payload. Both were `$ref`'d without being registered (#420).
 */
const domainModelSchemas: Record<string, unknown> = {
  EntityTagAssignment: z.toJSONSchema(
    EntityTagAssignmentSchema,
    JSON_SCHEMA_OPTS
  ),
  Organization: z.toJSONSchema(OrganizationSchema, JSON_SCHEMA_OPTS),
};

/**
 * The sheet-slice rectangle (#420). All three sheet-slice routes — file-upload,
 * google-sheets and microsoft-excel — return the identical shape, and the
 * google-sheets/microsoft-excel contracts already alias
 * `FileUploadSheetSliceResponsePayloadSchema` rather than redeclaring it. One
 * component keeps the three route blocks from drifting; the name is
 * provider-neutral because all three reference it.
 */
const sheetSliceSchemas: Record<string, unknown> = {
  SheetSliceResponse: z.toJSONSchema(
    FileUploadSheetSliceResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Entity-record payloads referenced by the count / get / import routes, which
 * carried no `@openapi` block at all until #420. Registered rather than spelled
 * inline because more than one route names them.
 */
const entityRecordSchemas: Record<string, unknown> = {
  EntityRecordCountResponsePayload: z.toJSONSchema(
    EntityRecordCountResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
  EntityRecordGetResponsePayload: z.toJSONSchema(
    EntityRecordGetResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
  EntityRecordImportRequestBody: z.toJSONSchema(
    EntityRecordImportRequestBodySchema,
    JSON_SCHEMA_OPTS
  ),
  EntityRecordImportResponsePayload: z.toJSONSchema(
    EntityRecordImportResponsePayloadSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Subscription tier / usage schemas (#172). Sourced from
 * `@portalai/core/contracts` so the route JSDoc references one canonical shape.
 */
const tierSchemas: Record<string, unknown> = {
  OrganizationUsageGetResponse: z.toJSONSchema(
    OrganizationUsageGetResponseSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Org switcher schemas (#201). Sourced from `@portalai/core/contracts` so the
 * memberships/switch route JSDoc references one canonical shape.
 */
const orgSwitcherSchemas: Record<string, unknown> = {
  OrganizationGetResponse: z.toJSONSchema(
    OrganizationGetResponseSchema,
    JSON_SCHEMA_OPTS
  ),
  UserMembershipsGetResponse: z.toJSONSchema(
    UserMembershipsGetResponseSchema,
    JSON_SCHEMA_OPTS
  ),
  OrganizationSwitchRequest: z.toJSONSchema(
    OrganizationSwitchRequestSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Organization deletion schemas (#197). Sourced from
 * `@portalai/core/contracts` so the DELETE route JSDoc references the
 * canonical request/response shapes.
 */
const orgDeleteSchemas: Record<string, unknown> = {
  OrganizationDeleteRequest: z.toJSONSchema(
    OrganizationDeleteRequestSchema,
    JSON_SCHEMA_OPTS
  ),
  OrganizationDeleteResponse: z.toJSONSchema(
    OrganizationDeleteResponseSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Billing schemas (#176). Sourced from `@portalai/core/contracts` so the
 * billing routes' JSDoc references the canonical shapes.
 */
const billingSchemas: Record<string, unknown> = {
  BillingTiersGetResponse: z.toJSONSchema(
    BillingTiersGetResponseSchema,
    JSON_SCHEMA_OPTS
  ),
  BillingCheckoutRequest: z.toJSONSchema(
    BillingCheckoutRequestSchema,
    JSON_SCHEMA_OPTS
  ),
  BillingCheckoutResponse: z.toJSONSchema(
    BillingCheckoutResponseSchema,
    JSON_SCHEMA_OPTS
  ),
  BillingPortalRequest: z.toJSONSchema(
    BillingPortalRequestSchema,
    JSON_SCHEMA_OPTS
  ),
  BillingPortalResponse: z.toJSONSchema(
    BillingPortalResponseSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Tool usage ledger schemas (#179). Sourced from `@portalai/core` so the
 * itemized-usage route JSDoc references the canonical shapes.
 */
const usageLedgerSchemas: Record<string, unknown> = {
  ToolUsageLedgerEntry: z.toJSONSchema(
    ToolUsageLedgerEntrySchema,
    JSON_SCHEMA_OPTS
  ),
  UsageLedgerListResponse: z.toJSONSchema(
    UsageLedgerListResponseSchema,
    JSON_SCHEMA_OPTS
  ),
  MaintenanceStatusResponse: z.toJSONSchema(
    MaintenanceStatusResponseSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Public marketing-site config schemas (#311). Sourced from
 * `@portalai/core/contracts` — the same strict schemas the endpoint
 * validates against on the way out and `apps/site` parses at build time, so
 * the published spec cannot drift from the wire.
 */
const publicSiteSchemas: Record<string, unknown> = {
  PublicSitePrice: z.toJSONSchema(PublicSitePriceSchema, JSON_SCHEMA_OPTS),
  PublicSiteTier: z.toJSONSchema(PublicSiteTierSchema, JSON_SCHEMA_OPTS),
  PublicSiteConfigResponse: z.toJSONSchema(
    PublicSiteConfigResponseSchema,
    JSON_SCHEMA_OPTS
  ),
};

/**
 * Portal stream SSE event payloads (#279). Sourced from
 * `@portalai/core/contracts` so the one canonical union — the same
 * `PortalSSEEventSchema` the server emits and the client parses — is what
 * `/api-docs` publishes.
 *
 * These went unregistered until #279, and the route's `@openapi` block
 * described them in hand-written prose that had drifted from the wire. The
 * union below is referenced by the stream route's 200 response.
 */
const portalStreamEventSchemas: Record<string, unknown> = {
  PortalDeltaEvent: z.toJSONSchema(DeltaEventSchema, JSON_SCHEMA_OPTS),
  PortalToolCallEvent: z.toJSONSchema(ToolCallEventSchema, JSON_SCHEMA_OPTS),
  PortalToolCallEndEvent: z.toJSONSchema(
    ToolCallEndEventSchema,
    JSON_SCHEMA_OPTS
  ),
  PortalToolResultEvent: z.toJSONSchema(
    ToolResultEventSchema,
    JSON_SCHEMA_OPTS
  ),
  PortalDoneEvent: z.toJSONSchema(DoneEventSchema, JSON_SCHEMA_OPTS),
  PortalStreamErrorEvent: z.toJSONSchema(
    StreamErrorEventSchema,
    JSON_SCHEMA_OPTS
  ),
  PortalStreamEvent: {
    oneOf: [
      { $ref: "#/components/schemas/PortalDeltaEvent" },
      { $ref: "#/components/schemas/PortalToolCallEvent" },
      { $ref: "#/components/schemas/PortalToolCallEndEvent" },
      { $ref: "#/components/schemas/PortalToolResultEvent" },
      { $ref: "#/components/schemas/PortalDoneEvent" },
      { $ref: "#/components/schemas/PortalStreamErrorEvent" },
    ],
  },
};

const options: swaggerJsdoc.Options = {
  definition: {
    // 3.1, not 3.0, because the 59 components generated by `z.toJSONSchema`
    // emit JSON Schema draft 2020-12 (`const`, `$schema`, `type: "null"`),
    // which 3.0 does not permit — the document measured 1928 conformance
    // errors as 3.0 and validates clean as 3.1 (#446). Nullability is written
    // `type: [X, "null"]`: 3.1 dropped `nullable`, and because 2020-12 ignores
    // unrecognized keywords it would fail silently rather than loudly. A guard
    // in swagger.config.test.ts asserts none comes back.
    openapi: "3.1.0",
    info: {
      title: "Portals AI API Documentation",
      version: "1.0.0",
      description:
        "API documentation for the Portals AI application. This API provides endpoints for health checks and protected resources with Auth0 JWT authentication.",
      contact: {
        name: "API Support",
      },
    },
    servers: [
      {
        url: "http://localhost:3001",
        description: "Development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Enter your Auth0 JWT token",
        },
        oauth2: {
          type: "oauth2",
          flows: {
            implicit: {
              authorizationUrl: `https://${environment.AUTH0_DOMAIN}/authorize?audience=${environment.AUTH0_AUDIENCE}`,
              scopes: {
                openid: "OpenID Connect",
                profile: "User profile",
                email: "User email",
              },
            },
          },
          description: "OAuth2 authentication with Auth0",
        },
      },
      parameters: {
        limitParam: {
          in: "query",
          name: "limit",
          schema: {
            type: "integer",
            minimum: 1,
            maximum: 100,
            default: 20,
          },
          description: "Number of items per page",
        },
        offsetParam: {
          in: "query",
          name: "offset",
          schema: {
            type: "integer",
            minimum: 0,
            default: 0,
          },
          description: "Number of items to skip",
        },
        cursorParam: {
          in: "query",
          name: "cursor",
          schema: { type: "string" },
          description:
            "Opaque keyset cursor from a previous response's `nextCursor` (#433). " +
            "Takes precedence over `offset` when present. A cursor minted under a " +
            "different `sortBy`/`sortOrder`, or one that fails to decode, is ignored " +
            "and the first page is served — it is a stale address, not an error.",
        },
        sortByParam: {
          in: "query",
          name: "sortBy",
          schema: {
            type: "string",
            default: "created",
          },
          description: "Field to sort by",
        },
        sortOrderParam: {
          in: "query",
          name: "sortOrder",
          schema: {
            type: "string",
            enum: ["asc", "desc"],
            default: "asc",
          },
          description: "Sort direction",
        },
      },
      schemas: {
        ApiErrorResponse: {
          type: "object",
          required: ["status", "message", "code"],
          properties: {
            status: {
              type: "string",
              enum: ["ERROR"],
              description: "Response status",
            },
            message: {
              type: "string",
              description: "Error message",
            },
            code: {
              type: "string",
              description: "Error code",
            },
          },
        },
        HealthResponse: {
          type: "object",
          required: ["status", "timestamp"],
          properties: {
            status: {
              type: "string",
              enum: ["OK"],
              description: "Response status",
            },
            timestamp: {
              type: "string",
              format: "date-time",
              example: "2024-01-01T00:00:00.000Z",
              description: "Current server timestamp",
            },
          },
        },
        UserProfile: {
          type: "object",
          required: ["sub"],
          properties: {
            sub: {
              type: "string",
              description: "User ID (subject)",
              example: "auth0|507f1f77bcf86cd799439011",
            },
            name: {
              type: "string",
              description: "Full name",
              example: "John Doe",
            },
            given_name: {
              type: "string",
              description: "Given name (first name)",
              example: "John",
            },
            family_name: {
              type: "string",
              description: "Family name (last name)",
              example: "Doe",
            },
            middle_name: {
              type: "string",
              description: "Middle name",
            },
            nickname: {
              type: "string",
              description: "Nickname",
              example: "johnny",
            },
            preferred_username: {
              type: "string",
              description: "Preferred username",
            },
            profile: {
              type: "string",
              description: "Profile page URL",
            },
            picture: {
              type: "string",
              description: "Profile picture URL",
              example: "https://example.com/avatar.jpg",
            },
            website: {
              type: "string",
              description: "Website URL",
            },
            email: {
              type: "string",
              format: "email",
              description: "Email address",
              example: "john.doe@example.com",
            },
            email_verified: {
              type: "boolean",
              description: "Whether email is verified",
              example: true,
            },
            gender: {
              type: "string",
              description: "Gender",
            },
            birthdate: {
              type: "string",
              description: "Birthdate",
              example: "1990-01-01",
            },
            zoneinfo: {
              type: "string",
              description: "Time zone",
              example: "America/New_York",
            },
            locale: {
              type: "string",
              description: "Locale",
              example: "en-US",
            },
            phone_number: {
              type: "string",
              description: "Phone number",
              example: "+1 234 567 8900",
            },
            phone_number_verified: {
              type: "boolean",
              description: "Whether phone number is verified",
            },
            address: {
              type: "object",
              description: "Address information",
              properties: {
                formatted: {
                  type: "string",
                  description: "Full formatted address",
                },
                street_address: {
                  type: "string",
                  description: "Street address",
                },
                locality: {
                  type: "string",
                  description: "City/locality",
                },
                region: {
                  type: "string",
                  description: "State/region",
                },
                postal_code: {
                  type: "string",
                  description: "Postal code",
                },
                country: {
                  type: "string",
                  description: "Country",
                },
              },
            },
            updated_at: {
              type: "string",
              description: "Last updated timestamp",
              example: "2024-01-01T00:00:00.000Z",
            },
          },
        },
        ConnectorDefinition: {
          type: "object",
          required: [
            "id",
            "slug",
            "display",
            "category",
            "authType",
            "capabilityFlags",
            "isActive",
            "version",
            "created",
            "createdBy",
          ],
          properties: {
            id: {
              type: "string",
              description: "Unique identifier",
              example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            },
            slug: {
              type: "string",
              description: "URL-friendly unique slug",
              example: "postgresql-connector",
            },
            display: {
              type: "string",
              description: "Human-readable display name",
              example: "PostgreSQL Connector",
            },
            category: {
              type: "string",
              description: "Connector category",
              example: "database",
            },
            authType: {
              type: "string",
              description: "Authentication type required by the connector",
              example: "oauth2",
            },
            configSchema: {
              type: ["object", "null"],
              description: "JSON schema for connector configuration",
              additionalProperties: true,
            },
            capabilityFlags: {
              type: "object",
              description: "Supported capabilities",
              properties: {
                sync: { type: "boolean" },
                read: { type: "boolean" },
                write: { type: "boolean" },
                push: { type: "boolean" },
              },
            },
            isActive: {
              type: "boolean",
              description: "Whether the connector definition is active",
              example: true,
            },
            version: {
              type: "string",
              description: "Semantic version of the connector definition",
              example: "1.0.0",
            },
            iconUrl: {
              type: ["string", "null"],
              description: "URL to the connector icon",
              example: "https://example.com/icons/postgres.svg",
            },
            created: {
              type: "number",
              description: "Creation timestamp (epoch ms)",
              example: 1700000000000,
            },
            createdBy: {
              type: "string",
              description: "ID of the creator",
              example: "SYSTEM",
            },
            updated: {
              type: ["number", "null"],
              description: "Last update timestamp (epoch ms)",
            },
            updatedBy: {
              type: ["string", "null"],
              description: "ID of the last updater",
            },
            deleted: {
              type: ["number", "null"],
              description: "Soft-delete timestamp (epoch ms)",
            },
            deletedBy: {
              type: ["string", "null"],
              description: "ID of the deleter",
            },
          },
        },
        PaginatedResponse: {
          type: "object",
          required: ["total", "limit", "offset"],
          properties: {
            total: {
              type: "integer",
              description: "Total number of matching records",
              example: 42,
            },
            limit: {
              type: "integer",
              description: "Page size used for this request",
              example: 20,
            },
            offset: {
              type: "integer",
              description: "Offset used for this request",
              example: 0,
            },
            nextCursor: {
              type: ["string", "null"],
              description:
                "Keyset cursor for the following page (#433), or null at the end " +
                "of the result set. Optional — only lists that have adopted cursor " +
                "pagination emit it.",
            },
          },
        },
        ConnectorDefinitionListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["connectorDefinitions"],
              properties: {
                connectorDefinitions: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/ConnectorDefinition",
                  },
                },
              },
            },
          ],
        },
        ConnectorDefinitionGetResponse: {
          type: "object",
          required: ["connectorDefinition"],
          properties: {
            connectorDefinition: {
              $ref: "#/components/schemas/ConnectorDefinition",
            },
          },
        },
        Job: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "type",
            "status",
            "progress",
            "metadata",
            "attempts",
            "maxAttempts",
            "created",
            "createdBy",
          ],
          properties: {
            id: {
              type: "string",
              description: "Unique identifier",
              example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            },
            organizationId: {
              type: "string",
              description: "Organization that owns this job",
            },
            type: {
              type: "string",
              enum: ["system_check", "revalidation"],
              description: "Job type",
            },
            status: {
              type: "string",
              enum: [
                "pending",
                "active",
                "completed",
                "failed",
                "stalled",
                "cancelled",
              ],
              description: "Current job status",
            },
            progress: {
              type: "integer",
              description: "Progress percentage (0-100)",
              example: 0,
            },
            metadata: {
              type: "object",
              additionalProperties: true,
              description: "Arbitrary metadata attached to the job",
            },
            result: {
              type: ["object", "null"],
              additionalProperties: true,
              description: "Job result payload (set on completion)",
            },
            error: {
              type: ["string", "null"],
              description: "Error message (set on failure)",
            },
            startedAt: {
              type: ["number", "null"],
              description: "Start timestamp (epoch ms)",
            },
            completedAt: {
              type: ["number", "null"],
              description: "Completion timestamp (epoch ms)",
            },
            bullJobId: {
              type: ["string", "null"],
              description: "BullMQ job ID",
            },
            attempts: {
              type: "integer",
              description: "Number of attempts made",
              example: 0,
            },
            maxAttempts: {
              type: "integer",
              description: "Maximum number of retry attempts",
              example: 3,
            },
            created: {
              type: "number",
              description: "Creation timestamp (epoch ms)",
              example: 1700000000000,
            },
            createdBy: {
              type: "string",
              description: "ID of the creator",
            },
            updated: {
              type: ["number", "null"],
              description: "Last update timestamp (epoch ms)",
            },
            updatedBy: {
              type: ["string", "null"],
              description: "ID of the last updater",
            },
            deleted: {
              type: ["number", "null"],
              description: "Soft-delete timestamp (epoch ms)",
            },
            deletedBy: {
              type: ["string", "null"],
              description: "ID of the deleter",
            },
          },
        },
        JobListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["jobs"],
              properties: {
                jobs: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/Job",
                  },
                },
              },
            },
          ],
        },
        JobGetResponse: {
          type: "object",
          required: ["job"],
          properties: {
            job: {
              $ref: "#/components/schemas/Job",
            },
          },
        },
        ColumnDefinition: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "key",
            "label",
            "type",
            "created",
            "createdBy",
          ],
          properties: {
            id: { type: "string" },
            organizationId: { type: "string" },
            key: {
              type: "string",
              pattern: "^[a-z][a-z0-9_]*$",
              example: "email",
            },
            label: { type: "string", example: "Email Address" },
            type: {
              type: "string",
              enum: [
                "string",
                "number",
                "boolean",
                "date",
                "datetime",
                "enum",
                "json",
                "array",
                "reference",
                "reference-array",
              ],
              description:
                "Column data type. Note: 'currency' is not a valid type — use 'number' with canonicalFormat instead.",
            },
            description: { type: ["string", "null"] },
            validationPattern: {
              type: ["string", "null"],
              description: "Regex validation pattern for values",
            },
            validationMessage: {
              type: ["string", "null"],
              description:
                "Human-readable message when validationPattern fails",
            },
            canonicalFormat: {
              type: ["string", "null"],
              description:
                "Display/storage format (e.g. 'lowercase', 'USD', 'YYYY-MM-DD')",
            },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        ColumnDefinitionListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["columnDefinitions"],
              properties: {
                columnDefinitions: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/ColumnDefinition",
                  },
                },
              },
            },
          ],
        },
        ColumnDefinitionGetResponse: {
          type: "object",
          required: ["columnDefinition"],
          properties: {
            columnDefinition: {
              $ref: "#/components/schemas/ColumnDefinition",
            },
          },
        },
        ConnectorEntity: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "connectorInstanceId",
            "key",
            "label",
            "created",
            "createdBy",
          ],
          properties: {
            id: { type: "string" },
            organizationId: { type: "string" },
            connectorInstanceId: { type: "string" },
            key: { type: "string", example: "contacts" },
            label: { type: "string", example: "Contacts" },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        ConnectorEntityListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["connectorEntities"],
              properties: {
                connectorEntities: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/ConnectorEntity",
                  },
                },
              },
            },
          ],
        },
        ConnectorEntityGetResponse: {
          type: "object",
          required: ["connectorEntity"],
          properties: {
            connectorEntity: {
              $ref: "#/components/schemas/ConnectorEntity",
            },
          },
        },
        FieldMapping: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "connectorEntityId",
            "columnDefinitionId",
            "sourceField",
            "isPrimaryKey",
            "normalizedKey",
            "required",
            "created",
            "createdBy",
          ],
          properties: {
            id: { type: "string" },
            organizationId: { type: "string" },
            connectorEntityId: { type: "string" },
            columnDefinitionId: { type: "string" },
            sourceField: { type: "string", example: "account_name" },
            isPrimaryKey: { type: "boolean" },
            normalizedKey: {
              type: "string",
              pattern: "^[a-z][a-z0-9_]*$",
              description: "Key used in normalizedData JSONB",
              example: "account_name",
            },
            required: {
              type: "boolean",
              description: "Whether this field is required for this source",
            },
            defaultValue: {
              type: ["string", "null"],
              description: "Default fill value when source value is missing",
            },
            format: {
              type: ["string", "null"],
              description:
                "Per-source parse format (e.g. 'YYYY-MM-DD', 'email')",
            },
            enumValues: {
              type: ["array", "null"],
              items: { type: "string" },
              description: "Allowed values for this field",
            },
            refNormalizedKey: { type: ["string", "null"] },
            refEntityKey: { type: ["string", "null"] },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        FieldMappingListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["fieldMappings"],
              properties: {
                fieldMappings: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/FieldMapping",
                  },
                },
              },
            },
          ],
        },
        FieldMappingGetResponse: {
          type: "object",
          required: ["fieldMapping"],
          properties: {
            fieldMapping: {
              $ref: "#/components/schemas/FieldMapping",
            },
          },
        },
        EntityTag: {
          type: "object",
          required: ["id", "organizationId", "name", "created", "createdBy"],
          properties: {
            id: { type: "string" },
            organizationId: { type: "string" },
            name: { type: "string", example: "VIP" },
            color: { type: ["string", "null"], example: "#ff0000" },
            description: { type: ["string", "null"] },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        EntityGroup: {
          type: "object",
          required: ["id", "organizationId", "name", "created", "createdBy"],
          properties: {
            id: { type: "string" },
            organizationId: { type: "string" },
            name: { type: "string", example: "People" },
            description: { type: ["string", "null"] },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        EntityGroupMember: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "entityGroupId",
            "connectorEntityId",
            "linkFieldMappingId",
            "isPrimary",
            "created",
            "createdBy",
          ],
          properties: {
            id: { type: "string" },
            organizationId: { type: "string" },
            entityGroupId: { type: "string" },
            connectorEntityId: { type: "string" },
            linkFieldMappingId: { type: "string" },
            isPrimary: { type: "boolean", example: false },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        EntityGroupMemberWithDetails: {
          allOf: [
            { $ref: "#/components/schemas/EntityGroupMember" },
            {
              type: "object",
              required: ["connectorEntityLabel", "linkFieldMappingSourceField"],
              properties: {
                connectorEntityLabel: {
                  type: "string",
                  example: "Employees",
                },
                linkFieldMappingSourceField: {
                  type: "string",
                  example: "email",
                },
              },
            },
          ],
        },
        EntityGroupWithMembers: {
          allOf: [
            { $ref: "#/components/schemas/EntityGroup" },
            {
              type: "object",
              required: ["members"],
              properties: {
                members: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/EntityGroupMemberWithDetails",
                  },
                },
              },
            },
          ],
        },
        EntityRecord: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "connectorEntityId",
            "data",
            "normalizedData",
            "sourceId",
            "checksum",
            "syncedAt",
            "isValid",
            "created",
            "createdBy",
          ],
          properties: {
            id: { type: "string" },
            organizationId: { type: "string" },
            connectorEntityId: { type: "string" },
            data: { type: "object", additionalProperties: true },
            normalizedData: {
              type: "object",
              additionalProperties: true,
              description:
                "Normalized data keyed by fieldMapping.normalizedKey",
            },
            sourceId: { type: "string" },
            checksum: { type: "string" },
            syncedAt: { type: "number", description: "Epoch ms" },
            validationErrors: {
              type: ["array", "null"],
              items: {
                type: "object",
                properties: {
                  field: { type: "string" },
                  error: { type: "string" },
                },
              },
              description: "Per-field validation failures, null when valid",
            },
            isValid: {
              type: "boolean",
              description:
                "Quick filter flag — true when validationErrors is null or empty",
            },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        /**
         * #433. Generated from the contract rather than hand-written: the
         * list item is `EntityRecord` *minus* `data`, and JSON Schema has no
         * subtraction — an `allOf` against EntityRecord would still require
         * the field it exists to drop.
         */
        EntityRecordListItem: z.toJSONSchema(
          EntityRecordListItemSchema,
          JSON_SCHEMA_OPTS
        ),
        EntityRecordListResponse: z.toJSONSchema(
          EntityRecordListResponsePayloadSchema,
          JSON_SCHEMA_OPTS
        ),
        EntityGroupResolveResult: {
          type: "object",
          required: [
            "connectorEntityId",
            "connectorEntityLabel",
            "isPrimary",
            "records",
          ],
          properties: {
            connectorEntityId: { type: "string" },
            connectorEntityLabel: { type: "string" },
            isPrimary: { type: "boolean" },
            records: {
              type: "array",
              items: { $ref: "#/components/schemas/EntityRecord" },
            },
          },
        },
        EntityGroupOverlapResponse: {
          type: "object",
          required: [
            "overlapPercentage",
            "sourceRecordCount",
            "targetRecordCount",
            "matchingRecordCount",
          ],
          properties: {
            overlapPercentage: {
              type: "number",
              minimum: 0,
              maximum: 100,
              example: 72.5,
            },
            sourceRecordCount: { type: "integer", example: 200 },
            targetRecordCount: { type: "integer", example: 300 },
            matchingRecordCount: { type: "integer", example: 145 },
          },
        },
        // Referenced by the POST /api/stations and PATCH /api/stations/{id}
        // responses. Both return `enabledToolpacks` — the joined pack refs,
        // built-in slugs plus `org:<uuid>` for custom packs — matching
        // `StationWithToolpacksSchema` in `@portalai/core/contracts`, where the
        // field is optional. This schema previously declared a REQUIRED
        // `toolPacks`, which is the *request* body's field name and appears in
        // no response; anyone generating a client from it got a field the API
        // never sends.
        Station: {
          type: "object",
          required: ["id", "organizationId", "name", "created", "createdBy"],
          properties: {
            id: {
              type: "string",
              example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            },
            organizationId: { type: "string" },
            name: { type: "string", example: "Sales Analytics" },
            description: { type: ["string", "null"] },
            enabledToolpacks: {
              type: "array",
              items: { type: "string" },
              description:
                "Enabled pack refs: built-in slugs, plus `org:<uuid>` for " +
                "each org-registered custom toolpack.",
              example: [
                "data_query",
                "org:11111111-1111-4111-8111-111111111111",
              ],
            },
            created: {
              type: "number",
              description: "Epoch ms",
              example: 1700000000000,
            },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        StationInstance: {
          type: "object",
          required: [
            "id",
            "stationId",
            "connectorInstanceId",
            "created",
            "createdBy",
          ],
          properties: {
            id: { type: "string" },
            stationId: { type: "string" },
            connectorInstanceId: { type: "string" },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        StationWithInstances: {
          allOf: [
            { $ref: "#/components/schemas/Station" },
            {
              type: "object",
              required: ["instances"],
              properties: {
                instances: {
                  type: "array",
                  items: { $ref: "#/components/schemas/StationInstance" },
                },
              },
            },
          ],
        },
        StationListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["stations"],
              properties: {
                stations: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Station" },
                },
              },
            },
          ],
        },
        Portal: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "stationId",
            "name",
            "created",
            "createdBy",
          ],
          properties: {
            id: {
              type: "string",
              example: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
            },
            organizationId: { type: "string" },
            stationId: { type: "string" },
            name: { type: "string", example: "Test Portal" },
            created: {
              type: "number",
              description: "Epoch ms",
              example: 1700000000000,
            },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        PortalMessage: {
          type: "object",
          required: [
            "id",
            "portalId",
            "role",
            "blocks",
            "created",
            "createdBy",
          ],
          properties: {
            id: { type: "string" },
            portalId: { type: "string" },
            role: { type: "string", enum: ["user", "assistant"] },
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", example: "text" },
                  content: {},
                },
              },
            },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        PortalWithMessages: {
          type: "object",
          required: ["portal", "messages"],
          properties: {
            portal: { $ref: "#/components/schemas/Portal" },
            messages: {
              type: "array",
              items: { $ref: "#/components/schemas/PortalMessage" },
            },
          },
        },
        PortalListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["portals"],
              properties: {
                portals: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Portal" },
                },
              },
            },
          ],
        },
        PortalResult: {
          type: "object",
          required: [
            "id",
            "organizationId",
            "stationId",
            "portalId",
            "name",
            "type",
            "content",
            "created",
            "createdBy",
          ],
          properties: {
            id: { type: "string" },
            organizationId: { type: "string" },
            stationId: { type: "string" },
            portalId: { type: "string" },
            name: { type: "string", example: "Q1 Revenue Table" },
            type: {
              type: "string",
              enum: ["text", "data-table", "d3", "geo"],
              example: "data-table",
            },
            content: { type: "object", additionalProperties: true },
            snapshotUpdatedAt: {
              type: ["number", "null"],
              description:
                "Epoch ms of the last successful snapshot write (#312) — pin time, then each persist-back refresh. Null on pre-#312 rows.",
            },
            created: { type: "number", description: "Epoch ms" },
            createdBy: { type: "string" },
            updated: { type: ["number", "null"] },
            updatedBy: { type: ["string", "null"] },
            deleted: { type: ["number", "null"] },
            deletedBy: { type: ["string", "null"] },
          },
        },
        PortalResultListResponse: {
          allOf: [
            { $ref: "#/components/schemas/PaginatedResponse" },
            {
              type: "object",
              required: ["portalResults"],
              properties: {
                portalResults: {
                  type: "array",
                  items: { $ref: "#/components/schemas/PortalResult" },
                },
              },
            },
          ],
        },
        // ── Large data operations (#85) — bulk writes + reads ────────
        RunningJob: {
          type: "object",
          required: ["id", "type", "status", "created"],
          properties: {
            id: { type: "string" },
            type: { type: "string" },
            status: { type: "string" },
            startedAt: { type: ["integer", "null"] },
            created: { type: "integer", description: "Epoch ms" },
          },
        },
        PortalRunningJobsResponse: {
          type: "object",
          required: ["jobs"],
          properties: {
            jobs: {
              type: "array",
              items: { $ref: "#/components/schemas/RunningJob" },
            },
          },
        },
        BulkJobTerminalEvent: {
          type: "object",
          required: [
            "type",
            "jobId",
            "portalId",
            "status",
            "recordsProcessed",
            "recordsFailed",
            "timestamp",
          ],
          properties: {
            type: { type: "string", enum: ["bulk_job_terminal"] },
            jobId: { type: "string" },
            portalId: { type: "string" },
            status: {
              type: "string",
              enum: ["completed", "failed", "cancelled"],
            },
            recordsProcessed: { type: "integer" },
            recordsFailed: { type: "integer" },
            timestamp: { type: "integer", description: "Epoch ms" },
          },
        },
        QueryHandleSnapshotResponse: {
          type: "object",
          required: ["rows", "total", "offset", "limit"],
          properties: {
            rows: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
            total: { type: "integer" },
            offset: { type: "integer" },
            limit: { type: "integer" },
          },
        },
        QueryHandleStreamEvent: {
          oneOf: [
            {
              type: "object",
              required: ["type", "batchIndex", "rows"],
              properties: {
                type: { type: "string", enum: ["data"] },
                batchIndex: { type: "integer" },
                rows: {
                  type: "array",
                  items: { type: "object", additionalProperties: true },
                },
              },
            },
            {
              type: "object",
              required: ["type"],
              properties: {
                type: { type: "string", enum: ["complete"] },
              },
            },
          ],
        },
        WidgetRefreshRequest: {
          type: "object",
          required: ["messageId", "blockIndex"],
          properties: {
            messageId: { type: "string" },
            blockIndex: { type: "integer", minimum: 0 },
          },
          description:
            "Reference to the persisted d3 widget to refresh. No SQL — the server re-executes the block's own pipeline.",
        },
        WidgetRefreshResponse: {
          oneOf: [
            {
              type: "object",
              required: ["kind", "rows"],
              properties: {
                kind: { type: "string", enum: ["inline"] },
                rows: {
                  type: "array",
                  items: { type: "object", additionalProperties: true },
                },
              },
            },
            {
              type: "object",
              required: ["kind", "queryHandle", "rowCount", "schema"],
              properties: {
                kind: { type: "string", enum: ["handle"] },
                queryHandle: { type: "string" },
                rowCount: { type: "integer" },
                schema: {
                  type: "array",
                  items: { type: "object", additionalProperties: true },
                },
                sampled: { type: "boolean" },
                truncated: { type: "boolean" },
                samplePeek: {
                  type: "array",
                  items: { type: "object", additionalProperties: true },
                },
                sql: { type: ["string", "null"] },
              },
            },
          ],
        },
        RowsByIdRequestBody: {
          type: "object",
          required: ["ids"],
          properties: {
            ids: {
              type: "array",
              items: { type: "string" },
              maxItems: 1000,
            },
          },
        },
        RowsByIdResponse: {
          type: "object",
          required: ["rows"],
          properties: {
            rows: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
          },
        },
        ...spreadsheetParsingSchemas,
        ...restApiConnectorSchemas,
        ...connectorInstanceSchemas,
        ...domainModelSchemas,
        ...sheetSliceSchemas,
        ...entityRecordSchemas,
        ...tierSchemas,
        ...orgSwitcherSchemas,
        ...orgDeleteSchemas,
        ...billingSchemas,
        ...usageLedgerSchemas,
        ...publicSiteSchemas,
        ...portalStreamEventSchemas,
      },
    },
    tags: [
      {
        name: "Health",
        description: "Health check endpoints",
      },
      {
        name: "Profile",
        description: "User profile and authentication endpoints",
      },
      {
        name: "Connector Definitions",
        description: "Connector definition management endpoints",
      },
      {
        name: "Connector Instances",
        description: "Connector instance management endpoints",
      },
      {
        name: "REST API Endpoints",
        description:
          "Per-entity endpoint configuration for the REST API connector — CRUD + the probe entry point that auto-infers columns from a sample request",
      },
      {
        name: "Jobs",
        description: "Background job management endpoints",
      },
      {
        name: "Column Definitions",
        description:
          "Organization-level column definition management endpoints",
      },
      {
        name: "Connector Entities",
        description: "Connector entity management endpoints",
      },
      {
        name: "Field Mappings",
        description: "Field mapping management endpoints",
      },
      {
        name: "Entity Tags",
        description: "Entity tag management endpoints",
      },
      {
        name: "Entity Tag Assignments",
        description: "Entity tag assignment management endpoints",
      },
      {
        name: "Entity Groups",
        description:
          "Entity group management and identity resolution endpoints",
      },
      {
        name: "Entity Group Members",
        description:
          "Entity group member management and overlap preview endpoints",
      },
      {
        name: "Organization",
        description: "Organization management endpoints",
      },
      {
        name: "Stations",
        description: "Station management endpoints",
      },
      {
        name: "Portals",
        description: "Portal management and messaging endpoints",
      },
      {
        name: "Portal Events",
        description:
          "Server-sent events (SSE) for portal AI response streaming",
      },
      {
        name: "Portal Results",
        description: "Pinned portal result management endpoints",
      },
      {
        name: "Toolpacks",
        description: "Built-in and custom toolpack discovery endpoints",
      },
      {
        name: "Portal SQL",
        description:
          "Query handle endpoints for the reads track (#85 Phase 3) — snapshot + SSE stream of staged batches",
      },
      {
        name: "Public Site",
        description:
          "Anonymous, rate-limited endpoints consumed by the public marketing site's build (#311) — no authentication, no tenant data",
      },
    ],
  },
  apis: ["./src/routes/*.ts", "./src/routes/*.js"], // Path to the API routes
};

export const swaggerSpec = swaggerJsdoc(options);
