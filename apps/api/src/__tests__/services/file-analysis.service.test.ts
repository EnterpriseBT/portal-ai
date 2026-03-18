import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import {
  FileUploadRecommendationEntitySchema,
  type FileParseResult,
  type ColumnStat,
} from "@portalai/core/models";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGenerateObject = jest.fn<() => Promise<{ object: unknown }>>();

jest.unstable_mockModule("ai", () => ({
  generateObject: mockGenerateObject,
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

function makeAiRecommendation(parseResult: FileParseResult) {
  return {
    entityKey: "contacts",
    entityLabel: "Contacts",
    sourceFileName: parseResult.fileName,
    columns: parseResult.columnStats.map((s) => ({
      sourceField: s.name,
      key: s.name.toLowerCase(),
      label: s.name,
      type: "string",
      format: null,
      isPrimaryKey: false,
      required: true,
      action: "create_new",
      existingColumnDefinitionId: null,
      confidence: 0.9,
      sampleValues: s.sampleValues,
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests — AI analysis
// ---------------------------------------------------------------------------

describe("FileAnalysisService", () => {
  beforeEach(() => {
    mockGenerateObject.mockReset();
  });

  describe("getRecommendations() — AI path", () => {
    it("returns valid FileUploadRecommendationEntitySchema output", async () => {
      const parseResult = makeParseResult();
      const aiResult = makeAiRecommendation(parseResult);
      mockGenerateObject.mockResolvedValue({ object: aiResult });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
    });

    it("confidence scores are between 0 and 1", async () => {
      const parseResult = makeParseResult();
      const aiResult = makeAiRecommendation(parseResult);
      mockGenerateObject.mockResolvedValue({ object: aiResult });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: [],
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
      mockGenerateObject.mockRejectedValue(abortError);

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      // Heuristic fallback should still produce valid output
      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
      // Heuristic produces confidence: 0 for non-matching columns
      for (const col of result.columns) {
        expect(col.confidence).toBe(0);
        expect(col.action).toBe("create_new");
      }
    });

    it("AI Zod validation failure retries once then falls back to heuristic", async () => {
      const parseResult = makeParseResult();
      // Return invalid object twice (missing required fields)
      mockGenerateObject
        .mockResolvedValueOnce({ object: { invalid: true } })
        .mockResolvedValueOnce({ object: { invalid: true } });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      // Should have been called twice (initial + 1 retry)
      expect(mockGenerateObject).toHaveBeenCalledTimes(2);
      // Fallback result is still valid
      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
    });

    it("AI error triggers heuristic fallback", async () => {
      const parseResult = makeParseResult();
      mockGenerateObject.mockRejectedValue(new Error("API rate limit"));

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
    });
  });

  // ── Heuristic fallback tests ─────────────────────────────────────────

  describe("heuristicAnalyze()", () => {
    it("infers date type from sample values", () => {
      const parseResult = makeParseResult({
        headers: ["created_at"],
        columnStats: [
          makeColumnStat({ name: "created_at", sampleValues: ["2024-01-15", "2024-02-20", "2024-03-10"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      expect(result.columns[0].type).toBe("date");
    });

    it("infers number type from sample values", () => {
      const parseResult = makeParseResult({
        headers: ["price"],
        columnStats: [
          makeColumnStat({ name: "price", sampleValues: ["9.99", "14.50", "100.00"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      expect(result.columns[0].type).toBe("number");
    });

    it("infers boolean type from sample values", () => {
      const parseResult = makeParseResult({
        headers: ["active"],
        columnStats: [
          makeColumnStat({ name: "active", sampleValues: ["true", "false", "true", "false"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      expect(result.columns[0].type).toBe("boolean");
    });

    it("infers email format from sample values", () => {
      const parseResult = makeParseResult({
        headers: ["email"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com", "bob@example.org"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      expect(result.columns[0].type).toBe("string");
      expect(result.columns[0].format).toBe("email");
    });

    it("exact key match against existing column definitions produces match_existing", () => {
      const existingColumns: ExistingColumnDefinition[] = [
        { id: "col-1", key: "email", label: "Email Address", type: "string" },
      ];
      const parseResult = makeParseResult({
        headers: ["email"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns,
        priorRecommendations: [],
      });

      expect(result.columns[0].action).toBe("match_existing");
      expect(result.columns[0].existingColumnDefinitionId).toBe("col-1");
      expect(result.columns[0].confidence).toBe(1);
    });

    it("exact label match against existing column definitions works", () => {
      const existingColumns: ExistingColumnDefinition[] = [
        { id: "col-2", key: "user_email", label: "Email", type: "string" },
      ];
      const parseResult = makeParseResult({
        headers: ["Email"],
        columnStats: [
          makeColumnStat({ name: "Email", sampleValues: ["alice@test.com"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns,
        priorRecommendations: [],
      });

      expect(result.columns[0].action).toBe("match_existing");
      expect(result.columns[0].existingColumnDefinitionId).toBe("col-2");
      expect(result.columns[0].confidence).toBe(1);
    });

    it("non-exact matches flagged create_new with confidence: 0", () => {
      const parseResult = makeParseResult({
        headers: ["weird_column_xyz"],
        columnStats: [
          makeColumnStat({ name: "weird_column_xyz", sampleValues: ["foo", "bar"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      expect(result.columns[0].action).toBe("create_new");
      expect(result.columns[0].confidence).toBe(0);
      expect(result.columns[0].existingColumnDefinitionId).toBeNull();
    });

    it("all columns returned with valid schema shape", () => {
      const parseResult = makeParseResult();

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
      expect(result.columns).toHaveLength(parseResult.columnStats.length);
    });

    it("cumulative context from prior files influences subsequent recommendations", () => {
      const priorEntity = {
        entityKey: "contacts",
        entityLabel: "contacts",
        sourceFileName: "contacts.csv",
        columns: [
          {
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
          },
        ],
      };

      const parseResult = makeParseResult({
        fileName: "orders.csv",
        headers: ["email", "amount"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com"] }),
          makeColumnStat({ name: "amount", sampleValues: ["100.00", "200.00"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: [],
        priorRecommendations: [priorEntity],
      });

      // email should be matched from prior recommendations
      const emailCol = result.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.action).toBe("match_existing");
      expect(emailCol.confidence).toBe(0.9);

      // amount should be create_new
      const amountCol = result.columns.find((c) => c.sourceField === "amount")!;
      expect(amountCol.action).toBe("create_new");
    });

    it("infers datetime type from ISO datetime samples", () => {
      const parseResult = makeParseResult({
        headers: ["timestamp"],
        columnStats: [
          makeColumnStat({ name: "timestamp", sampleValues: ["2024-01-15T10:30:00Z", "2024-02-20T14:00:00Z"] }),
        ],
      });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      expect(result.columns[0].type).toBe("datetime");
    });

    it("derives entity key from file name", () => {
      const parseResult = makeParseResult({ fileName: "User Profiles.csv" });

      const result = FileAnalysisService.heuristicAnalyze({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      expect(result.entityKey).toBe("user_profiles");
      expect(result.sourceFileName).toBe("User Profiles.csv");
    });
  });
});
