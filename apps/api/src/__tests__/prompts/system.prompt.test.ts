import { describe, it, expect } from "@jest/globals";
import { BuiltinToolpackSlugSchema } from "@portalai/core/registries";
import {
  buildSystemPrompt,
  PACK_PROMPT_SECTIONS,
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
    // #284: the prompt gates on EFFECTIVE packs (configured ∩ entitled).
    // `unentitledToolPacks` defaults to none so existing cases describe a
    // fully-entitled station, exactly as they did pre-rename.
    unentitledToolPacks: [],
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
    effectiveToolPacks: ["data_query"],
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
        effectiveToolPacks: ["entity_management"],
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
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: [pack] })
    );
    expect(prompt).toContain("## Your role: route to a tool");
    expect(prompt).toMatch(/tool-caller/i);
    // the load-bearing prohibitions
    expect(prompt).toMatch(/Do the work through a tool, not in your head/i);
    expect(prompt).toMatch(/Don't fabricate results or attribute methods/i);
    expect(prompt).toMatch(/If no tool fits, say so/i);
  });

  it("is present even with a minimal toolpack set", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query"] })
    );
    expect(prompt).toContain("## Your role: route to a tool");
  });
});

describe("buildSystemPrompt — Mapping treatment guidance (#337)", () => {
  it("teaches the agent that line layers stay raw + how treatment overrides it", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query", "gis"] })
    );
    expect(prompt).toContain("### Mapping");
    expect(prompt).toContain("aggregation.treatment");
    expect(prompt).toContain("importance-ranked");
  });

  it("teaches colorBy.scale interpolate for a smooth gradient (#336)", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query", "gis"] })
    );
    expect(prompt).toContain('colorBy.scale: "interpolate"');
    expect(prompt.toLowerCase()).toContain("smooth gradient");
  });

  it("teaches geocoding for addresses without coordinates + the no-fabrication rule (#315)", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query", "gis"] })
    );
    expect(prompt).toContain("geocode");
    expect(prompt).toContain("bulk_geocode_records");
    expect(prompt).toContain("acknowledgeCost: true");
    expect(prompt.toLowerCase()).toContain("never fabricate coordinates");
  });
});

describe("buildSystemPrompt — entity management notes", () => {
  it('includes "Entity Management Notes" section when entity_management in toolPacks', () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query", "entity_management"] })
    );

    expect(prompt).toContain("## Entity Management Notes");
    expect(prompt).toContain("origin");
    expect(prompt).toContain("_record_id");
    expect(prompt).toContain("_connector_entity_id");
  });

  it("documents normalizedKey concept", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["entity_management"] })
    );

    expect(prompt).toContain("normalizedKey");
    expect(prompt).toContain("normalizedData");
  });

  it("documents validationPattern and canonicalFormat on column definitions", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["entity_management"] })
    );

    expect(prompt).toContain("validationPattern");
    expect(prompt).toContain("canonicalFormat");
  });

  it("documents field mapping attributes: required, defaultValue, format, enumValues", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["entity_management"] })
    );

    expect(prompt).toContain("normalizedKey");
    expect(prompt).toContain("defaultValue");
    expect(prompt).toContain("enumValues");
    expect(prompt).toMatch(/field mappings define per-source attributes/i);
  });

  it("does not reference currency type", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["entity_management"] })
    );

    expect(prompt).toContain("no `currency` type");
    expect(prompt).not.toMatch(/\btype.*currency\b(?!.*no)/);
  });

  it('omits "Entity Management Notes" when entity_management not in toolPacks', () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query"] })
    );

    expect(prompt).not.toContain("Entity Management Notes");
  });
});

