import { describe, it, expect } from "@jest/globals";
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
} from "@portalai/core/contracts";
import {
  ApiAuthConfigSchema,
  ApiCredentialsSchema,
  ApiEndpointConfigSchema,
  PaginationConfigSchema,
  RestApiInstanceConfigSchema,
} from "@portalai/core/models";

import { swaggerSpec } from "../../config/swagger.config.js";

const REQUIRED_SCHEMA_NAMES = [
  "LayoutPlan",
  "Region",
  "ColumnBinding",
  "SkipRule",
  "HeaderStrategy",
  "IdentityStrategy",
  "Warning",
  "DriftReport",
  "InterpretInput",
  "RegionHint",
  "InterpretRequestBody",
  "InterpretResponsePayload",
  "LayoutPlanCommitResult",
  "LayoutPlanInterpretDraftResponsePayload",
  "LayoutPlanCommitDraftRequestBody",
  "LayoutPlanCommitDraftResponsePayload",
  // REST API connector schemas — phase 1-4
  "ApiAuthConfig",
  "ApiCredentials",
  "PaginationConfig",
  "RestApiInstanceConfig",
  "ApiEndpointConfig",
  "ApiEndpointEntity",
  "ApiEndpoint",
  "ApiEndpointListResponse",
  "CreateApiEndpointRequestBody",
  "PatchApiEndpointRequestBody",
  "DeleteApiEndpointResponse",
  "ApiColumnSuggestion",
  "DiscoveredColumnWithSuggestion",
  "DiscoverColumnsResult",
  "DiscoverColumnsRequestBody",
  "TestConnectionRequestBody",
  "TestConnectionResult",
] as const;

interface OpenApiSchemaBag {
  components?: {
    schemas?: Record<string, unknown>;
  };
  paths?: Record<string, unknown>;
}

describe("swagger spec — spreadsheet-parsing schema registration", () => {
  const spec = swaggerSpec as OpenApiSchemaBag;
  const schemas = spec.components?.schemas ?? {};

  it.each(REQUIRED_SCHEMA_NAMES)(
    "registers %s under components.schemas",
    (name) => {
      expect(schemas[name]).toBeDefined();
    }
  );

  // Round-trip: the registered spec entry must match z.toJSONSchema() output.
  // If the Zod schema changes, the swagger entry must change in lockstep.
  const JSON_SCHEMA_OPTS = { unrepresentable: "any" as const };
  const pairs: ReadonlyArray<readonly [string, z.ZodType]> = [
    ["LayoutPlan", LayoutPlanSchema],
    ["Region", RegionSchema],
    ["ColumnBinding", ColumnBindingSchema],
    ["SkipRule", SkipRuleSchema],
    ["HeaderStrategy", HeaderStrategySchema],
    ["IdentityStrategy", IdentityStrategySchema],
    ["Warning", WarningSchema],
    ["DriftReport", DriftReportSchema],
    ["InterpretInput", InterpretInputSchema],
    ["RegionHint", RegionHintSchema],
    ["InterpretRequestBody", InterpretRequestBodySchema],
    ["InterpretResponsePayload", InterpretResponsePayloadSchema],
    ["LayoutPlanCommitResult", LayoutPlanCommitResultSchema],
    [
      "LayoutPlanInterpretDraftResponsePayload",
      LayoutPlanInterpretDraftResponsePayloadSchema,
    ],
    [
      "LayoutPlanCommitDraftRequestBody",
      LayoutPlanCommitDraftRequestBodySchema,
    ],
    [
      "LayoutPlanCommitDraftResponsePayload",
      LayoutPlanCommitDraftResponsePayloadSchema,
    ],
    ["ApiAuthConfig", ApiAuthConfigSchema],
    ["ApiCredentials", ApiCredentialsSchema],
    ["PaginationConfig", PaginationConfigSchema],
    ["RestApiInstanceConfig", RestApiInstanceConfigSchema],
    ["ApiEndpointConfig", ApiEndpointConfigSchema],
    ["ApiEndpointEntity", ApiEndpointEntityWireSchema],
    ["ApiEndpoint", ApiEndpointWireSchema],
    ["ApiEndpointListResponse", ApiEndpointListResponsePayloadSchema],
    ["CreateApiEndpointRequestBody", CreateApiEndpointRequestBodySchema],
    ["PatchApiEndpointRequestBody", PatchApiEndpointRequestBodySchema],
    ["DeleteApiEndpointResponse", DeleteApiEndpointResponsePayloadSchema],
    ["ApiColumnSuggestion", ApiColumnSuggestionSchema],
    ["DiscoveredColumnWithSuggestion", DiscoveredColumnWithSuggestionSchema],
    ["DiscoverColumnsResult", DiscoverColumnsResultSchema],
    ["DiscoverColumnsRequestBody", DiscoverColumnsRequestBodySchema],
    ["TestConnectionRequestBody", TestConnectionRequestBodySchema],
    ["TestConnectionResult", TestConnectionResultSchema],
  ];

  it.each(pairs)(
    "%s in the spec is byte-equal to z.toJSONSchema(Schema)",
    (name, schema) => {
      const expected = z.toJSONSchema(schema, JSON_SCHEMA_OPTS);
      expect(schemas[name]).toEqual(expected);
    }
  );
});

