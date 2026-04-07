import {
  validateEntityStep,
  hasEntityStepErrors,
  validateColumnStep,
  hasColumnStepErrors,
} from "../utils/csv-validation.util";
import type { RecommendedEntity, RecommendedColumn } from "../utils/upload-workflow.util";

// ── Helpers ──────────────────────────────────────────────────────────

function makeColumn(overrides: Partial<RecommendedColumn["recommended"]> & { format?: string | null; enumValues?: string[] | null; normalizedKey?: string } = {}): RecommendedColumn {
  const { format, enumValues, normalizedKey, ...recommendedOverrides } = overrides;
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

  it("returns error when validationPattern is an invalid regex", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn({ validationPattern: "[invalid(" }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[0][0].validationPattern).toBe("Invalid regular expression");
  });

  it("passes when validationPattern is a valid regex", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn({ validationPattern: "^\\d+(\\.\\d{1,2})?$" }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  it("passes when validationPattern is null", () => {
    const errors = validateColumnStep([
      makeEntity("e", "E", [
        makeColumn({ validationPattern: null }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  // ── Cross-entity column definition consistency ──────────────────────

  it("returns error when cross-entity columns share a key but have conflicting type", () => {
    const errors = validateColumnStep([
      makeEntity("contacts", "Contacts", [
        makeColumn({ key: "phone", label: "Phone", type: "string" }),
      ]),
      makeEntity("leads", "Leads", [
        makeColumn({ key: "phone", label: "Phone", type: "number" }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    // Error should be on the second entity's column
    expect(errors[1][0].key).toMatch(/type/);
  });

  it("returns error when cross-entity columns share a key but have conflicting validationPattern", () => {
    const errors = validateColumnStep([
      makeEntity("contacts", "Contacts", [
        makeColumn({ key: "email", label: "Email", type: "string", validationPattern: "^[^@]+@[^@]+$" }),
      ]),
      makeEntity("leads", "Leads", [
        makeColumn({ key: "email", label: "Email", type: "string", validationPattern: "^.+@.+\\..+$" }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[1][0].key).toMatch(/validationPattern/);
  });

  it("returns error when cross-entity columns share a key but have conflicting label", () => {
    const errors = validateColumnStep([
      makeEntity("contacts", "Contacts", [
        makeColumn({ key: "full_name", label: "Full Name", type: "string" }),
      ]),
      makeEntity("leads", "Leads", [
        makeColumn({ key: "full_name", label: "Complete Name", type: "string" }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    expect(errors[1][0].key).toMatch(/label/);
  });

  it("allows cross-entity columns with same key when definitions are identical", () => {
    const errors = validateColumnStep([
      makeEntity("contacts", "Contacts", [
        makeColumn({ key: "email", label: "Email", type: "string", validationPattern: "^[^@]+@[^@]+$", canonicalFormat: "lowercase" }),
      ]),
      makeEntity("leads", "Leads", [
        makeColumn({ key: "email", label: "Email", type: "string", validationPattern: "^[^@]+@[^@]+$", canonicalFormat: "lowercase" }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  it("skips match_existing columns in cross-entity consistency check", () => {
    const errors = validateColumnStep([
      makeEntity("contacts", "Contacts", [
        makeColumn({ key: "phone", label: "Phone", type: "string" }),
      ]),
      makeEntity("leads", "Leads", [
        {
          ...makeColumn({ key: "phone", label: "Phone", type: "number" }),
          action: "match_existing",
          existingColumnDefinitionId: "cd-existing",
        },
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(false);
  });

  it("includes the conflicting entity label and field names in the error message", () => {
    const errors = validateColumnStep([
      makeEntity("contacts", "Contacts", [
        makeColumn({ key: "phone", label: "Phone", type: "string", canonicalFormat: "e164" }),
      ]),
      makeEntity("leads", "Leads", [
        makeColumn({ key: "phone", label: "Phone Number", type: "number", canonicalFormat: null }),
      ]),
    ]);
    expect(errors[1][0].key).toMatch(/Contacts/);
    expect(errors[1][0].key).toMatch(/type/);
    expect(errors[1][0].key).toMatch(/label/);
    expect(errors[1][0].key).toMatch(/canonicalFormat/);
  });

  it("detects conflicts across three entities (error on second and third)", () => {
    const errors = validateColumnStep([
      makeEntity("a", "Entity A", [
        makeColumn({ key: "status", label: "Status", type: "string" }),
      ]),
      makeEntity("b", "Entity B", [
        makeColumn({ key: "status", label: "Status", type: "enum" }),
      ]),
      makeEntity("c", "Entity C", [
        makeColumn({ key: "status", label: "Status", type: "number" }),
      ]),
    ]);
    expect(hasColumnStepErrors(errors)).toBe(true);
    // First entity seen is the baseline — errors on entity B and C
    expect(errors[1][0].key).toMatch(/type/);
    expect(errors[2][0].key).toMatch(/type/);
  });
});