describe("buildSystemPrompt — response style", () => {
  // #277: the display cap made the worked example factually wrong — it
  // taught the agent to say "Showing all 5,402 parcels below.", which claims
  // a row count the table does not list and a position the block does not
  // occupy (the widget renders before the closing text).
  it("does not teach the agent to claim every row is shown", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).not.toMatch(/Showing all [\d,]+ \w+ below/i);
    expect(prompt).not.toMatch(/user sees every row/i);
  });

  it("does not use spatial references for rendered widgets", () => {
    // Block order is not the agent's to assume: the tool's widget is minted
    // before the assistant's closing sentence, so "below" is wrong.
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).not.toMatch(
      /\b(widget|table|chart|results?) (is |are )?below\b/i
    );
  });

  it("teaches the agent to acknowledge the display cap for large results", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toMatch(/first 5,000|5,000 rows/);
    // And that the cap is on the listing, not the analysis.
    expect(prompt).toMatch(/analys/i);
  });

  it("includes ## Response Style for every toolPack composition", () => {
    const compositions: StationContext["effectiveToolPacks"][] = [
      [],
      ["data_query"],
      ["entity_management"],
      ["data_query", "entity_management"],
    ];

    for (const effectiveToolPacks of compositions) {
      const prompt = buildSystemPrompt(makeContext({ effectiveToolPacks }));
      expect(prompt).toContain("## Response Style");
    }
  });

  it("places ## Response Style after all other sections", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query", "entity_management"],
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
    expect(responseStyleIdx).toBeGreaterThan(
      prompt.indexOf("## Available Data")
    );
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
      "Q3 revenue was $1.24M",
    ];

    for (const phrase of invariants) {
      expect(prompt).toContain(phrase);
    }
  });

  // #284: the interpretive-output sentence used to name hypothesis_test,
  // web_search and resolve_identity unconditionally — on a station with
  // neither the statistics nor the web_search pack. Those names are now
  // assembled from the effective packs, so they are asserted against a
  // context that actually provides them.
  it("names interpretive tools for the packs that provide them", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query", "statistics", "web_search"],
      })
    );

    for (const tool of ["hypothesis_test", "web_search", "resolve_identity"]) {
      expect(prompt).toContain(tool);
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
      makeContext({ effectiveToolPacks: ["data_query", "entity_management"] })
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
      makeContext({ effectiveToolPacks: ["data_query", "entity_management"] })
    );
    expect(prompt).toContain("_record_id");
    expect(prompt).toContain("_connector_entity_id");
  });

  // Case 76
  it("includes the PostgreSQL-compatible SQL guidance block when data_query is enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query"] })
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
      makeContext({ effectiveToolPacks: ["entity_management"] })
    );
    expect(prompt).not.toContain("## SQL Guidance");
  });

  // #269 — visualize_d3 needs SQL, so the guidance also applies when the
  // `visualize` pack is enabled even without `data_query`.
  it("includes SQL guidance + visualize_d3 charting guidance when only visualize is enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["visualize"] })
    );
    expect(prompt).toContain("## SQL Guidance");
    expect(prompt).toContain("visualize_d3");
    // The agent supplies an instruction (intent), not a program.
    expect(prompt).toMatch(/instruction/i);
  });

  // #314 — the gis pack teaches visualize_map + the compute-upstream idiom.
  it("includes visualize_map mapping guidance + the compute-upstream idiom when gis is enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["gis"] })
    );
    expect(prompt).toContain("### Mapping");
    expect(prompt).toContain("visualize_map");
    // Geometry the map needs but the data lacks is derived upstream in SQL.
    expect(prompt).toMatch(/upstream in SQL/i);
    expect(prompt).toContain("ST_MakeLine");
  });

  it("omits the mapping guidance when gis is not enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query"] })
    );
    expect(prompt).not.toContain("### Mapping");
    expect(prompt).not.toContain("visualize_map");
  });

  it("drops the AlaSQL `[bracket]` example query in favour of a double-quoted one", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query", "entity_management"] })
    );
    expect(prompt).not.toContain("FROM [table]");
    expect(prompt).toMatch(/FROM "contacts"/);
  });

  // #97 — capability tags moved out of the static prompt and into
  // the station_context tool's response.
  it("no longer embeds capability tags in the prompt (moved to station_context)", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query", "entity_management"],
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
    const prompt = buildSystemPrompt(makeContext({ effectiveToolPacks: [] }));
    expect(prompt).not.toContain("## Schema Introspection");
    expect(prompt).not.toContain("_meta_entities");
  });

  it("tells the agent to re-introspect after creating an entity mid-session", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query", "entity_management"] })
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
      makeContext({ effectiveToolPacks: ["data_query", "entity_management"] })
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
      makeContext({ effectiveToolPacks: ["data_query"] })
    );
    expect(prompt).not.toContain("### Creating a new entity");
  });

  it("does NOT mention a _meta_connector_instances view (instances are listed statically in the prompt instead)", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query", "entity_management"] })
    );
    expect(prompt).not.toContain("_meta_connector_instances");
  });
});