describe("swagger spec — layout-plan endpoints", () => {
  const spec = swaggerSpec as OpenApiSchemaBag;
  const paths = spec.paths ?? {};

  it.each([
    "/api/connector-instances/{connectorInstanceId}/layout-plan/interpret",
    "/api/connector-instances/{connectorInstanceId}/layout-plan",
    "/api/connector-instances/{connectorInstanceId}/layout-plan/{planId}",
    "/api/connector-instances/{connectorInstanceId}/layout-plan/{planId}/commit",
  ])("registers %s under paths", (path) => {
    expect(paths[path]).toBeDefined();
  });

  it("interpret endpoint accepts a POST with InterpretInput body and LayoutPlan response", () => {
    const entry = paths[
      "/api/connector-instances/{connectorInstanceId}/layout-plan/interpret"
    ] as {
      post?: {
        requestBody?: { content: Record<string, { schema: unknown }> };
        responses?: Record<string, unknown>;
      };
    };
    expect(entry.post).toBeDefined();
    expect(entry.post?.requestBody?.content["application/json"].schema).toEqual(
      {
        $ref: "#/components/schemas/InterpretInput",
      }
    );
    expect(entry.post?.responses?.["200"]).toBeDefined();
    expect(entry.post?.responses?.["404"]).toBeDefined();
  });

  it("GET /layout-plan supports the include query parameter", () => {
    const entry = paths[
      "/api/connector-instances/{connectorInstanceId}/layout-plan"
    ] as {
      get?: {
        parameters?: Array<{ name: string; in: string }>;
      };
    };
    const includeParam = entry.get?.parameters?.find(
      (p) => p.name === "include" && p.in === "query"
    );
    expect(includeParam).toBeDefined();
  });

  it("PATCH endpoint is registered with the planId path param", () => {
    const entry = paths[
      "/api/connector-instances/{connectorInstanceId}/layout-plan/{planId}"
    ] as {
      patch?: { parameters?: Array<{ name: string; in: string }> };
    };
    const planIdParam = entry.patch?.parameters?.find(
      (p) => p.name === "planId" && p.in === "path"
    );
    expect(planIdParam).toBeDefined();
  });

  it("commit endpoint is registered with 200, 404, and 409 responses and a DriftReport-typed 409 payload", () => {
    const entry = paths[
      "/api/connector-instances/{connectorInstanceId}/layout-plan/{planId}/commit"
    ] as {
      post?: {
        responses?: Record<string, unknown>;
      };
    };
    expect(entry.post).toBeDefined();
    expect(entry.post?.responses?.["200"]).toBeDefined();
    expect(entry.post?.responses?.["404"]).toBeDefined();
    expect(entry.post?.responses?.["409"]).toBeDefined();
    const conflict = entry.post?.responses?.["409"] as {
      content?: {
        "application/json"?: {
          schema?: {
            allOf?: Array<unknown>;
          };
        };
      };
    };
    expect(conflict.content?.["application/json"]?.schema?.allOf).toBeDefined();
  });
});

