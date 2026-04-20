import { describe, it, expect } from "@jest/globals";

import {
  FileUploadRecommendationEntitySchema,
  type FileParseResult,
  type ColumnStat,
} from "@portalai/core/models";
import type { ExistingColumnDefinition } from "../../services/file-analysis.service.js";

import {
  inferType,
  detectValidationPattern,
  toSnakeCase,
  heuristicAnalyze,
} from "../../utils/heuristic-analyzer.util.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColumnStat(
  overrides: Partial<ColumnStat> & { name: string }
): ColumnStat {
  return {
    nullCount: 0,
    totalCount: 10,
    nullRate: 0,
    uniqueCount: 10,
    uniqueCapped: false,
    minLength: 3,
    maxLength: 20,
    sampleValues: ["sample1", "sample2", "sample3"],
    ...overrides,
  };
}

function makeParseResult(
  overrides: Partial<FileParseResult> = {}
): FileParseResult {
  return {
    fileName: "contacts.csv",
    delimiter: ",",
    hasHeader: true,
    encoding: "UTF-8",
    rowCount: 100,
    headers: ["name", "email", "age"],
    sampleRows: [
      ["Alice", "alice@test.com", "30"],
      ["Bob", "bob@test.com", "25"],
    ],
    columnStats: [
      makeColumnStat({ name: "name", sampleValues: ["Alice", "Bob", "Carol"] }),
      makeColumnStat({
        name: "email",
        sampleValues: ["alice@test.com", "bob@test.com", "carol@test.com"],
      }),
      makeColumnStat({ name: "age", sampleValues: ["30", "25", "35"] }),
    ],
    ...overrides,
  };
}

