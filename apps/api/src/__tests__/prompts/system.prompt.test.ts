import { describe, it, expect } from "@jest/globals";
import { buildSystemPrompt, type StationContext } from "../../prompts/system.prompt.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<StationContext> = {}): StationContext {
  return {
    stationId: "station-1",
    stationName: "Test Station",
    entities: [
      {
        id: "entity-1",
        key: "contacts",
        label: "Contacts",
        connectorInstanceId: "ci-1",
        columns: [
          { key: "name", type: "text", label: "Name", columnDefinitionId: "cd-1", fieldMappingId: "fm-1", sourceField: "Full Name" },
          { key: "email", type: "text", label: "Email", columnDefinitionId: "cd-2", fieldMappingId: "fm-2", sourceField: "Email Address" },
        ],
      },
      {
        id: "entity-2",
        key: "orders",
        label: "Orders",
        connectorInstanceId: "ci-1",
        columns: [
          { key: "total", type: "number", label: "Total", columnDefinitionId: "cd-3", fieldMappingId: "fm-3", sourceField: "Order Total" },
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
          "entity-1": { read: true, write: true },
          "entity-2": { read: true, write: true },
        },
      }),
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
          "entity-1": { read: true, write: false },
          "entity-2": { read: true, write: true },
        },
      }),
    );

    expect(prompt).toContain("Contacts (`contacts`) [connectorEntityId: entity-1] [read]");
    expect(prompt).toContain("Orders (`orders`) [connectorEntityId: entity-2] [read, write]");
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
      makeContext({ toolPacks: ["entity_management"] }),
    );

    expect(prompt).toContain("[connectorEntityId: entity-1]");
    expect(prompt).toContain("[connectorEntityId: entity-2]");
  });

  it("renders columnDefinitionId, fieldMappingId, sourceField per column", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] }),
    );

    expect(prompt).toContain("[columnDefinitionId: cd-1, fieldMappingId: fm-1, sourceField: \"Full Name\"]");
    expect(prompt).toContain("[columnDefinitionId: cd-3, fieldMappingId: fm-3, sourceField: \"Order Total\"]");
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
      makeContext({ toolPacks: ["data_query", "entity_management"] }),
    );

    expect(prompt).toContain("## Entity Management Notes");
    expect(prompt).toContain("origin");
    expect(prompt).toContain("_connector_instances");
    expect(prompt).toContain("_connector_entities");
    expect(prompt).toContain("_column_definitions");
    expect(prompt).toContain("_field_mappings");
    expect(prompt).toContain("field_mapping_create");
  });

  it("documents normalizedKey concept", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] }),
    );

    expect(prompt).toContain("normalizedKey");
    expect(prompt).toContain("normalizedData");
  });

  it("documents validationPattern and canonicalFormat on column definitions", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] }),
    );

    expect(prompt).toContain("validationPattern");
    expect(prompt).toContain("canonicalFormat");
    expect(prompt).toContain("validation_pattern");
    expect(prompt).toContain("canonical_format");
  });

  it("documents field mapping attributes: required, defaultValue, format, enumValues", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] }),
    );

    expect(prompt).toContain("normalized_key");
    expect(prompt).toContain("default_value");
    expect(prompt).toContain("enum_values");
    expect(prompt).toMatch(/field mappings define per-source attributes/i);
  });

  it("does not reference currency type", () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["entity_management"] }),
    );

    expect(prompt).toContain("no `currency` type");
    expect(prompt).not.toMatch(/\btype.*currency\b(?!.*no)/);
  });

  it('omits "Entity Management Notes" when entity_management not in toolPacks', () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query"] }),
    );

    expect(prompt).not.toContain("Entity Management Notes");
  });
});
