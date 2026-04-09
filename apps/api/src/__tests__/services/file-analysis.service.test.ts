import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import {
  FileUploadRecommendationEntitySchema,
  type FileParseResult,
  type ColumnStat,
} from "@portalai/core/models";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGenerateText = jest.fn<() => Promise<{ output: unknown }>>();

jest.unstable_mockModule("ai", () => ({
  generateText: mockGenerateText,
  Output: {
    object: ({ schema }: { schema: unknown }) => ({ type: "object", schema }),
  },
}));

jest.unstable_mockModule("../../services/ai.service.js", () => ({
  AiService: {
    DEFAULT_MODEL: "test-model",
    providers: {
      anthropic: jest.fn((model: string) => model),
    },
  },
}));

const { FileAnalysisService } = await import(
  "../../services/file-analysis.service.js"
);
const { buildFileAnalysisPrompt } = await import(
  "../../prompts/file-analysis.prompt.js"
);
type ExistingColumnDefinition = import("../../services/file-analysis.service.js").ExistingColumnDefinition;

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

/** Standard seed column definitions covering all types. */
function makeSeedColumns(): ExistingColumnDefinition[] {
  return [
    { id: "cd-uuid", key: "uuid", label: "UUID", type: "string", description: "Universally unique identifier", validationPattern: null, canonicalFormat: "lowercase" },
    { id: "cd-email", key: "email", label: "Email", type: "string", description: "Email address", validationPattern: null, canonicalFormat: "lowercase" },
    { id: "cd-phone", key: "phone", label: "Phone", type: "string", description: "Phone number", validationPattern: null, canonicalFormat: "phone" },
    { id: "cd-name", key: "name", label: "Name", type: "string", description: "Person or entity name", validationPattern: null, canonicalFormat: "trim" },
    { id: "cd-text", key: "text", label: "Text", type: "string", description: "General-purpose text content", validationPattern: null, canonicalFormat: "trim" },
    { id: "cd-integer", key: "integer", label: "Integer", type: "number", description: "Whole number", validationPattern: null, canonicalFormat: "#,##0" },
    { id: "cd-decimal", key: "decimal", label: "Decimal", type: "number", description: "Decimal number", validationPattern: null, canonicalFormat: "#,##0.00" },
    { id: "cd-boolean", key: "boolean", label: "Boolean", type: "boolean", description: "True or false", validationPattern: null, canonicalFormat: null },
    { id: "cd-date", key: "date", label: "Date", type: "date", description: "Calendar date", validationPattern: null, canonicalFormat: null },
    { id: "cd-datetime", key: "datetime", label: "Date & Time", type: "datetime", description: "Date and time", validationPattern: null, canonicalFormat: null },
    { id: "cd-url", key: "url", label: "Website", type: "string", description: "Website URL", validationPattern: null, canonicalFormat: "lowercase" },
  ];
}

