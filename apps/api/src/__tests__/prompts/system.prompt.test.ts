import { describe, it, expect } from "@jest/globals";
import {
  buildSystemPrompt,
  type StationContext,
} from "../../prompts/system.prompt.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<StationContext> = {}): StationContext {
  return {
    stationId: "station-1",
    stationName: "Test Station",
    organizationTimezone: "UTC",
    entities: [
      {
        id: "entity-1",
        key: "contacts",
        label: "Contacts",
        connectorInstanceId: "ci-1",
        columns: [
          {
            key: "name",
            type: "text",
            label: "Name",
            columnDefinitionId: "cd-1",
            fieldMappingId: "fm-1",
            sourceField: "Full Name",
          },
          {
            key: "email",
            type: "text",
            label: "Email",
            columnDefinitionId: "cd-2",
            fieldMappingId: "fm-2",
            sourceField: "Email Address",
          },
        ],
      },
      {
        id: "entity-2",
        key: "orders",
        label: "Orders",
        connectorInstanceId: "ci-1",
        columns: [
          {
            key: "total",
            type: "number",
            label: "Total",
            columnDefinitionId: "cd-3",
            fieldMappingId: "fm-3",
            sourceField: "Order Total",
          },
        ],
      },
    ],
    entityGroups: [],
    toolPacks: ["data_query"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — entityCapabilities", () => {
  it("renders [read, write] when entity has both capabilities", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        entityCapabilities: {
          "entity-1": { read: true, write: true, push: false },
          "entity-2": { read: true, write: true, push: false },
        },
      })
    );

    expect(prompt).toContain("[read, write]");
    expect(prompt).toContain("Contacts (`contacts`)");
    expect(prompt).toContain("Orders (`orders`)");
  });

  it("renders [read] for read-only entities", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["entity_management"],
        entityCapabilities: {
          "entity-1": { read: true, write: false, push: false },
          "entity-2": { read: true, write: true, push: false },
        },
      })
    );

    expect(prompt).toContain(
      "Contacts (`contacts`) [connectorEntityId: entity-1] [read]"
    );
    expect(prompt).toContain(
      "Orders (`orders`) [connectorEntityId: entity-2] [read, write]"
    );
  });

  it("omits capability flags when entityCapabilities is undefined", () => {
    const prompt = buildSystemPrompt(makeContext());

    expect(prompt).toContain("### Contacts (`contacts`)");
    expect(prompt).not.toContain("[read");
  });
});

describe("buildSystemPrompt — entity management IDs", () => {
  it("renders connectorEntityId in heading when entity_management is in toolPacks", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] })
    );

    expect(prompt).toContain("[connectorEntityId: entity-1]");
    expect(prompt).toContain("[connectorEntityId: entity-2]");
  });

  it("renders columnDefinitionId, fieldMappingId, sourceField per column", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] })
    );

    expect(prompt).toContain(
      '[columnDefinitionId: cd-1, fieldMappingId: fm-1, sourceField: "Full Name"]'
    );
    expect(prompt).toContain(
      '[columnDefinitionId: cd-3, fieldMappingId: fm-3, sourceField: "Order Total"]'
    );
  });

  it("omits IDs when entity_management is not in toolPacks", () => {
    const prompt = buildSystemPrompt(makeContext());

    expect(prompt).not.toContain("connectorEntityId:");
    expect(prompt).not.toContain("columnDefinitionId:");
    expect(prompt).not.toContain("fieldMappingId:");
    expect(prompt).not.toContain("sourceField:");
  });
});

describe("buildSystemPrompt — entity management notes", () => {
  it('includes "Entity Management Notes" section when entity_management in toolPacks', () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query", "entity_management"] })
    );

    expect(prompt).toContain("## Entity Management Notes");
    expect(prompt).toContain("origin");
    expect(prompt).toContain("_record_id");
    expect(prompt).toContain("_connector_entity_id");
  });

  it("documents normalizedKey concept", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] })
    );

    expect(prompt).toContain("normalizedKey");
    expect(prompt).toContain("normalizedData");
  });

  it("documents validationPattern and canonicalFormat on column definitions", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] })
    );

    expect(prompt).toContain("validationPattern");
    expect(prompt).toContain("canonicalFormat");
  });

  it("documents field mapping attributes: required, defaultValue, format, enumValues", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] })
    );

    expect(prompt).toContain("normalizedKey");
    expect(prompt).toContain("defaultValue");
    expect(prompt).toContain("enumValues");
    expect(prompt).toMatch(/field mappings define per-source attributes/i);
  });

  it("does not reference currency type", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] })
    );

    expect(prompt).toContain("no `currency` type");
    expect(prompt).not.toMatch(/\btype.*currency\b(?!.*no)/);
  });

  it('omits "Entity Management Notes" when entity_management not in toolPacks', () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query"] })
    );

    expect(prompt).not.toContain("Entity Management Notes");
  });
});

