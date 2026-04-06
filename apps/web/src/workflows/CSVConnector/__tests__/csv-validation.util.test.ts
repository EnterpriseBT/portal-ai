import {
  validateEntityStep,
  hasEntityStepErrors,
  validateColumnStep,
  hasColumnStepErrors,
} from "../utils/csv-validation.util";
import type { RecommendedEntity, RecommendedColumn } from "../utils/upload-workflow.util";

// ── Helpers ──────────────────────────────────────────────────────────

function makeColumn(overrides: Partial<RecommendedColumn["recommended"]> & { format?: string | null; enumValues?: string[] | null } = {}): RecommendedColumn {
  const { format, enumValues, ...recommendedOverrides } = overrides;
  return {
    action: "create_new",
    confidence: 0.9,
    existingColumnDefinitionId: null,
    recommended: {
      key: "col_key",
      label: "Col Label",
      type: "string",
      description: null,
      ...recommendedOverrides,
    },
    sourceField: "source",
    isPrimaryKeyCandidate: false,
    sampleValues: [],
    format: format ?? null,
    enumValues: enumValues ?? null,
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

  it("returns error when column key is empty", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ key: "" })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][0].key).toBe("Column key is required");
  });

  it("returns error when column label is empty", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ label: "" })]),
    ]);
    expect(errors[0][0].label).toBe("Column label is required");
  });

  it("returns error when column type is empty", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ type: "" })]),
    ]);
    expect(errors[0][0].type).toBe("Column type is required");
  });

  it("does not require refEntityKey for non-reference types", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ type: "number" })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  it("returns error when reference type is missing refEntityKey", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn({
          type: "reference",
          refEntityKey: null,
          refColumnKey: null,
        }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][0].refEntityKey).toBe("Reference entity is required");
  });

  it("returns error when reference-array type is missing refEntityKey", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn({
          type: "reference-array",
          refEntityKey: null,
          refColumnKey: null,
        }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][0].refEntityKey).toBe("Reference entity is required");
  });

  it("returns error when reference has entity but no column", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn({
          type: "reference",
          refEntityKey: "other",
          refColumnKey: null,
          refColumnDefinitionId: null,
        }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][0].refColumnKey).toBe("Reference column is required");
  });

  it("passes when reference has entity and refColumnKey", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn({
          type: "reference",
          refEntityKey: "other",
          refColumnKey: "id",
          refColumnDefinitionId: null,
        }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  it("passes when reference has entity and refColumnDefinitionId", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn({
          type: "reference",
          refEntityKey: "other",
          refColumnKey: null,
          refColumnDefinitionId: "cd_001",
        }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  it("does not require format for any type", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ type: "date", format: null })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  it("does not require enumValues for enum type", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [makeColumn({ type: "enum", enumValues: null })]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  it("validates columns across multiple entities independently", () => {
    const errors = validateColumnStep([
      makeEntity("a", "A", [makeColumn()]),
      makeEntity("b", "B", [makeColumn({ key: "" })]),
    ]);
    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toBeDefined();
    expect(errors[1][0].key).toBe("Column key is required");
  });

  it("validates multiple columns within the same entity", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn(),
        makeColumn({ label: "" }),
      ]),
    ]);
    expect(errors[0][0]).toBeUndefined();
    expect(errors[0][1].label).toBe("Column label is required");
  });
});