describe("buildSystemPrompt — Connector Instances pointer (#97)", () => {
  it("mentions the count of attached connector instances + points at station_context", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query", "entity_management"],
        connectorInstances: [
          {
            id: "ci-1",
            name: "Sandbox",
            display: "REST API",
            slug: "rest-api",
          },
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
        effectiveToolPacks: ["data_query", "entity_management"],
        connectorInstances: [
          {
            id: "ci-1",
            name: "Sandbox",
            display: "REST API",
            slug: "rest-api",
          },
        ],
      })
    );
    expect(prompt).toMatch(/Never invent/i);
    expect(prompt).toMatch(/never ask the user/i);
  });

  it("omits the section when entity_management is NOT enabled", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query"],
        connectorInstances: [
          {
            id: "ci-1",
            name: "Sandbox",
            display: "REST API",
            slug: "rest-api",
          },
        ],
      })
    );
    expect(prompt).not.toContain("## Connector Instances");
  });

  it("omits the section when connectorInstances is empty", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query", "entity_management"],
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
    const prompt = buildSystemPrompt(makeContext({ effectiveToolPacks: [] }));
    expect(prompt).toContain("## Current time");
  });
});

// ---------------------------------------------------------------------------
// Capability honesty (#284)
//
// The agent must never claim, offer, or describe a capability its effective
// pack set doesn't include — and re-tiering must change what it claims with
// no prompt edit. That's enforced structurally rather than by review:
// PACK_PROMPT_SECTIONS is exhaustive over the slug union (a new pack is a
// compile error until it declares an entry), and the guard below asserts each
// pack's markers appear IFF the pack is effective.
// ---------------------------------------------------------------------------

const ALL_SLUGS = BuiltinToolpackSlugSchema.options;