/** Standard seed column definitions covering all types. */
function makeSeedColumns(): ExistingColumnDefinition[] {
  return [
    {
      id: "cd-uuid",
      key: "uuid",
      label: "UUID",
      type: "string",
      description: "Universally unique identifier",
      validationPattern: null,
      canonicalFormat: "lowercase",
    },
    {
      id: "cd-string_id",
      key: "string_id",
      label: "String ID",
      type: "string",
      description: "String identifier",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-number_id",
      key: "number_id",
      label: "Number ID",
      type: "number",
      description: "Numeric identifier",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-email",
      key: "email",
      label: "Email",
      type: "string",
      description: "Email address",
      validationPattern: null,
      canonicalFormat: "lowercase",
    },
    {
      id: "cd-phone",
      key: "phone",
      label: "Phone",
      type: "string",
      description: "Phone number",
      validationPattern: null,
      canonicalFormat: "phone",
    },
    {
      id: "cd-url",
      key: "url",
      label: "Website",
      type: "string",
      description: "Website URL",
      validationPattern: null,
      canonicalFormat: "lowercase",
    },
    {
      id: "cd-name",
      key: "name",
      label: "Name",
      type: "string",
      description: "Person or entity name",
      validationPattern: null,
      canonicalFormat: "trim",
    },
    {
      id: "cd-description",
      key: "description",
      label: "Description",
      type: "string",
      description: "Description text",
      validationPattern: null,
      canonicalFormat: "trim",
    },
    {
      id: "cd-text",
      key: "text",
      label: "Text",
      type: "string",
      description: "General-purpose text content",
      validationPattern: null,
      canonicalFormat: "trim",
    },
    {
      id: "cd-code",
      key: "code",
      label: "Code",
      type: "string",
      description: "Code value",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-address",
      key: "address",
      label: "Address",
      type: "string",
      description: "Physical address",
      validationPattern: null,
      canonicalFormat: "trim",
    },
    {
      id: "cd-status",
      key: "status",
      label: "Status",
      type: "string",
      description: "Status value",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-tag",
      key: "tag",
      label: "Tag",
      type: "string",
      description: "Tag label",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-integer",
      key: "integer",
      label: "Integer",
      type: "number",
      description: "Whole number",
      validationPattern: null,
      canonicalFormat: "#,##0",
    },
    {
      id: "cd-decimal",
      key: "decimal",
      label: "Decimal",
      type: "number",
      description: "Decimal number",
      validationPattern: null,
      canonicalFormat: "#,##0.00",
    },
    {
      id: "cd-percentage",
      key: "percentage",
      label: "Percentage",
      type: "number",
      description: "Percentage value",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-currency",
      key: "currency",
      label: "Currency",
      type: "number",
      description: "Currency amount",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-quantity",
      key: "quantity",
      label: "Quantity",
      type: "number",
      description: "Quantity count",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-boolean",
      key: "boolean",
      label: "Boolean",
      type: "boolean",
      description: "True or false",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-date",
      key: "date",
      label: "Date",
      type: "date",
      description: "Calendar date",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-datetime",
      key: "datetime",
      label: "Date & Time",
      type: "datetime",
      description: "Date and time",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-enum",
      key: "enum",
      label: "Enum",
      type: "enum",
      description: "Enumerated value",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-json_data",
      key: "json_data",
      label: "JSON Data",
      type: "json",
      description: "JSON data",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-array",
      key: "array",
      label: "Array",
      type: "array",
      description: "Array value",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-reference",
      key: "reference",
      label: "Reference",
      type: "reference",
      description: "Reference link",
      validationPattern: null,
      canonicalFormat: null,
    },
    {
      id: "cd-reference_array",
      key: "reference_array",
      label: "Reference Array",
      type: "reference-array",
      description: "Reference array",
      validationPattern: null,
      canonicalFormat: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// inferType
// ---------------------------------------------------------------------------

describe("inferType", () => {
  it("returns string for empty sample values", () => {
    expect(inferType([])).toEqual({
      type: "string",
      format: null,
      canonicalFormat: null,
    });
  });

  it("returns string for whitespace-only values", () => {
    expect(inferType(["  ", " "])).toEqual({
      type: "string",
      format: null,
      canonicalFormat: null,
    });
  });

  it("detects date (YYYY-MM-DD)", () => {
    expect(inferType(["2024-01-15", "2024-02-20"])).toEqual({
      type: "date",
      format: "YYYY-MM-DD",
      canonicalFormat: "YYYY-MM-DD",
    });
  });

  it("detects date (DD/MM/YYYY)", () => {
    expect(inferType(["15/01/2024", "20/02/2024"])).toEqual({
      type: "date",
      format: "YYYY-MM-DD",
      canonicalFormat: "YYYY-MM-DD",
    });
  });

  it("detects date (DD-MM-YYYY)", () => {
    expect(inferType(["15-01-2024", "20-02-2024"])).toEqual({
      type: "date",
      format: "YYYY-MM-DD",
      canonicalFormat: "YYYY-MM-DD",
    });
  });

  it("detects datetime (ISO 8601 with T)", () => {
    expect(inferType(["2024-01-15T10:30:00Z", "2024-02-20T14:00:00Z"])).toEqual(
      { type: "datetime", format: "ISO8601", canonicalFormat: "ISO8601" }
    );
  });

  it("detects datetime (space-separated)", () => {
    expect(inferType(["2024-01-15 10:30:00", "2024-02-20 14:00:00"])).toEqual({
      type: "datetime",
      format: "ISO8601",
      canonicalFormat: "ISO8601",
    });
  });

  it("detects number (integers)", () => {
    expect(inferType(["1", "42", "100"])).toEqual({
      type: "number",
      format: null,
      canonicalFormat: null,
    });
  });

  it("detects number (decimals)", () => {
    expect(inferType(["9.99", "14.50", "100.00"])).toEqual({
      type: "number",
      format: null,
      canonicalFormat: null,
    });
  });

  it("detects number (negative)", () => {
    expect(inferType(["-5", "-3.14", "0"])).toEqual({
      type: "number",
      format: null,
      canonicalFormat: null,
    });
  });

  it("detects number (comma-separated thousands)", () => {
    expect(inferType(["1,000", "10,000", "100,000"])).toEqual({
      type: "number",
      format: null,
      canonicalFormat: null,
    });
  });

  it("detects boolean (true/false)", () => {
    expect(inferType(["true", "false", "true"])).toEqual({
      type: "boolean",
      format: null,
      canonicalFormat: null,
    });
  });

  it("detects boolean (yes/no)", () => {
    expect(inferType(["yes", "no", "YES"])).toEqual({
      type: "boolean",
      format: null,
      canonicalFormat: null,
    });
  });

  it("detects boolean (0/1)", () => {
    expect(inferType(["0", "1", "1", "0"])).toEqual({
      type: "boolean",
      format: null,
      canonicalFormat: null,
    });
  });

  it("detects email", () => {
    expect(inferType(["alice@test.com", "bob@example.org"])).toEqual({
      type: "string",
      format: "email",
      canonicalFormat: "lowercase",
    });
  });

  it("returns string for mixed types", () => {
    expect(inferType(["hello", "42", "true"])).toEqual({
      type: "string",
      format: null,
      canonicalFormat: null,
    });
  });

  it("returns string for plain text", () => {
    expect(inferType(["Alice", "Bob", "Carol"])).toEqual({
      type: "string",
      format: null,
      canonicalFormat: null,
    });
  });

  it("prefers datetime over date when timestamps present", () => {
    expect(inferType(["2024-01-15T10:30:00Z"]).type).toBe("datetime");
  });
});

// ---------------------------------------------------------------------------
// toSnakeCase
// ---------------------------------------------------------------------------

describe("toSnakeCase", () => {
  it("converts camelCase", () => {
    expect(toSnakeCase("firstName")).toBe("first_name");
  });

  it("converts PascalCase", () => {
    expect(toSnakeCase("FirstName")).toBe("first_name");
  });

  it("converts spaces", () => {
    expect(toSnakeCase("First Name")).toBe("first_name");
  });

  it("converts hyphens", () => {
    expect(toSnakeCase("first-name")).toBe("first_name");
  });

  it("converts dots", () => {
    expect(toSnakeCase("first.name")).toBe("first_name");
  });

  it("strips special characters", () => {
    expect(toSnakeCase("first@name!")).toBe("firstname");
  });

  it("collapses multiple underscores", () => {
    expect(toSnakeCase("first__name")).toBe("first_name");
  });

  it("strips leading/trailing underscores", () => {
    expect(toSnakeCase("_first_name_")).toBe("first_name");
  });

  it("lowercases everything", () => {
    expect(toSnakeCase("FIRST_NAME")).toBe("first_name");
  });

  it("returns 'column' for empty string", () => {
    expect(toSnakeCase("")).toBe("column");
  });

  it("returns 'column' for only special characters", () => {
    expect(toSnakeCase("@#$")).toBe("column");
  });
});

// ---------------------------------------------------------------------------
// detectValidationPattern
// ---------------------------------------------------------------------------

describe("detectValidationPattern", () => {
  it("detects email pattern", () => {
    expect(detectValidationPattern(["a@b.com", "c@d.org"])).toBe(
      "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
    );
  });

  it("detects URL pattern", () => {
    expect(
      detectValidationPattern(["https://example.com", "http://foo.org"])
    ).toBe("^https?://[^\\s]+$");
  });

  it("detects UUID pattern", () => {
    expect(
      detectValidationPattern([
        "550e8400-e29b-41d4-a716-446655440000",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      ])
    ).toBe("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
  });

  it("returns null for plain text", () => {
    expect(detectValidationPattern(["Alice", "Bob"])).toBeNull();
  });

  it("returns null for empty values", () => {
    expect(detectValidationPattern([])).toBeNull();
  });

  it("returns null for mixed patterns", () => {
    expect(detectValidationPattern(["a@b.com", "not-an-email"])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// heuristicAnalyze — core behavior
// ---------------------------------------------------------------------------

describe("heuristicAnalyze", () => {
  const seedColumns = makeSeedColumns();

  it("returns valid FileUploadRecommendationEntitySchema output", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult(),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    const validated = FileUploadRecommendationEntitySchema.safeParse(result);
    expect(validated.success).toBe(true);
  });

  it("produces one column per columnStat", () => {
    const parseResult = makeParseResult();
    const result = heuristicAnalyze({
      parseResult,
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns).toHaveLength(parseResult.columnStats.length);
  });

  it("derives entity key from file name", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({ fileName: "User Profiles.csv" }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.entityKey).toBe("user_profiles");
    expect(result.entityLabel).toBe("User Profiles");
    expect(result.sourceFileName).toBe("User Profiles.csv");
  });

  it("every column has an existingColumnDefinitionId (required string)", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({
            name: "email",
            sampleValues: ["a@b.com", "c@d.org"],
          }),
          makeColumnStat({ name: "age", sampleValues: ["30", "25"] }),
          makeColumnStat({ name: "active", sampleValues: ["true", "false"] }),
          makeColumnStat({
            name: "created",
            sampleValues: ["2024-01-15", "2024-02-20"],
          }),
          makeColumnStat({ name: "zzz_unknown", sampleValues: ["foo", "bar"] }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    for (const col of result.columns) {
      expect(typeof col.existingColumnDefinitionId).toBe("string");
      expect(col.existingColumnDefinitionId.length).toBeGreaterThan(0);
    }
  });

  it("no recommendation returns action field (field removed)", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [makeColumnStat({ name: "zzz" })],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0]).not.toHaveProperty("action");
  });

  it("normalizedKey is derived from source field via toSnakeCase", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({ name: "First Name", sampleValues: ["Alice"] }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].normalizedKey).toBe("first_name");
  });
});

// ---------------------------------------------------------------------------
// heuristicAnalyze — XLSX sheet naming
// ---------------------------------------------------------------------------

describe("heuristicAnalyze — XLSX sheet naming", () => {
  const seedColumns = makeSeedColumns();

  it("derives entityKey from sheet name when fileName carries a [Sheet] suffix", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({ fileName: "workbook.xlsx[Contacts]" }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });
    expect(result.entityKey).toBe("contacts");
    expect(result.entityLabel).toBe("Contacts");
  });

  it("preserves full bracketed string in sourceFileName", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({ fileName: "workbook.xlsx[Contacts]" }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });
    expect(result.sourceFileName).toBe("workbook.xlsx[Contacts]");
  });

  it("snake-cases multi-word sheet names", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({ fileName: "crm.xlsx[Deal History]" }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });
    expect(result.entityKey).toBe("deal_history");
    expect(result.entityLabel).toBe("Deal History");
  });

  it("falls back to filename derivation for plain CSV (no brackets)", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({ fileName: "User Profiles.csv" }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });
    expect(result.entityKey).toBe("user_profiles");
    expect(result.entityLabel).toBe("User Profiles");
  });

  it("derives distinct entity keys for two sheets from the same workbook", () => {
    const a = heuristicAnalyze({
      parseResult: makeParseResult({ fileName: "data.xlsx[Contacts]" }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });
    const b = heuristicAnalyze({
      parseResult: makeParseResult({ fileName: "data.xlsx[Deals]" }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });
    expect(a.entityKey).not.toBe(b.entityKey);
    expect(a.entityKey).toBe("contacts");
    expect(b.entityKey).toBe("deals");
  });
});

