import { describe, it, expect } from "@jest/globals";
import { z } from "zod";

import {
  LayoutPlanSchema,
  RegionSchema,
  ColumnBindingSchema,
  SkipRuleSchema,
  HeaderStrategySchema,
  IdentityStrategySchema,
  WarningSchema,
  DriftReportSchema,
  InterpretInputSchema,
  RegionHintSchema,
  InterpretRequestBodySchema,
  InterpretResponsePayloadSchema,
  LayoutPlanCommitResultSchema,
  FileUploadParseResponsePayloadSchema,
  LayoutPlanInterpretDraftResponsePayloadSchema,
  LayoutPlanCommitDraftRequestBodySchema,
  LayoutPlanCommitDraftResponsePayloadSchema,
} from "@portalai/core/contracts";

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
  "FileUploadParseResponsePayload",
  "LayoutPlanInterpretDraftResponsePayload",
  "LayoutPlanCommitDraftRequestBody",
  "LayoutPlanCommitDraftResponsePayload",
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
    ["FileUploadParseResponsePayload", FileUploadParseResponsePayloadSchema],
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