describe("buildSystemPrompt — capability surface is entitlement-driven (#284)", () => {
  it.each(ALL_SLUGS)(
    "GUARD: %s's markers appear iff the pack is effective",
    (slug) => {
      const section = PACK_PROMPT_SECTIONS[slug];
      expect(section.markers.length).toBeGreaterThan(0);

      const withPack = buildSystemPrompt(
        makeContext({ effectiveToolPacks: [slug] })
      );
      for (const marker of section.markers) {
        expect(withPack).toContain(marker);
      }

      // Every OTHER pack effective — this pack's markers must be absent.
      const withoutPack = buildSystemPrompt(
        makeContext({
          effectiveToolPacks: ALL_SLUGS.filter((s) => s !== slug),
        })
      );
      for (const marker of section.markers) {
        expect(withoutPack).not.toContain(marker);
      }
    }
  );

  it("capability phrases are pairwise distinct and non-substring", () => {
    // The guard above compares strings, so an overlapping phrase would let
    // one pack satisfy another's marker (or fail it spuriously).
    const phrases = ALL_SLUGS.map((s) => PACK_PROMPT_SECTIONS[s].capability);
    expect(new Set(phrases).size).toBe(phrases.length);
    for (const a of phrases) {
      for (const b of phrases) {
        if (a === b) continue;
        expect(a.includes(b)).toBe(false);
      }
    }
  });

  it("a configured-but-unentitled pack is never OFFERED, only disclaimed", () => {
    // The reported bug, as a test: entity_management configured on a
    // standard-tier station meant the prompt described write tools that
    // buildAnalyticsTools had already stripped from the same session.
    //
    // "Contributes nothing" is too blunt an assertion: the capability MUST be
    // named inside the plan block (naming it as unavailable is the opposite of
    // claiming it — and withholding the name is what made the agent explain a
    // plan limit as a product gap). What must not happen is the pack's
    // guidance rendering, or its capability appearing in the role intro's
    // claim sentence.
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query"],
        unentitledToolPacks: ["entity_management"],
      })
    );

    expect(prompt).not.toContain("## Entity Management Notes");
    expect(prompt).not.toContain("### Creating a new entity");

    const claim = prompt.split("## Current time")[0];
    const capability = PACK_PROMPT_SECTIONS.entity_management.capability;
    expect(claim).not.toContain(capability);

    const planBlock = prompt.slice(
      prompt.indexOf("## Not Included In This Plan")
    );
    expect(planBlock).toContain(capability);
  });

  it("names each unentitled pack's capability, not just its slug", () => {
    // Regression (smoke §7): the block listed bare slugs, so an agent asked to
    // "create an entity" could not map the request onto `entity_management`,
    // fell through to the station-has-no-tool branch, and told the user to do
    // it manually in the UI — the exact framing this ticket removes.
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query"],
        unentitledToolPacks: ["entity_management", "visualize"],
      })
    );

    expect(prompt).toContain(
      `\`entity_management\` — would let you **${PACK_PROMPT_SECTIONS.entity_management.capability}**`
    );
    expect(prompt).toContain(
      `\`visualize\` — would let you **${PACK_PROMPT_SECTIONS.visualize.capability}**`
    );
  });

  it("states the plan as settled fact rather than a hedge", () => {
    // The observed reply hedged — "isn't included in the current plan OR isn't
    // exposed as a tool here", plus "go check if it's available on your plan".
    // The prompt knows why the tool is absent; the agent shouldn't equivocate.
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query"],
        unentitledToolPacks: ["entity_management"],
      })
    );
    expect(prompt).toMatch(/state it as settled fact/i);
    expect(prompt).toMatch(/do not hedge it as one possible explanation/i);
  });

  it("does not forbid pointing the user at the UI, but does forbid 'the product cannot do this'", () => {
    // Toolpack entitlements gate the AGENT's tools, not the product: entity and
    // column creation stay available in the UI on every plan
    // (connector-entity.router.ts has no entitlement gate). Telling the user
    // they can do it themselves is true and useful — an earlier revision of
    // this prompt banned it, which traded a good sentence for a worse answer.
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query"],
        unentitledToolPacks: ["entity_management"],
      })
    );
    expect(prompt).toMatch(/not missing from the product/i);
    expect(prompt).toMatch(/saying so is helpful and welcome/i);
    expect(prompt).not.toMatch(/punt, not an answer/i);
    expect(prompt).not.toMatch(/manually through the UI instead/i);
  });

  it("renders no plan-limit block when nothing is unentitled", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query"] })
    );
    expect(prompt).not.toContain("## Not Included In This Plan");
  });

  it("degrades cleanly with zero effective packs", () => {
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: [], unentitledToolPacks: [] })
    );

    // The pack-independent spine survives…
    expect(prompt).toContain("## Your role: route to a tool");
    expect(prompt).toMatch(/Don't fabricate results/i);
    expect(prompt).toMatch(/If no tool fits/i);
    // …and no capability is claimed.
    for (const slug of ALL_SLUGS) {
      for (const marker of PACK_PROMPT_SECTIONS[slug].markers) {
        expect(prompt).not.toContain(marker);
      }
    }
  });

  it("gives the no-tool-fits guidance all three branches", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query"],
        unentitledToolPacks: ["entity_management"],
      })
    );

    // effective → use it; unentitled → plan limit; neither → station gap.
    expect(prompt).toMatch(/If no tool fits/i);
    expect(prompt).toMatch(/not included in the organization's current plan/i);
    expect(prompt).toMatch(/station (simply )?doesn't have/i);
  });

  it("assembles Response Style's rendered-block list from effective packs only", () => {
    const withCharts = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query", "visualize"] })
    );
    expect(withCharts).toContain("charts");

    const withoutCharts = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query"] })
    );
    expect(withoutCharts).toContain("## Response Style");
    expect(withoutCharts).not.toMatch(/feed of rendered blocks[^.]*charts/);
  });

  it("nests the entity-creation walkthrough under SQL availability", () => {
    // Pre-#284 nesting, preserved: the walkthrough reads the meta-view
    // catalog, which only exists when SQL authoring does.
    const withSql = buildSystemPrompt(
      makeContext({
        effectiveToolPacks: ["data_query", "entity_management"],
      })
    );
    expect(withSql).toContain("### Creating a new entity");

    const withoutSql = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["entity_management"] })
    );
    expect(withoutSql).toContain("## Entity Management Notes");
    expect(withoutSql).not.toContain("### Creating a new entity");
  });

  it("names interpretive-output tools only for effective packs", () => {
    const withStats = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["statistics"] })
    );
    expect(withStats).toContain("hypothesis_test");

    const withoutStats = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["data_query"] })
    );
    expect(withoutStats).not.toContain("hypothesis_test");
  });
});

// ── Organization-provided tools (#306) ────────────────────────────────
//
// Custom toolpacks are attached by `buildAnalyticsTools` exactly like
// built-ins, but they carry no declared `PACK_PROMPT_SECTIONS` entry — so
// before this block the agent held tools it had never been told about and
// denied having them when asked, pointing the user at billing instead.

