import {
  validateEntityStep,
  hasEntityStepErrors,
  validateColumnStep,
  hasColumnStepErrors,
} from "../utils/csv-validation.util";
import type { RecommendedEntity, RecommendedColumn } from "../utils/upload-workflow.util";

// ── Helpers ──────────────────────────────────────────────────────────

function makeColumn(overrides: Partial<RecommendedColumn> = {}): RecommendedColumn {
  return {
    confidence: 0.9,
    existingColumnDefinitionId: "cd-text",
    existingColumnDefinitionKey: "text",
    sourceField: "source",
    isPrimaryKeyCandidate: false,
    sampleValues: [],
    normalizedKey: "col_key",
    format: null,
    enumValues: null,
    defaultValue: null,
    ...overrides,
  };
}

function makeEntity(
  key: string,
  label: string,
  columns: RecommendedColumn[] = [makeColumn()]
): RecommendedEntity {
  return {
    connectorEntity: { key, label },
    sourceFileName: `${key}.csv`,
    columns,
  };
}

// ── Entity Step Validation ───────────────────────────────────────────

describe("validateEntityStep", () => {
  it("returns empty object for valid entities", () => {
    const errors = validateEntityStep([makeEntity("users", "Users")]);
    expect(errors).toEqual({});
  });

  it("returns no errors when hasEntityStepErrors is false", () => {
    const errors = validateEntityStep([makeEntity("users", "Users")]);
    expect(hasEntityStepErrors(errors)).toBe(false);
  });

  it("returns error when entity key is empty", () => {
    const errors = validateEntityStep([makeEntity("", "Users")]);
    expect(hasEntityStepErrors(errors)).toBe(true);
    expect(errors[0]).toBeDefined();
    expect(errors[0].key).toBe("Entity key is required");
  });

  it("returns error when entity label is empty", () => {
    const errors = validateEntityStep([makeEntity("users", "")]);
    expect(hasEntityStepErrors(errors)).toBe(true);
    expect(errors[0].label).toBe("Entity label is required");
  });

  it("returns errors for both key and label when both empty", () => {
    const errors = validateEntityStep([makeEntity("", "")]);
    expect(errors[0].key).toBeDefined();
    expect(errors[0].label).toBeDefined();
  });

  it("returns error when key is only whitespace", () => {
    const errors = validateEntityStep([makeEntity("   ", "Users")]);
    expect(hasEntityStepErrors(errors)).toBe(true);
    expect(errors[0].key).toBe("Entity key is required");
  });

  it("validates each entity independently", () => {
    const errors = validateEntityStep([
      makeEntity("valid", "Valid"),
      makeEntity("", "Missing Key"),
    ]);
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBeDefined();
    expect(errors[1].key).toBe("Entity key is required");
  });

  it("returns empty object for empty entities array", () => {
    const errors = validateEntityStep([]);
    expect(errors).toEqual({});
    expect(hasEntityStepErrors(errors)).toBe(false);
  });
});

// ── Column Step Validation ───────────────────────────────────────────

describe("validateColumnStep", () => {
  it("returns empty object for valid columns", () => {
    const errors = validateColumnStep([makeEntity("e", "E", [makeColumn()])]);
    expect(errors).toEqual({});
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  // ── existingColumnDefinitionId validation ──────────────────────────

  it("returns error when existingColumnDefinitionId is empty string", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ existingColumnDefinitionId: "" })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][0].existingColumnDefinitionId).toBe("Column definition must be selected");
  });

  it("passes when existingColumnDefinitionId is a valid string", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ existingColumnDefinitionId: "cd-email" })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  // ── normalizedKey validation ──────────────────────────────────────

  it("returns error when normalizedKey is missing", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ normalizedKey: undefined })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][0].normalizedKey).toBe("Normalized key is required");
  });

  it("returns error when normalizedKey has uppercase letters", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ normalizedKey: "MyColumn" })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][0].normalizedKey).toBe("Normalized key must be lowercase snake_case");
  });

  it("returns error when normalizedKey has special chars", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ normalizedKey: "my-column" })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][0].normalizedKey).toBe("Normalized key must be lowercase snake_case");
  });

  it("passes when normalizedKey is valid snake_case", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ normalizedKey: "my_column_2" })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  // ── normalizedKey uniqueness ──────────────────────────────────────

  it("flags duplicate normalizedKey within same entity", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn({ normalizedKey: "email", sourceField: "Email" }),
        makeColumn({ normalizedKey: "email", sourceField: "Contact Email" }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][1].normalizedKey).toMatch(/Duplicate/);
  });

  it("allows duplicate normalizedKey across different entities", () => {
    const errors = validateColumnStep([
      makeEntity("a", "A", [makeColumn({ normalizedKey: "email" })]),
      makeEntity("b", "B", [makeColumn({ normalizedKey: "email" })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  // ── Multiple columns and entities ─────────────────────────────────

  it("validates columns across multiple entities independently", () => {
    const errors = validateColumnStep([
      makeEntity("a", "A", [makeColumn()]),
      makeEntity("b", "B", [makeColumn({ existingColumnDefinitionId: "" })]),
    ]);
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBeDefined();
    expect(errors[1][0].existingColumnDefinitionId).toBe("Column definition must be selected");
  });

  it("validates multiple columns within the same entity", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn(),
        makeColumn({ normalizedKey: undefined }),
      ]),
    ]);
    expect(errors[0][0]).toBeUndefined();
    expect(errors[0][1].normalizedKey).toBe("Normalized key is required");
  });
});
