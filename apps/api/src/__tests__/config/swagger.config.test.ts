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
  DeltaEventSchema,
  DoneEventSchema,
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
  PublicSiteConfigResponseSchema,
  PublicSitePriceSchema,
  PublicSiteTierSchema,
  RegionHintSchema,
  RegionSchema,
  SkipRuleSchema,
  StreamErrorEventSchema,
  TestConnectionRequestBodySchema,
  TestConnectionResultSchema,
  ToolCallEndEventSchema,
  ToolCallEventSchema,
  ToolResultEventSchema,
  WarningSchema,
} from "@portalai/core/contracts";
import {
  ApiAuthConfigSchema,
  ApiCredentialsSchema,
  ApiEndpointConfigSchema,
  PaginationConfigSchema,
  RestApiInstanceConfigSchema,
} from "@portalai/core/models";

import { app } from "../../app.js";
import { swaggerSpec } from "../../config/swagger.config.js";
import {
  documentedOperations,
  registeredRoutes,
} from "./express-route-inventory.util.js";

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

// #279 — the portal stream's event payloads were never registered, and the
// route's @openapi block described them in hand-written prose that had drifted
// from the wire (wrong path, `name` for what is really `toolName`, no
// `stream_error`). Registering them from the Zod source makes the drift a test
// failure instead of a docs bug.
describe("swagger spec — portal stream events (#279)", () => {
  const spec = swaggerSpec as OpenApiSchemaBag;
  const schemas = spec.components?.schemas ?? {};
  const paths = spec.paths ?? {};

  const STREAM_PATH = "/api/sse/portals/{portalId}/stream";
  const JSON_SCHEMA_OPTS = { unrepresentable: "any" as const };

  const eventPairs: ReadonlyArray<readonly [string, z.ZodType]> = [
    ["PortalDeltaEvent", DeltaEventSchema],
    ["PortalToolCallEvent", ToolCallEventSchema],
    ["PortalToolCallEndEvent", ToolCallEndEventSchema],
    ["PortalToolResultEvent", ToolResultEventSchema],
    ["PortalDoneEvent", DoneEventSchema],
    ["PortalStreamErrorEvent", StreamErrorEventSchema],
  ];

  it.each(eventPairs.map(([name]) => name))(
    "registers %s under components.schemas",
    (name) => {
      expect(schemas[name]).toBeDefined();
    }
  );

  it.each(eventPairs)(
    "%s in the spec is byte-equal to z.toJSONSchema(Schema)",
    (name, schema) => {
      expect(schemas[name]).toEqual(z.toJSONSchema(schema, JSON_SCHEMA_OPTS));
    }
  );

  it("exposes a PortalStreamEvent union over exactly the six wire events", () => {
    const union = schemas["PortalStreamEvent"] as {
      oneOf?: Array<{ $ref?: string }>;
    };
    expect(union?.oneOf).toBeDefined();
    expect(union.oneOf).toHaveLength(6);
    expect(union.oneOf?.map((o) => o.$ref).sort()).toEqual(
      eventPairs.map(([name]) => `#/components/schemas/${name}`).sort()
    );
  });

  it("registers the stream under its real mounted path, not the stale one", () => {
    expect(paths[STREAM_PATH]).toBeDefined();
    // The block used to declare /api/portals/... — the router is mounted at
    // /api/sse/portals via sse.router.ts, so the old path documented an
    // endpoint that does not exist.
    expect(paths["/api/portals/{portalId}/stream"]).toBeUndefined();
  });

  it("types the text/event-stream response as the PortalStreamEvent union", () => {
    const entry = paths[STREAM_PATH] as {
      get?: {
        responses?: Record<
          string,
          { content?: Record<string, { schema?: unknown }> }
        >;
      };
    };
    expect(entry.get).toBeDefined();
    expect(
      entry.get?.responses?.["200"]?.content?.["text/event-stream"]?.schema
    ).toEqual({ $ref: "#/components/schemas/PortalStreamEvent" });
  });

  it("names every wire event in the route description", () => {
    const entry = paths[STREAM_PATH] as { get?: { description?: string } };
    const description = entry.get?.description ?? "";
    for (const name of [
      "delta",
      "tool_call",
      "tool_call_end",
      "tool_result",
      "done",
      "stream_error",
    ]) {
      expect(description).toContain(name);
    }
  });
});