function makeAiRecommendation(parseResult: FileParseResult) {
  return {
    entityKey: "contacts",
    entityLabel: "Contacts",
    sourceFileName: parseResult.fileName,
    columns: parseResult.columnStats.map((s) => ({
      sourceField: s.name,
      existingColumnDefinitionId: "cd-text",
      existingColumnDefinitionKey: "text",
      confidence: 0.9,
      sampleValues: s.sampleValues,
      format: null,
      isPrimaryKey: false,
      required: true,
      normalizedKey: s.name.toLowerCase().replace(/\s+/g, "_"),
      defaultValue: null,
      enumValues: null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests — AI analysis
// ---------------------------------------------------------------------------

describe("FileAnalysisService", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  describe("getRecommendations() — AI path", () => {
    it("returns valid FileUploadRecommendationEntitySchema output", async () => {
      const parseResult = makeParseResult();
      const aiResult = makeAiRecommendation(parseResult);
      mockGenerateText.mockResolvedValue({ output: aiResult });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
    });

    it("confidence scores are between 0 and 1", async () => {
      const parseResult = makeParseResult();
      const aiResult = makeAiRecommendation(parseResult);
      mockGenerateText.mockResolvedValue({ output: aiResult });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      for (const col of result.columns) {
        expect(col.confidence).toBeGreaterThanOrEqual(0);
        expect(col.confidence).toBeLessThanOrEqual(1);
      }
    });

    it("AI timeout triggers heuristic fallback", async () => {
      const parseResult = makeParseResult();
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockGenerateText.mockRejectedValue(abortError);

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      // Heuristic fallback should still produce valid output
      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
      // Every column should have an existingColumnDefinitionId (non-empty string)
      for (const col of result.columns) {
        expect(typeof col.existingColumnDefinitionId).toBe("string");
        expect(col.existingColumnDefinitionId.length).toBeGreaterThan(0);
      }
    });

    it("AI Zod validation failure retries once then falls back to heuristic", async () => {
      const parseResult = makeParseResult();
      // Return invalid object twice (missing required fields)
      mockGenerateText
        .mockResolvedValueOnce({ output: { invalid: true } })
        .mockResolvedValueOnce({ output: { invalid: true } });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      // Should have been called twice (initial + 1 retry)
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
      // Fallback result is still valid
      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
    });

    it("resolves existingColumnDefinitionId when AI returns key instead of UUID", async () => {
      const existingColumns: ExistingColumnDefinition[] = [
        { id: "uuid-123", key: "is_active", label: "Is Active", type: "boolean", description: "Active flag", validationPattern: null, canonicalFormat: null },
        { id: "uuid-456", key: "email", label: "Email", type: "string", description: "Email address", validationPattern: null, canonicalFormat: "lowercase" },
      ];
      const parseResult = makeParseResult({
        headers: ["is_active", "email"],
        columnStats: [
          makeColumnStat({ name: "is_active", sampleValues: ["true", "false"] }),
          makeColumnStat({ name: "email", sampleValues: ["a@b.com"] }),
        ],
      });
      const aiResult = {
        entityKey: "contacts",
        entityLabel: "Contacts",
        sourceFileName: parseResult.fileName,
        columns: [
          {
            sourceField: "is_active",
            existingColumnDefinitionId: "is_active", // Key instead of UUID!
            existingColumnDefinitionKey: "is_active",
            confidence: 1,
            sampleValues: ["true", "false"],
            format: null,
            isPrimaryKey: false,
            required: true,
            normalizedKey: "is_active",
            defaultValue: null,
            enumValues: null,
          },
          {
            sourceField: "email",
            existingColumnDefinitionId: "uuid-456", // Correct UUID
            existingColumnDefinitionKey: "email",
            confidence: 1,
            sampleValues: ["a@b.com"],
            format: "email",
            isPrimaryKey: false,
            required: true,
            normalizedKey: "email",
            defaultValue: null,
            enumValues: null,
          },
        ],
      };
      mockGenerateText.mockResolvedValue({ output: aiResult });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns,
        priorRecommendations: [],
      });

      // Key "is_active" should be resolved to UUID "uuid-123"
      expect(result.columns[0].existingColumnDefinitionId).toBe("uuid-123");
      // Already-correct UUID should be unchanged
      expect(result.columns[1].existingColumnDefinitionId).toBe("uuid-456");
    });

    it("attempts type-based fallback when existingColumnDefinitionId is unresolvable", async () => {
      const seedColumns = makeSeedColumns();
      const parseResult = makeParseResult({
        headers: ["mystery"],
        columnStats: [
          makeColumnStat({ name: "mystery", sampleValues: ["x"] }),
        ],
      });
      const aiResult = {
        entityKey: "data",
        entityLabel: "Data",
        sourceFileName: parseResult.fileName,
        columns: [
          {
            sourceField: "mystery",
            existingColumnDefinitionId: "nonexistent_key",
            existingColumnDefinitionKey: "nonexistent",
            confidence: 0.8,
            sampleValues: ["x"],
            format: null,
            isPrimaryKey: false,
            required: false,
            normalizedKey: "mystery",
            defaultValue: null,
            enumValues: null,
          },
        ],
      };
      mockGenerateText.mockResolvedValue({ output: aiResult });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: seedColumns,
        priorRecommendations: [],
      });

      // Should fall back to type-based match (string → "text" seed column)
      expect(result.columns[0].existingColumnDefinitionId).toBe("cd-text");
    });

    it("AI error triggers heuristic fallback", async () => {
      const parseResult = makeParseResult();
      mockGenerateText.mockRejectedValue(new Error("API rate limit"));

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
    });
  });

  // ── Heuristic fallback tests ─────────────────────────────────────────

  describe("heuristicAnalyze()", () => {
    it("maps date column to date seed column definition", () => {
      const parseResult = makeParseResult({
        headers: ["created_at"],
        columnStats: [
          makeColumnStat({ name: "created_at", sampleValues: ["2024-01-15", "2024-02-20", "2024-03-10"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(result.columns[0].existingColumnDefinitionId).toBe("cd-date");
    });

    it("maps number column to decimal seed column definition", () => {
      const parseResult = makeParseResult({
        headers: ["price"],
        columnStats: [
          makeColumnStat({ name: "price", sampleValues: ["9.99", "14.50", "100.00"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(result.columns[0].existingColumnDefinitionId).toBe("cd-decimal");
    });

    it("maps boolean column to boolean seed column definition", () => {
      const parseResult = makeParseResult({
        headers: ["active"],
        columnStats: [
          makeColumnStat({ name: "active", sampleValues: ["true", "false", "true", "false"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(result.columns[0].existingColumnDefinitionId).toBe("cd-boolean");
    });

    it("maps email column to email seed column definition with email format", () => {
      const parseResult = makeParseResult({
        headers: ["email"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com", "bob@example.org"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(result.columns[0].existingColumnDefinitionId).toBe("cd-email");
      expect(result.columns[0].format).toBe("email");
    });

    it("exact key match against existing column definitions produces confidence 1", () => {
      const parseResult = makeParseResult({
        headers: ["email"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(result.columns[0].existingColumnDefinitionId).toBe("cd-email");
      expect(result.columns[0].confidence).toBe(1);
    });

    it("exact label match against existing column definitions works", () => {
      const existingColumns: ExistingColumnDefinition[] = [
        ...makeSeedColumns(),
        { id: "col-2", key: "user_email", label: "Contact Email", type: "string", description: "User email", validationPattern: null, canonicalFormat: "lowercase" },
      ];
      const parseResult = makeParseResult({
        headers: ["Contact Email"],
        columnStats: [
          makeColumnStat({ name: "Contact Email", sampleValues: ["alice@test.com"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns,
        priorRecommendations: [],
      });

      // "Contact Email" label matches "Contact Email" label on col-2 via exact label match
      expect(result.columns[0].existingColumnDefinitionId).toBe("col-2");
      expect(result.columns[0].confidence).toBe(1);
    });

    it("non-exact matches use type-based fallback with lower confidence", () => {
      const parseResult = makeParseResult({
        headers: ["weird_column_xyz"],
        columnStats: [
          makeColumnStat({ name: "weird_column_xyz", sampleValues: ["foo", "bar"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      // Should fall back to "text" seed column via type-based fallback
      expect(result.columns[0].existingColumnDefinitionId).toBe("cd-text");
      expect(result.columns[0].confidence).toBeLessThan(1);
    });

    it("all columns returned with valid schema shape", () => {
      const parseResult = makeParseResult();

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
      expect(result.columns).toHaveLength(parseResult.columnStats.length);
    });

    it("maps datetime column to datetime seed column definition", () => {
      const parseResult = makeParseResult({
        headers: ["timestamp"],
        columnStats: [
          makeColumnStat({ name: "timestamp", sampleValues: ["2024-01-15T10:30:00Z", "2024-02-20T14:00:00Z"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(result.columns[0].existingColumnDefinitionId).toBe("cd-datetime");
    });

    it("derives entity key from file name", () => {
      const parseResult = makeParseResult({ fileName: "User Profiles.csv" });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(result.entityKey).toBe("user_profiles");
      expect(result.sourceFileName).toBe("User Profiles.csv");
    });
  });

  // ── Phase 4: new recommendation fields ───────────────────────────

  describe("Phase 4 — recommendation output includes new fields", () => {
    it("includes normalizedKey per column (defaults to snake_case key)", () => {
      const parseResult = makeParseResult({
        headers: ["First Name", "email"],
        columnStats: [
          makeColumnStat({ name: "First Name", sampleValues: ["Alice", "Bob"] }),
          makeColumnStat({ name: "email", sampleValues: ["a@b.com", "c@d.com"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(result.columns[0].normalizedKey).toBe("first_name");
      expect(result.columns[1].normalizedKey).toBe("email");
    });

    it("places required, defaultValue, format, enumValues at column level for mapping use", () => {
      const parseResult = makeParseResult({
        headers: ["status"],
        columnStats: [
          makeColumnStat({ name: "status", sampleValues: ["active", "inactive"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      const col = result.columns[0];
      expect(col).toHaveProperty("required");
      expect(col).toHaveProperty("defaultValue");
      expect(col).toHaveProperty("enumValues");
      expect(col).toHaveProperty("format");
      expect(col.defaultValue).toBeNull();
      expect(col.enumValues).toBeNull();
    });

    it("recommendation output still validates against FileUploadRecommendationEntitySchema", () => {
      const parseResult = makeParseResult();

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
    });
  });

  // ── Phase 4: prompt content verification ─────────────────────────

  describe("Phase 4 — file analysis prompt", () => {
    it("includes normalizedKey instruction", () => {
      const prompt = buildFileAnalysisPrompt({
        parseResult: makeParseResult(),
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(prompt).toContain("normalizedKey");
    });

    it("includes semantic matching guidance for column definition selection", () => {
      const prompt = buildFileAnalysisPrompt({
        parseResult: makeParseResult(),
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(prompt).toContain("string_id");
      expect(prompt).toContain("currency");
      expect(prompt).toContain("Matching strategy");
    });

    it("instructs required, format, enumValues as mapping-level attributes", () => {
      const prompt = buildFileAnalysisPrompt({
        parseResult: makeParseResult(),
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      expect(prompt).toMatch(/required.*mapping-level/is);
      expect(prompt).toMatch(/format.*mapping-level/is);
      expect(prompt).toMatch(/enumValues.*mapping-level/is);
    });

    it("includes existing column definition metadata in prompt", () => {
      const columns = makeSeedColumns();
      // Add a column with validationPattern to verify it's rendered
      columns.push({
        id: "cd-custom", key: "custom_email", label: "Custom Email", type: "string",
        description: "Custom email", validationPattern: "^[^@]+@[^@]+$", canonicalFormat: "lowercase",
      });
      const prompt = buildFileAnalysisPrompt({
        parseResult: makeParseResult(),
        existingColumns: columns,
        priorRecommendations: [],
      });

      expect(prompt).toContain("validationPattern");
      expect(prompt).toContain("canonicalFormat");
      expect(prompt).toContain("cd-custom");
    });
  });
});
