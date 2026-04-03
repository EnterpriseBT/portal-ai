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
          { key: "name", type: "text", label: "Name" },
          { key: "email", type: "text", label: "Email" },
        ],
      },
      {
        id: "entity-2",
        key: "orders",
        label: "Orders",
        connectorInstanceId: "ci-1",
        columns: [
          { key: "total", type: "number", label: "Total" },
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

    expect(prompt).toContain("### Contacts (`contacts`) [read, write]");
    expect(prompt).toContain("### Orders (`orders`) [read, write]");
  });

  it("renders [read] for read-only entities", () => {
    const prompt = buildSystemPrompt(
      makeContext({
        entityCapabilities: {
          "entity-1": { read: true, write: false },
          "entity-2": { read: true, write: true },
        },
      }),
    );

    expect(prompt).toContain("### Contacts (`contacts`) [read]");
    expect(prompt).toContain("### Orders (`orders`) [read, write]");
  });

  it("omits flags when entityCapabilities is undefined", () => {
    const prompt = buildSystemPrompt(makeContext());

    expect(prompt).toContain("### Contacts (`contacts`)");
    expect(prompt).not.toContain("[read");
  });
});

describe("buildSystemPrompt — entity management notes", () => {
  it('includes "Entity Management Notes" section when entity_management in toolPacks', () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query", "entity_management"] }),
    );

    expect(prompt).toContain("## Entity Management Notes");
    expect(prompt).toContain("origin");
  });

  it('omits "Entity Management Notes" when entity_management not in toolPacks', () => {
    const prompt = buildSystemPrompt(
      makeContext({ toolPacks: ["data_query"] }),
    );

    expect(prompt).not.toContain("Entity Management Notes");
  });
});