// The `Station` component is referenced by the create/update responses, both
// of which return `enabledToolpacks`. It used to declare a REQUIRED
// `toolPacks` — the *request* body's field name — so a generated client
// expected a field the API never sends.
describe("swagger spec — Station response schema", () => {
  const spec = swaggerSpec as OpenApiSchemaBag;
  const station = (spec.components?.schemas ?? {})["Station"] as {
    required?: string[];
    properties?: Record<string, unknown>;
  };

  it("declares enabledToolpacks, not the request body's toolPacks", () => {
    expect(station.properties).toHaveProperty("enabledToolpacks");
    expect(station.properties).not.toHaveProperty("toolPacks");
  });

  it("does not require the pack list", () => {
    // `StationWithToolpacksSchema` in @portalai/core/contracts has it optional
    // — it is only populated by the toolpacks join.
    expect(station.required ?? []).not.toContain("enabledToolpacks");
    expect(station.required ?? []).not.toContain("toolPacks");
  });
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

// #311 — the public site-config endpoint is the API's only anonymous data
// surface. Its schemas must be registered (the route `$ref`s them) and must
// round-trip from the Zod source, and — the part that actually matters — the
// path must carry NO `security` key, or Swagger would advertise a bearer
// requirement the endpoint deliberately doesn't have.
describe("swagger spec — public site config (#311)", () => {
  const spec = swaggerSpec as OpenApiSchemaBag;
  const schemas = spec.components?.schemas ?? {};
  const paths = spec.paths ?? {};

  const JSON_SCHEMA_OPTS = { unrepresentable: "any" as const };
  const publicSitePairs: ReadonlyArray<readonly [string, z.ZodType]> = [
    ["PublicSitePrice", PublicSitePriceSchema],
    ["PublicSiteTier", PublicSiteTierSchema],
    ["PublicSiteConfigResponse", PublicSiteConfigResponseSchema],
  ];

  it.each(publicSitePairs.map(([name]) => name))(
    "registers %s under components.schemas",
    (name) => {
      expect(schemas[name]).toBeDefined();
    }
  );

  it.each(publicSitePairs)(
    "%s in the spec is byte-equal to z.toJSONSchema(Schema)",
    (name, schema) => {
      expect(schemas[name]).toEqual(z.toJSONSchema(schema, JSON_SCHEMA_OPTS));
    }
  );

  it("documents GET /api/public/site-config with no security requirement", () => {
    const entry = (
      paths["/api/public/site-config"] as Record<string, unknown> | undefined
    )?.["get"] as
      | {
          tags?: string[];
          security?: unknown;
          responses?: Record<string, unknown>;
        }
      | undefined;

    expect(entry).toBeDefined();
    expect(entry?.tags).toContain("Public Site");
    expect(entry?.security).toBeUndefined();
    // The fail-closed 503 and the per-IP 429 are part of the contract.
    expect(Object.keys(entry?.responses ?? {}).sort()).toEqual([
      "200",
      "429",
      "500",
      "503",
    ]);
  });
});

// Document-wide completeness guards (#420). The three defects this closes were
// each introduced by a commit that added a route or a $ref and nobody noticed:
// 3 operations declared no responses at all, 10 $refs pointed at components
// that were never registered, and 7 routes carried no @openapi block. The
// per-feature describes above spot-check individual routes; these assert
// properties of the whole document, so the next omission fails at its commit.
describe("swagger spec — document completeness (#420)", () => {
  const spec = swaggerSpec as OpenApiSchemaBag;
  const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

  /** Every (method, path) operation in the document. */
  const operations = Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
    Object.entries(item as Record<string, unknown>)
      .filter(([method]) =>
        (HTTP_METHODS as readonly string[]).includes(method)
      )
      .map(([method, operation]) => ({
        label: `${method.toUpperCase()} ${path}`,
        operation: operation as { responses?: Record<string, unknown> },
      }))
  );

  it("documents a non-trivial number of operations", () => {
    // Guards the guards: if the spec ever fails to build, `operations` goes
    // empty and every assertion below passes vacuously.
    expect(operations.length).toBeGreaterThan(100);
  });

  it("declares at least one response on every operation", () => {
    const undeclared = operations
      .filter(({ operation }) => {
        const responses = operation.responses ?? {};
        return Object.keys(responses).length === 0;
      })
      .map(({ label }) => label);

    expect(undeclared).toEqual([]);
  });

  it("resolves every $ref against the document", () => {
    const refs = new Set<string>();
    JSON.stringify(spec, (_key, value) => {
      const ref = (value as { $ref?: unknown } | null)?.$ref;
      if (typeof ref === "string") refs.add(ref);
      return value;
    });

    const dangling = [...refs].filter((ref) => {
      let cursor: unknown = spec;
      for (const segment of ref.replace(/^#\//, "").split("/")) {
        cursor = (cursor as Record<string, unknown> | undefined)?.[segment];
        if (cursor === undefined) return true;
      }
      return false;
    });

    expect(dangling.sort()).toEqual([]);
  });
  // Route parity, compared as sets against the app's real routing table (#443).
  //
  // This replaced a per-file count of `@openapi` blocks, which could only ever
  // catch an omitted block: a block declaring a path the app does not serve was
  // counted and passed, and so was a block whose body was malformed. Both
  // happened — the second one during #420's own implementation. Comparing the
  // registered `(method, path)` set against `spec.paths` closes the first;
  // the schema-shape case below closes the second.
  //
  // Importing the app costs nothing here: `setupFiles` (src/__tests__/setup.ts)
  // already sets AUTH0_AUDIENCE/AUTH0_DOMAIN before any module loads, which is
  // what `auth.middleware.ts` needs at import time.
  describe("route parity", () => {
    // The two spec-serving endpoints. Documenting the documentation endpoints
    // inside the documentation is circular, so they are excluded by design.
    const ALLOW_LISTED = new Set(["GET /api/docs", "GET /api/docs/spec"]);

    const registered = registeredRoutes(app);
    const documented = documentedOperations(swaggerSpec);

    it("enumerates the routing table at all", () => {
      // Guards the guard: the enumerator reads Express 4 internals, so an
      // upgrade that moves them yields an empty set — and every assertion
      // below would pass vacuously at the moment it stopped working.
      expect(registered.size).toBeGreaterThan(100);
    });

    it("documents every registered route", () => {
      const undocumented = [...registered]
        .filter((route) => !ALLOW_LISTED.has(route))
        .filter((route) => !documented.has(route))
        .sort();

      expect(undocumented).toEqual([]);
    });

    it("registers every documented path", () => {
      // The direction a per-file count could never check: an `@openapi` block
      // whose path string does not match where the router is actually mounted.
      const phantom = [...documented]
        .filter((operation) => !registered.has(operation))
        .sort();

      expect(phantom).toEqual([]);
    });
  });

  // The malformed-annotation case (#443). A YAML flow map written `{{ x }}`
  // instead of `{ x }` parses into a property literally named "{ x }" whose
  // value is null, so the operation claims a documented shape and delivers
  // gibberish — while every presence-based assertion above still passes.
  //
  // This is a targeted invariant, not schema validation. A real OpenAPI
  // validator is not usable on this document: it declares 3.0.0 while its
  // z.toJSONSchema components embed `$schema` draft/2020-12 and `type: "null"`,
  // neither valid in 3.0. Fixing that is a 3.1 migration, not this ticket.
  it("carries no garbled keys or stray nulls", () => {
    const badKeys: string[] = [];
    const strayNulls: string[] = [];

    const walk = (node: unknown, path: string, inPathsMap: boolean): void => {
      if (node === null) {
        // `default: null` is legitimate on a nullable field; anything else null
        // is a YAML flow map that collapsed.
        if (!path.endsWith(".default")) strayNulls.push(path);
        return;
      }
      if (typeof node !== "object") return;
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`, false));
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        // Top-level `paths` keys are path templates — braces are correct there.
        if (!inPathsMap && (/[{}]/.test(key) || key.includes(": "))) {
          badKeys.push(`${path}.${key}`);
        }
        walk(value, `${path}.${key}`, path === "" && key === "paths");
      }
    };

    walk(swaggerSpec, "", false);

    expect(badKeys).toEqual([]);
    expect(strayNulls).toEqual([]);
  });
});
