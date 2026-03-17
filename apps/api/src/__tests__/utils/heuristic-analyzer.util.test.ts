import { describe, it, expect } from "@jest/globals";

import {
  FileUploadRecommendationEntitySchema,
  type FileParseResult,
  type ColumnStat,
} from "@portalai/core/models";
import type { ExistingColumnDefinition } from "../../services/file-analysis.service.js";

import {
  inferType,
  toSnakeCase,
  heuristicAnalyze,
} from "../../utils/heuristic-analyzer.util.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColumnStat(overrides: Partial<ColumnStat> & { name: string }): ColumnStat {
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

function makeParseResult(overrides: Partial<FileParseResult> = {}): FileParseResult {
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
      makeColumnStat({ name: "email", sampleValues: ["alice@test.com", "bob@test.com", "carol@test.com"] }),
      makeColumnStat({ name: "age", sampleValues: ["30", "25", "35"] }),
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// inferType
// ---------------------------------------------------------------------------

describe("inferType", () => {
  it("returns string for empty sample values", () => {
    expect(inferType([])).toEqual({ type: "string", format: null });
  });

  it("returns string for whitespace-only values", () => {
    expect(inferType(["  ", " "])).toEqual({ type: "string", format: null });
  });

  it("detects date (YYYY-MM-DD)", () => {
    expect(inferType(["2024-01-15", "2024-02-20"])).toEqual({ type: "date", format: "YYYY-MM-DD" });
  });

  it("detects date (DD/MM/YYYY)", () => {
    expect(inferType(["15/01/2024", "20/02/2024"])).toEqual({ type: "date", format: "YYYY-MM-DD" });
  });

  it("detects date (DD-MM-YYYY)", () => {
    expect(inferType(["15-01-2024", "20-02-2024"])).toEqual({ type: "date", format: "YYYY-MM-DD" });
  });

  it("detects datetime (ISO 8601 with T)", () => {
    expect(inferType(["2024-01-15T10:30:00Z", "2024-02-20T14:00:00Z"])).toEqual({ type: "datetime", format: "ISO8601" });
  });

  it("detects datetime (space-separated)", () => {
    expect(inferType(["2024-01-15 10:30:00", "2024-02-20 14:00:00"])).toEqual({ type: "datetime", format: "ISO8601" });
  });

  it("detects number (integers)", () => {
    expect(inferType(["1", "42", "100"])).toEqual({ type: "number", format: null });
  });

  it("detects number (decimals)", () => {
    expect(inferType(["9.99", "14.50", "100.00"])).toEqual({ type: "number", format: null });
  });

  it("detects number (negative)", () => {
    expect(inferType(["-5", "-3.14", "0"])).toEqual({ type: "number", format: null });
  });

  it("detects number (comma-separated thousands)", () => {
    expect(inferType(["1,000", "10,000", "100,000"])).toEqual({ type: "number", format: null });
  });

  it("detects boolean (true/false)", () => {
    expect(inferType(["true", "false", "true"])).toEqual({ type: "boolean", format: null });
  });

  it("detects boolean (yes/no)", () => {
    expect(inferType(["yes", "no", "YES"])).toEqual({ type: "boolean", format: null });
  });

  it("detects boolean (0/1)", () => {
    expect(inferType(["0", "1", "1", "0"])).toEqual({ type: "boolean", format: null });
  });

  it("detects email", () => {
    expect(inferType(["alice@test.com", "bob@example.org"])).toEqual({ type: "string", format: "email" });
  });

  it("returns string for mixed types", () => {
    expect(inferType(["hello", "42", "true"])).toEqual({ type: "string", format: null });
  });

  it("returns string for plain text", () => {
    expect(inferType(["Alice", "Bob", "Carol"])).toEqual({ type: "string", format: null });
  });

  it("prefers datetime over date when timestamps present", () => {
    // All values match datetime — should not fall through to date
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
// heuristicAnalyze
// ---------------------------------------------------------------------------

describe("heuristicAnalyze", () => {
  it("returns valid FileUploadRecommendationEntitySchema output", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult(),
      existingColumns: [],
      priorRecommendations: [],
    });

    const validated = FileUploadRecommendationEntitySchema.safeParse(result);
    expect(validated.success).toBe(true);
  });

  it("produces one column per columnStat", () => {
    const parseResult = makeParseResult();
    const result = heuristicAnalyze({
      parseResult,
      existingColumns: [],
      priorRecommendations: [],
    });

    expect(result.columns).toHaveLength(parseResult.columnStats.length);
  });

  it("derives entity key from file name", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({ fileName: "User Profiles.csv" }),
      existingColumns: [],
      priorRecommendations: [],
    });

    expect(result.entityKey).toBe("user_profiles");
    expect(result.entityLabel).toBe("User Profiles");
    expect(result.sourceFileName).toBe("User Profiles.csv");
  });

  it("infers types from sample values", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["a@b.com", "c@d.com"] }),
          makeColumnStat({ name: "age", sampleValues: ["30", "25"] }),
          makeColumnStat({ name: "active", sampleValues: ["true", "false"] }),
          makeColumnStat({ name: "created", sampleValues: ["2024-01-15", "2024-02-20"] }),
        ],
      }),
      existingColumns: [],
      priorRecommendations: [],
    });

    expect(result.columns[0].format).toBe("email");
    expect(result.columns[1].type).toBe("number");
    expect(result.columns[2].type).toBe("boolean");
    expect(result.columns[3].type).toBe("date");
  });

  it("sets required=true when nullRate is 0", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [
          makeColumnStat({ name: "id", nullRate: 0 }),
          makeColumnStat({ name: "notes", nullRate: 0.5, nullCount: 5 }),
        ],
      }),
      existingColumns: [],
      priorRecommendations: [],
    });

    expect(result.columns[0].required).toBe(true);
    expect(result.columns[1].required).toBe(false);
  });

  // ── Existing column matching ────────────────────────────────────────

  it("exact key match produces match_existing with confidence 1", () => {
    const existing: ExistingColumnDefinition[] = [
      { id: "col-1", key: "email", label: "Email Address", type: "string" },
    ];
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [makeColumnStat({ name: "email", sampleValues: ["a@b.com"] })],
      }),
      existingColumns: existing,
      priorRecommendations: [],
    });

    expect(result.columns[0].action).toBe("match_existing");
    expect(result.columns[0].existingColumnDefinitionId).toBe("col-1");
    expect(result.columns[0].confidence).toBe(1);
    expect(result.columns[0].key).toBe("email");
    expect(result.columns[0].label).toBe("Email Address");
  });

  it("exact label match (case-insensitive) produces match_existing", () => {
    const existing: ExistingColumnDefinition[] = [
      { id: "col-2", key: "user_email", label: "Email", type: "string" },
    ];
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [makeColumnStat({ name: "Email", sampleValues: ["a@b.com"] })],
      }),
      existingColumns: existing,
      priorRecommendations: [],
    });

    expect(result.columns[0].action).toBe("match_existing");
    expect(result.columns[0].existingColumnDefinitionId).toBe("col-2");
    expect(result.columns[0].confidence).toBe(1);
  });

  it("non-matching columns are create_new with confidence 0", () => {
    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [makeColumnStat({ name: "zzz_unknown" })],
      }),
      existingColumns: [],
      priorRecommendations: [],
    });

    expect(result.columns[0].action).toBe("create_new");
    expect(result.columns[0].existingColumnDefinitionId).toBeNull();
    expect(result.columns[0].confidence).toBe(0);
  });

  // ── Prior recommendation matching ───────────────────────────────────

  it("matches columns from prior recommendations with confidence 0.9", () => {
    const prior = {
      entityKey: "contacts",
      entityLabel: "contacts",
      sourceFileName: "contacts.csv",
      columns: [{
        sourceField: "email",
        key: "email",
        label: "email",
        type: "string" as const,
        format: "email",
        isPrimaryKey: false,
        required: true,
        action: "create_new" as const,
        existingColumnDefinitionId: null,
        confidence: 0,
        sampleValues: ["alice@test.com"],
      }],
    };

    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        fileName: "orders.csv",
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com"] }),
          makeColumnStat({ name: "amount", sampleValues: ["100.00"] }),
        ],
      }),
      existingColumns: [],
      priorRecommendations: [prior],
    });

    const emailCol = result.columns.find((c) => c.sourceField === "email")!;
    expect(emailCol.action).toBe("match_existing");
    expect(emailCol.confidence).toBe(0.9);

    const amountCol = result.columns.find((c) => c.sourceField === "amount")!;
    expect(amountCol.action).toBe("create_new");
    expect(amountCol.confidence).toBe(0);
  });

  it("existing column match takes priority over prior recommendation match", () => {
    const existing: ExistingColumnDefinition[] = [
      { id: "col-1", key: "email", label: "Email", type: "string" },
    ];
    const prior = {
      entityKey: "contacts",
      entityLabel: "contacts",
      sourceFileName: "contacts.csv",
      columns: [{
        sourceField: "email",
        key: "email",
        label: "email",
        type: "string" as const,
        format: null,
        isPrimaryKey: false,
        required: true,
        action: "create_new" as const,
        existingColumnDefinitionId: null,
        confidence: 0,
        sampleValues: [],
      }],
    };

    const result = heuristicAnalyze({
      parseResult: makeParseResult({
        columnStats: [makeColumnStat({ name: "email", sampleValues: ["a@b.com"] })],
      }),
      existingColumns: existing,
      priorRecommendations: [prior],
    });

    // Should prefer existing (confidence 1) over prior (confidence 0.9)
    expect(result.columns[0].confidence).toBe(1);
    expect(result.columns[0].existingColumnDefinitionId).toBe("col-1");
  });
});
