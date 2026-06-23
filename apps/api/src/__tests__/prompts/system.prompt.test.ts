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

describe("buildSystemPrompt — Available Data roster (#97)", () => {
  it("lists each entity by key + label in a lightweight roster", () => {
    const prompt = buildSystemPrompt(makeContext());

    expect(prompt).toContain("Entities on this station:");
    expect(prompt).toContain("- `contacts` — Contacts");
    expect(prompt).toContain("- `orders` — Orders");
  });

  it("points the agent at station_context for the full schema", () => {
    const prompt = buildSystemPrompt(makeContext());

    expect(prompt).toMatch(/Call `station_context`/);
    expect(prompt).toMatch(/Always call this before any tool that takes an id/);
  });

  it("renders empty-state copy when no entities are attached", () => {
    const prompt = buildSystemPrompt(makeContext({ entities: [] }));

    expect(prompt).toContain("_No entities attached to this station yet._");
    expect(prompt).not.toContain("Entities on this station:");
  });

  it("never embeds connectorEntityId / columnDefinitionId / fieldMappingId / capability markers (those moved to the tool)", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["entity_management"],
        entityCapabilities: {
          "entity-1": { read: true, write: true, push: false },
          "entity-2": { read: true, write: false, push: false },
        },
      })
    );

    expect(prompt).not.toContain("[connectorEntityId:");
    expect(prompt).not.toContain("[columnDefinitionId:");
    expect(prompt).not.toContain("[fieldMappingId:");
    expect(prompt).not.toContain("[read, write]");
    expect(prompt).not.toContain("[read]");
  });
});

describe("buildSystemPrompt — tool-caller role (#146)", () => {
  // The agent is a tool-caller, not a chatbot: a general operating principle,
  // present regardless of which packs are enabled.
  it.each([
    ["data_query"],
    ["statistics"],
    ["regression"],
    ["financial"],
    ["entity_management"],
  ])("states the route-to-a-tool role when %s is enabled", (pack) => {
    const prompt = buildSystemPrompt(makeContext({ toolPacks: [pack] }));
    expect(prompt).toContain("## Your role: route to a tool");
    expect(prompt).toMatch(/tool-caller/i);
    // the load-bearing prohibitions
    expect(prompt).toMatch(/Do the work through a tool, not in your head/i);
    expect(prompt).toMatch(/Don't fabricate results or attribute methods/i);
    expect(prompt).toMatch(/If no tool fits, say so/i);
  });

  it("is present even with a minimal toolpack set", () => {
    const prompt = buildSystemPrompt(makeContext({ toolPacks: ["data_query"] }));
    expect(prompt).toContain("## Your role: route to a tool");
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
      "hypothesis_test",
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
    expect(prompt).toMatch(/COUNT|AVG|MAX|SUM/);
    expect(prompt).toMatch(/project only the columns you need/i);
    expect(prompt).toContain("queryHandle");
    expect(prompt).toContain("samplePeek");
    expect(prompt).toContain("display_entity_records");
    expect(prompt).toMatch(/see, show, display, or list/);
    expect(prompt).toMatch(/double-quoted identifiers/i);
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

  // #97 — capability tags moved out of the static prompt and into
  // the station_context tool's response.
  it("no longer embeds capability tags in the prompt (moved to station_context)", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["data_query", "entity_management"],
        entityCapabilities: {
          "entity-1": { read: true, write: true, push: false },
          "entity-2": { read: true, write: false, push: false },
        },
      })
    );
    expect(prompt).not.toContain("[read, write]");
    expect(prompt).not.toContain("[read]");
    // But the agent is still told where capabilities live.
    expect(prompt).toMatch(/station_context/);
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

describe("buildSystemPrompt — Connector Instances pointer (#97)", () => {
  it("mentions the count of attached connector instances + points at station_context", () => {
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
    expect(prompt).toContain("## Connector Instances");
    expect(prompt).toMatch(/2 connector instances? attached/);
    expect(prompt).toMatch(/station_context/);
    // The ids themselves are NOT in the prompt — the tool delivers them.
    expect(prompt).not.toContain("ci-1");
    expect(prompt).not.toContain("ci-2");
  });

  it("instructs the agent to call the tool — never invent or ask the user", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["data_query", "entity_management"],
        connectorInstances: [
          { id: "ci-1", name: "Sandbox", display: "REST API", slug: "rest-api" },
        ],
      })
    );
    expect(prompt).toMatch(/Never invent/i);
    expect(prompt).toMatch(/never ask the user/i);
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
    expect(prompt).not.toContain("## Connector Instances");
  });

  it("omits the section when connectorInstances is empty", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        toolPacks: ["data_query", "entity_management"],
        connectorInstances: [],
      })
    );
    expect(prompt).not.toContain("## Connector Instances");
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

  it("directs the agent to call current_time before resolving relative time expressions", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain("current_time");
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