describe("swagger spec — REST API connector endpoints", () => {
  const spec = swaggerSpec as OpenApiSchemaBag;
  const paths = spec.paths ?? {};

  it.each([
    [
      "/api/connector-instances/{instanceId}/api-endpoints",
      ["get", "post"] as const,
    ],
    [
      "/api/connector-instances/{instanceId}/api-endpoints/{entityId}",
      ["get", "patch", "delete"] as const,
    ],
    [
      "/api/connector-instances/{instanceId}/api-endpoints/{entityId}/discover-columns",
      ["post"] as const,
    ],
    ["/api/connector-instances/{id}/test-connection", ["post"] as const],
  ])("registers %s under paths with the expected verbs", (path, verbs) => {
    const entry = paths[path] as Record<string, unknown> | undefined;
    expect(entry).toBeDefined();
    for (const v of verbs) {
      expect(entry?.[v]).toBeDefined();
    }
  });

  it("POST /api-endpoints accepts CreateApiEndpointRequestBody and returns ApiEndpoint", () => {
    const entry = paths[
      "/api/connector-instances/{instanceId}/api-endpoints"
    ] as {
      post?: {
        requestBody?: { content: Record<string, { schema: unknown }> };
        responses?: Record<
          string,
          { content?: Record<string, { schema: unknown }> }
        >;
      };
    };
    expect(entry.post?.requestBody?.content["application/json"].schema).toEqual(
      { $ref: "#/components/schemas/CreateApiEndpointRequestBody" }
    );
    const body201 =
      entry.post?.responses?.["201"]?.content?.["application/json"]?.schema;
    expect(body201).toBeDefined();
  });

  it("POST .../discover-columns accepts DiscoverColumnsRequestBody and returns DiscoverColumnsResult", () => {
    const entry = paths[
      "/api/connector-instances/{instanceId}/api-endpoints/{entityId}/discover-columns"
    ] as {
      post?: {
        requestBody?: { content: Record<string, { schema: unknown }> };
        responses?: Record<string, unknown>;
      };
    };
    expect(entry.post?.requestBody?.content["application/json"].schema).toEqual(
      { $ref: "#/components/schemas/DiscoverColumnsRequestBody" }
    );
    expect(entry.post?.responses?.["200"]).toBeDefined();
    expect(entry.post?.responses?.["404"]).toBeDefined();
    expect(entry.post?.responses?.["502"]).toBeDefined();
  });

  it("POST /test-connection accepts TestConnectionRequestBody and returns TestConnectionResult", () => {
    const entry = paths["/api/connector-instances/{id}/test-connection"] as {
      post?: {
        requestBody?: { content: Record<string, { schema: unknown }> };
        responses?: Record<string, unknown>;
      };
    };
    expect(entry.post?.requestBody?.content["application/json"].schema).toEqual(
      { $ref: "#/components/schemas/TestConnectionRequestBody" }
    );
    expect(entry.post?.responses?.["200"]).toBeDefined();
    expect(entry.post?.responses?.["404"]).toBeDefined();
  });

  it("every registered REST API endpoint route declares a tag and security scheme", () => {
    const routes: Array<[string, "get" | "post" | "patch" | "delete"]> = [
      ["/api/connector-instances/{instanceId}/api-endpoints", "get"],
      ["/api/connector-instances/{instanceId}/api-endpoints", "post"],
      ["/api/connector-instances/{instanceId}/api-endpoints/{entityId}", "get"],
      [
        "/api/connector-instances/{instanceId}/api-endpoints/{entityId}",
        "patch",
      ],
      [
        "/api/connector-instances/{instanceId}/api-endpoints/{entityId}",
        "delete",
      ],
      [
        "/api/connector-instances/{instanceId}/api-endpoints/{entityId}/discover-columns",
        "post",
      ],
    ];
    for (const [path, verb] of routes) {
      const entry = (paths[path] as Record<string, unknown> | undefined)?.[
        verb
      ] as
        | {
            tags?: string[];
            security?: Array<Record<string, unknown>>;
          }
        | undefined;
      expect(entry?.tags).toContain("REST API Endpoints");
      expect(entry?.security?.[0]).toHaveProperty("bearerAuth");
    }
  });
});

describe("swagger spec — legacy uploads surface is fully removed", () => {
  const spec = swaggerSpec as OpenApiSchemaBag;
  const paths = spec.paths ?? {};

  it.each([
    "/api/uploads/presign",
    "/api/uploads/{jobId}/process",
    "/api/uploads/{jobId}/confirm",
  ])("does not register %s in the spec at all", (path) => {
    expect(paths[path]).toBeUndefined();
  });
});