// ---------------------------------------------------------------------------
// heuristicAnalyze — exact matching
// ---------------------------------------------------------------------------

describe("heuristicAnalyze — exact matching", () => {
  const seedColumns = makeSeedColumns();

  it("exact key match has confidence 1.0", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["a@b.com"] }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-email");
    expect(result.columns[0].confidence).toBe(1);
  });

  it("exact label match (case-insensitive) has confidence 1.0", () => {
    const existing: ExistingColumnDefinition[] = [
      {
        id: "col-2",
        key: "user_email",
        label: "Email",
        type: "string",
        description: "User email",
        validationPattern: null,
        canonicalFormat: "lowercase",
      },
    ];
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({ name: "Email", sampleValues: ["a@b.com"] }),
        ],
      }),
      existingColumns: existing,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("col-2");
    expect(result.columns[0].confidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// heuristicAnalyze — pattern-based matching
// ---------------------------------------------------------------------------

describe("heuristicAnalyze — pattern-based matching", () => {
  const seedColumns = makeSeedColumns();

  it("email-pattern samples match the email column definition", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({
            name: "contact_email",
            sampleValues: ["a@b.com", "c@d.org"],
          }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-email");
    expect(result.columns[0].confidence).toBe(0.9);
  });

  it("UUID-pattern samples match the uuid column definition", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({
            name: "record_id",
            sampleValues: [
              "550e8400-e29b-41d4-a716-446655440000",
              "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
            ],
          }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-uuid");
    expect(result.columns[0].confidence).toBe(0.9);
  });

  it("URL-pattern samples match the url column definition", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({
            name: "homepage_link",
            sampleValues: ["https://example.com", "http://foo.org"],
          }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-url");
    expect(result.columns[0].confidence).toBe(0.9);
  });
});

// ---------------------------------------------------------------------------
// heuristicAnalyze — type-based fallback matching
// ---------------------------------------------------------------------------

describe("heuristicAnalyze — type-based fallback matching", () => {
  const seedColumns = makeSeedColumns();

  it("numeric samples with decimals match decimal definition", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({ name: "price", sampleValues: ["9.99", "14.50"] }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-decimal");
    expect(result.columns[0].confidence).toBe(0.5);
  });

  it("numeric samples without decimals match integer definition", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({ name: "count", sampleValues: ["1", "42", "100"] }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-integer");
    expect(result.columns[0].confidence).toBe(0.5);
  });

  it("date samples match date definition", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({
            name: "created_at",
            sampleValues: ["2024-01-15", "2024-02-20"],
          }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-date");
    expect(result.columns[0].confidence).toBe(0.5);
  });

  it("datetime samples match datetime definition", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({
            name: "updated_at",
            sampleValues: ["2024-01-15T10:30:00Z"],
          }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-datetime");
    expect(result.columns[0].confidence).toBe(0.5);
  });

  it("boolean samples match boolean definition", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({
            name: "is_active",
            sampleValues: ["true", "false"],
          }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-boolean");
    expect(result.columns[0].confidence).toBe(0.5);
  });

  it("generic string samples fall back to text definition", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({
            name: "notes",
            sampleValues: ["foo bar", "baz qux"],
          }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-text");
    expect(result.columns[0].confidence).toBe(0.5);
  });

  it("sets required=true when nullRate is 0", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({ name: "id", nullRate: 0 }),
          makeColumnStat({ name: "notes", nullRate: 0.5, nullCount: 5 }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].required).toBe(true);
    expect(result.columns[1].required).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// heuristicAnalyze — confidence priority
// ---------------------------------------------------------------------------

describe("heuristicAnalyze — confidence priority", () => {
  const seedColumns = makeSeedColumns();

  it("exact match (1.0) takes priority over pattern match (0.9)", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        // "email" is both an exact key match AND an email-pattern match
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["a@b.com"] }),
        ],
      }),
      existingColumns: seedColumns,
      priorRecommendations: [],
    });

    expect(result.columns[0].confidence).toBe(1);
    expect(result.columns[0].existingColumnDefinitionId).toBe("cd-email");
  });
});