describe("buildSystemPrompt — response style", () => {
  it("includes ## Response Style for every toolPack composition", () => {
    const compositions: StationContext["toolPacks"][] = [
      [],
      ["data_query"],
      ["entity_management"],
      ["data_query", "entity_management"],
    ];

    for (const toolPacks of compositions) {
      const prompt = buildSystemPrompt(makeContext({ toolPacks }));
      expect(prompt).toContain("## Response Style");
    }
  });

  it("places ## Response Style after all other sections", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["data_query", "entity_management"],
        entityGroups: [
          {
            id: "eg-1",
            name: "People graph",
            members: [
              {
                entityKey: "contacts",
                connectorEntityId: "ent-contacts",
                linkNormalizedKey: "email",
                linkColumnKey: "email",
                linkColumnLabel: "Email",
                isPrimary: true,
              },
              {
                entityKey: "orders",
                connectorEntityId: "ent-orders",
                linkNormalizedKey: "customer_email",
                linkColumnKey: "customer_email",
                linkColumnLabel: "Customer Email",
                isPrimary: false,
              },
            ],
          },
        ],
        entityCapabilities: {
          "entity-1": { read: true, write: true, push: false },
          "entity-2": { read: true, write: false, push: false },
        },
      })
    );

    const responseStyleIdx = prompt.indexOf("## Response Style");
    expect(responseStyleIdx).toBeGreaterThan(prompt.indexOf("## Available Data"));
    expect(responseStyleIdx).toBeGreaterThan(
      prompt.indexOf("## Cross-Entity Relationships")
    );
    expect(responseStyleIdx).toBeGreaterThan(
      prompt.indexOf("## Entity Management Notes")
    );
  });

  it("contains all wording invariants", () => {
    const prompt = buildSystemPrompt(makeContext());

    const invariants = [
      "## Response Style",
      "Skip pre-ambles",
      "Skip post-ambles",
      "Summary:",
      "Key takeaways:",
      "describe_column",
      "web_search",
      "resolve_identity",
      "Q3 revenue was $1.24M",
    ];

    for (const phrase of invariants) {
      expect(prompt).toContain(phrase);
    }
  });

  it("contains the good/bad example pair", () => {
    const prompt = buildSystemPrompt(makeContext());

    const goodIdx = prompt.indexOf("Good");
    const badIdx = prompt.indexOf("Bad");
    expect(goodIdx).toBeGreaterThan(-1);
    expect(badIdx).toBeGreaterThan(goodIdx);
    expect(badIdx - goodIdx).toBeLessThan(250);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 slice 4 — SQL guidance + metadata-tables-paragraph drop (cases 74–77)
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — Phase 3 surface", () => {
  // Case 74
  it("no longer references the AlaSQL metadata tables", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query", "entity_management"] })
    );
    // The AlaSQL surface used bare names like `_connector_instances`,
    // `_connector_entities`, etc. as the table identifier. They must
    // NOT appear as a bare reference. The new schema-introspection
    // views (#87) use a `_meta_` prefix and are explicitly excluded.
    expect(prompt).not.toMatch(/(?<!_meta)_connector_instances\b/);
    expect(prompt).not.toMatch(/(?<!_meta)_connector_entities\b/);
    expect(prompt).not.toMatch(/(?<!_meta)_column_definitions\b/);
    expect(prompt).not.toMatch(/(?<!_meta)_field_mappings\b/);
  });

  // Case 75
  it("still surfaces the synthetic _record_id and _connector_entity_id columns", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query", "entity_management"] })
    );
    expect(prompt).toContain("_record_id");
    expect(prompt).toContain("_connector_entity_id");
  });

  // Case 76
  it("includes the PostgreSQL-compatible SQL guidance block when data_query is enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query"] })
    );
    expect(prompt).toContain("## SQL Guidance");
    expect(prompt).toContain("PostgreSQL-compatible SQL");
    expect(prompt).toContain("LIMIT");
    expect(prompt).toContain("SELECT *");
    expect(prompt).toMatch(/COUNT|AVG|MAX|SUM/);
    expect(prompt).toContain("queryHandle");
    expect(prompt).toContain("samplePeek");
    expect(prompt).toMatch(/NEVER add a `LIMIT` clause to a user-facing/);
    expect(prompt).toMatch(/see \/ show \/ display \/ list/);
    expect(prompt).toMatch(/let me show you a sample/);
    expect(prompt).toMatch(/Reading a `queryHandle` envelope/);
    expect(prompt).toMatch(/the user is already seeing every one of the/);
    expect(prompt).toMatch(/double quotes/i);
  });

  it("omits the SQL guidance block when data_query is not enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] })
    );
    expect(prompt).not.toContain("## SQL Guidance");
  });

  it("drops the AlaSQL `[bracket]` example query in favour of a double-quoted one", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query", "entity_management"] })
    );
    expect(prompt).not.toContain("FROM [table]");
    expect(prompt).toMatch(/FROM "contacts"/);
  });

  // Case 77 — capability tag continues to render per entity. Covered above
  // under "entityCapabilities"; restated here as the explicit phase-3 assertion.
  it("still renders the [read, write] capability tag per entity", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["data_query", "entity_management"],
        entityCapabilities: {
          "entity-1": { read: true, write: true, push: false },
          "entity-2": { read: true, write: false, push: false },
        },
      })
    );
    expect(prompt).toContain("[read, write]");
    expect(prompt).toContain("[read]");
  });
});