describe("buildSystemPrompt — organization-provided tools (#306)", () => {
  const smokePack = {
    name: "smoke",
    description: "Internal CRM helpers.",
    toolNames: ["refresh_crm", "sync_all_records"],
  };

  it("names each custom pack and its tools", () => {
    const prompt = buildSystemPrompt(
      makeContext({ customToolPacks: [smokePack] })
    );

    expect(prompt).toContain("Organization-Provided Tools");
    expect(prompt).toContain("smoke");
    expect(prompt).toContain("Internal CRM helpers.");
    expect(prompt).toContain("refresh_crm");
    expect(prompt).toContain("sync_all_records");
  });

  it("renders no such section when there are no custom packs", () => {
    expect(buildSystemPrompt(makeContext())).not.toContain(
      "Organization-Provided Tools"
    );
    expect(
      buildSystemPrompt(makeContext({ customToolPacks: [] }))
    ).not.toContain("Organization-Provided Tools");
  });

  it("tells the agent not to blame the plan for a listed pack", () => {
    // The reported symptom was the agent sending the user to Subscription &
    // Billing for a pack that was registered, entitled, attached, and working.
    const prompt = buildSystemPrompt(
      makeContext({ customToolPacks: [smokePack] })
    );
    expect(prompt).toContain("never attribute its absence to the");
  });

  it("omits a pack with no description cleanly", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        customToolPacks: [
          { name: "bare", description: null, toolNames: ["do_thing"] },
        ],
      })
    );
    expect(prompt).toContain("`bare`");
    expect(prompt).toContain("do_thing");
    expect(prompt).not.toContain("bare — ");
  });
});

describe("buildSystemPrompt — geospatial SQL guidance (#316)", () => {
  it("teaches the ST_* vocabulary when SQL authoring is available", () => {
    const prompt = buildSystemPrompt(makeContext());
    // Present because data_query enables SQL authoring.
    expect(prompt).toContain("Geospatial is PostGIS-native");
    expect(prompt).toContain("ST_Intersects");
    expect(prompt).toContain("ST_DWithin");
    // geography cast for distance/area.
    expect(prompt).toContain("::geography");
    expect(prompt).toContain("ST_Area(geom::geography)");
    // reprojection + point construction.
    expect(prompt).toContain("ST_Transform");
    expect(prompt).toContain("ST_SetSRID(ST_MakePoint(lng, lat), 4326)");
    // compute-upstream construction idioms.
    expect(prompt).toContain("ST_Union");
    expect(prompt).toContain("ST_HexagonGrid");
    expect(prompt).toContain("ST_SimplifyPreserveTopology");
  });

  it("omits geospatial guidance when SQL authoring is unavailable", () => {
    // A pack set with no SQL-authoring tool (no data_query / visualize_d3).
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: ["entity_management"] })
    );
    expect(prompt).not.toContain("Geospatial is PostGIS-native");
  });
});

// ---------------------------------------------------------------------------
// Help section (#367)
// ---------------------------------------------------------------------------

describe("buildSystemPrompt — Help (#367)", () => {
  it("renders the ## Help section", () => {
    expect(buildSystemPrompt(makeContext())).toContain("## Help");
  });

  it("names platform_help as the destination for product questions", () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain("platform_help");
    expect(prompt).toMatch(/product/i);
  });

  it("draws the boundary in both directions", () => {
    // The routing risk this design takes on: without a trigger, the only
    // things separating a product question from a data question are the
    // tool's description and this section. It has to say both halves — where
    // product questions go AND where data questions go — or the agent will
    // reach for help mid-analysis.
    const prompt = buildSystemPrompt(makeContext());
    const help = prompt.slice(prompt.indexOf("## Help"));
    expect(help).toMatch(/data tools|data in this station/i);
  });

  it("tells the agent to relay the tool's answer rather than rewrite it", () => {
    // The tool composes because platform behavior is what a model states
    // confidently and wrongly. The prompt is what keeps the relay honest.
    const help = buildSystemPrompt(makeContext());
    expect(help).toMatch(/relay/i);
    expect(help).toMatch(/do not rewrite|don't rewrite/i);
  });

  it("renders ## Help even when no toolpacks are enabled", () => {
    // A pack-less station is exactly the session where a user needs
    // orientation — and since #367 that session exists instead of erroring.
    const prompt = buildSystemPrompt(
      makeContext({ effectiveToolPacks: [], entities: [] })
    );
    expect(prompt).toContain("## Help");
  });
});
