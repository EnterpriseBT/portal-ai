/**
 * #644: the SQL row-filter suggester. Pins what the model is told (the
 * rules, the column keys and types, JSON key names, a revision's reason) and
 * that nothing but those reaches it, plus the model wiring and failure shape.
 */
import { describe, it, expect, jest } from "@jest/globals";

import {
  buildFilterSqlSuggestPrompt,
  createDefaultFilterSqlSuggester,
  FilterSqlSuggestError,
  type FilterSqlSuggesterInput,
} from "../../services/curated-view-filter-suggest.haiku.js";

const input: FilterSqlSuggesterInput = {
  prompt: "active parcels within a mile of the office",
  columns: [
    { key: "name", type: "string" },
    { key: "location", type: "geometry" },
    { key: "payload", type: "json", jsonKeys: ["status", "owner"] },
  ],
};

const silentLogger = {
  info: jest.fn(),
  warn: jest.fn(),
} as never;

describe("buildFilterSqlSuggestPrompt (#644)", () => {
  it("lists each column's key and type, and a JSON column's key names", () => {
    const prompt = buildFilterSqlSuggestPrompt(input);
    expect(prompt).toContain("- name: string");
    expect(prompt).toContain("- location: geometry");
    expect(prompt).toContain("- payload: json (top-level keys: status, owner)");
    expect(prompt).toContain("active parcels within a mile of the office");
  });

  it("states the rules the validator enforces, and the indexable spatial form", () => {
    const prompt = buildFilterSqlSuggestPrompt(input);
    expect(prompt).toMatch(/No subqueries, no other tables/);
    expect(prompt).toMatch(/ST_DWithin\(column, ST_SetSRID/);
  });

  it("carries the current filter and a refused attempt's reason", () => {
    const prompt = buildFilterSqlSuggestPrompt({
      ...input,
      currentSql: "name = 'x'",
      previousAttempt: {
        filterSql: "salary > 1",
        error: "unknown column: salary",
      },
    });
    expect(prompt).toContain("name = 'x'");
    expect(prompt).toContain("salary > 1");
    expect(prompt).toContain("Reason: unknown column: salary");
  });
});

describe("createDefaultFilterSqlSuggester (#644)", () => {
  it("calls the configured model and returns the trimmed filter", async () => {
    const anthropic = jest.fn((id: string) => ({ id }));
    const generateObject = jest.fn(async (_args: unknown) => ({
      object: { filterSql: "  payload->>'status' = 'active'\n" },
    }));
    const suggester = createDefaultFilterSqlSuggester({
      anthropic,
      generateObject: generateObject as never,
      logger: silentLogger,
    });

    await expect(suggester.suggest(input)).resolves.toEqual({
      filterSql: "payload->>'status' = 'active'",
    });
    expect(anthropic).toHaveBeenCalledWith("claude-haiku-4-5-20251001");
    const args = generateObject.mock.calls[0]![0] as { prompt: string };
    expect(args.prompt).toBe(buildFilterSqlSuggestPrompt(input));
  });

  it("refuses a response without a filter", async () => {
    const suggester = createDefaultFilterSqlSuggester({
      anthropic: () => ({}),
      generateObject: (async () => ({ object: { sql: "x" } })) as never,
      logger: silentLogger,
    });
    await expect(suggester.suggest(input)).rejects.toMatchObject({
      name: "FilterSqlSuggestError",
      reason: "malformed-response",
    });
  });

  it("wraps a failed model call", async () => {
    const suggester = createDefaultFilterSqlSuggester({
      anthropic: () => ({}),
      generateObject: (async () => {
        throw new Error("upstream 529");
      }) as never,
      logger: silentLogger,
    });
    const err = await suggester.suggest(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FilterSqlSuggestError);
    expect((err as FilterSqlSuggestError).reason).toBe("network-error");
  });
});