describe("buildSystemPrompt — schema introspection meta views (#87)", () => {
  it("instructs the agent about _meta_entities + _meta_columns when data_query is enabled", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain("## Schema Introspection (live)");
    expect(prompt).toContain("_meta_entities");
    expect(prompt).toContain("_meta_columns");
    expect(prompt).toContain("wide_column_name");
  });

  it("omits the Schema Introspection section entirely when data_query is disabled", () => {
    const prompt = buildSystemPrompt(makeContext({ toolPacks: [] }));
    expect(prompt).not.toContain("## Schema Introspection");
    expect(prompt).not.toContain("_meta_entities");
  });

  it("tells the agent to re-introspect after creating an entity mid-session", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query", "entity_management"] })
    );
    // Specifically calls out the failure mode the user hit: created
    // entity, can't find it via static prompt listing.
    expect(prompt).toMatch(/can't find a table you just created/i);
  });

  it("mentions _meta_column_catalog and states column definitions are admin-only", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain("_meta_column_catalog");
    expect(prompt).toMatch(/admin-only/i);
    // Specifically must NOT promise the agent a column_definition_create tool.
    expect(prompt).not.toContain("column_definition_create");
  });

  it("includes the entity-creation guidance with the right failure-mode behavior", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query", "entity_management"] })
    );
    expect(prompt).toContain("### Creating a new entity");
    // The critical anti-pattern from the user's failing session:
    // agent punted to "do this in the UI" without naming what was
    // missing. The prompt must explicitly reject that.
    expect(prompt).toMatch(/STOP and tell the user/i);
    expect(prompt).toMatch(/unhelpful punt/i);
    // And tell the agent to offer the proceed-with-subset path.
    expect(prompt).toMatch(/proceed using only the fields/i);
  });

  it("omits entity-creation guidance when entity_management is NOT enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query"] })
    );
    expect(prompt).not.toContain("### Creating a new entity");
  });

  it("does NOT mention a _meta_connector_instances view (instances are listed statically in the prompt instead)", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query", "entity_management"] })
    );
    expect(prompt).not.toContain("_meta_connector_instances");
  });
});

describe("buildSystemPrompt — Available Connector Instances (#87 followup)", () => {
  it("lists attached connector instances when entity_management is enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["data_query", "entity_management"],
        connectorInstances: [
          { id: "ci-1", name: "Sandbox", display: "REST API", slug: "rest-api" },
          {
            id: "ci-2",
            name: "Personal",
            display: "File Upload",
            slug: "file-upload",
          },
        ],
      })
    );
    expect(prompt).toContain("## Available Connector Instances");
    expect(prompt).toContain("ci-1");
    expect(prompt).toContain("Sandbox");
    expect(prompt).toContain("REST API");
    expect(prompt).toContain("rest-api");
    expect(prompt).toContain("ci-2");
    expect(prompt).toContain("Personal");
  });

  it("instructs the agent to pick from the listed ids — do not invent one", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["data_query", "entity_management"],
        connectorInstances: [
          { id: "ci-1", name: "Sandbox", display: "REST API", slug: "rest-api" },
        ],
      })
    );
    expect(prompt).toMatch(/do not invent one/i);
  });

  it("omits the section when entity_management is NOT enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["data_query"],
        connectorInstances: [
          { id: "ci-1", name: "Sandbox", display: "REST API", slug: "rest-api" },
        ],
      })
    );
    expect(prompt).not.toContain("## Available Connector Instances");
  });

  it("omits the section when connectorInstances is empty", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["data_query", "entity_management"],
        connectorInstances: [],
      })
    );
    expect(prompt).not.toContain("## Available Connector Instances");
  });
});

// ---------------------------------------------------------------------------
// Current time section (#90)
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — Current time (#90)", () => {
  it("renders the ## Current time section with the org's timezone", () => {
    const prompt = buildSystemPrompt(
      makeContext({ organizationTimezone: "America/Los_Angeles" })
    );
    expect(prompt).toContain("## Current time");
    expect(prompt).toContain("America/Los_Angeles");
  });

  it("directs the agent to call get_current_time before resolving relative time expressions", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain("get_current_time");
    expect(prompt).toMatch(/relative time expression/i);
  });

  it("renders the date-emission rule referencing canonicalFormat with an ISO 8601 fallback", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain("canonicalFormat");
    expect(prompt).toContain("YYYY-MM-DD");
    // Example ISO 8601 with offset must be present.
    expect(prompt).toMatch(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/
    );
  });

  it("renders ## Current time even when no toolpacks are enabled", () => {
    // Temporal context is universal — not gated on data_query /
    // entity_management.
    const prompt = buildSystemPrompt(makeContext({ toolPacks: [] }));
    expect(prompt).toContain("## Current time");
  });
});
