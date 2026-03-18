import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import {
  FileUploadRecommendationEntitySchema,
  type FileParseResult,
  type ColumnStat,
} from "@portalai/core/models";

// ---------------------------------------------------------------------------
// Mocks — AI service is mocked to isolate integration tests from real LLM
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
      confidence: 0.85,
      sampleValues: s.sampleValues,
    })),
  };
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe("FileAnalysisService — Integration", () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  describe("Full analysis pipeline with real parse results", () => {
    it("AI service returns valid recommendations for a realistic CSV parse result", async () => {
      const parseResult = makeParseResult({
        fileName: "customers.csv",
        headers: ["customer_id", "email", "created_at", "is_active", "total_spent"],
        columnStats: [
          makeColumnStat({ name: "customer_id", sampleValues: ["CUS001", "CUS002", "CUS003"] }),
          makeColumnStat({ name: "email", sampleValues: ["alice@example.com", "bob@test.org", "carol@acme.io"] }),
          makeColumnStat({ name: "created_at", sampleValues: ["2024-01-15", "2024-02-20", "2024-03-10"] }),
          makeColumnStat({ name: "is_active", sampleValues: ["true", "false", "true"] }),
          makeColumnStat({ name: "total_spent", sampleValues: ["150.00", "299.99", "45.50"] }),
        ],
      });

      const aiResult = {
        entityKey: "customers",
        entityLabel: "Customers",
        sourceFileName: "customers.csv",
        columns: [
          {
            sourceField: "customer_id", key: "customer_id", label: "Customer ID",
            type: "string", format: null, isPrimaryKey: true, required: true,
            action: "create_new", existingColumnDefinitionId: null, confidence: 0.9,
            sampleValues: ["CUS001", "CUS002", "CUS003"],
          },
          {
            sourceField: "email", key: "email", label: "Email",
            type: "string", format: "email", isPrimaryKey: false, required: true,
            action: "create_new", existingColumnDefinitionId: null, confidence: 0.95,
            sampleValues: ["alice@example.com", "bob@test.org", "carol@acme.io"],
          },
          {
            sourceField: "created_at", key: "created_at", label: "Created At",
            type: "date", format: null, isPrimaryKey: false, required: false,
            action: "create_new", existingColumnDefinitionId: null, confidence: 0.88,
            sampleValues: ["2024-01-15", "2024-02-20", "2024-03-10"],
          },
          {
            sourceField: "is_active", key: "is_active", label: "Is Active",
            type: "boolean", format: null, isPrimaryKey: false, required: false,
            action: "create_new", existingColumnDefinitionId: null, confidence: 0.92,
            sampleValues: ["true", "false", "true"],
          },
          {
            sourceField: "total_spent", key: "total_spent", label: "Total Spent",
            type: "number", format: null, isPrimaryKey: false, required: false,
            action: "create_new", existingColumnDefinitionId: null, confidence: 0.87,
            sampleValues: ["150.00", "299.99", "45.50"],
          },
        ],
      };

      mockGenerateText.mockResolvedValue({ output: aiResult });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
      expect(result.entityKey).toBe("customers");
      expect(result.columns).toHaveLength(5);
    });

    it("AI result with existing column matches produces match_existing actions", async () => {
      const existingColumns: ExistingColumnDefinition[] = [
        { id: "col_email", key: "email", label: "Email Address", type: "string" },
        { id: "col_name", key: "name", label: "Full Name", type: "string" },
      ];

      const parseResult = makeParseResult({
        headers: ["email", "name", "phone"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com"] }),
          makeColumnStat({ name: "name", sampleValues: ["Alice"] }),
          makeColumnStat({ name: "phone", sampleValues: ["+1-555-0100"] }),
        ],
      });

      const aiResult = {
        entityKey: "contacts",
        entityLabel: "Contacts",
        sourceFileName: parseResult.fileName,
        columns: [
          {
            sourceField: "email", key: "email", label: "Email",
            type: "string", format: "email", isPrimaryKey: false, required: true,
            action: "match_existing", existingColumnDefinitionId: "col_email", confidence: 0.98,
            sampleValues: ["alice@test.com"],
          },
          {
            sourceField: "name", key: "name", label: "Name",
            type: "string", format: null, isPrimaryKey: false, required: true,
            action: "match_existing", existingColumnDefinitionId: "col_name", confidence: 0.95,
            sampleValues: ["Alice"],
          },
          {
            sourceField: "phone", key: "phone", label: "Phone",
            type: "string", format: null, isPrimaryKey: false, required: false,
            action: "create_new", existingColumnDefinitionId: null, confidence: 0.7,
            sampleValues: ["+1-555-0100"],
          },
        ],
      };

      mockGenerateText.mockResolvedValue({ output: aiResult });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns,
        priorRecommendations: [],
      });

      const emailCol = result.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.action).toBe("match_existing");
      expect(emailCol.existingColumnDefinitionId).toBe("col_email");

      const nameCol = result.columns.find((c) => c.sourceField === "name")!;
      expect(nameCol.action).toBe("match_existing");

      const phoneCol = result.columns.find((c) => c.sourceField === "phone")!;
      expect(phoneCol.action).toBe("create_new");
    });
  });

  describe("Heuristic fallback produces valid output when AI is unavailable", () => {
    it("falls back to heuristic on AI error and produces valid schema output", async () => {
      mockGenerateText.mockRejectedValue(new Error("Service unavailable"));

      const parseResult = makeParseResult({
        headers: ["email", "created_date", "amount", "is_verified"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com", "bob@example.org"] }),
          makeColumnStat({ name: "created_date", sampleValues: ["2024-01-15", "2024-02-20"] }),
          makeColumnStat({ name: "amount", sampleValues: ["99.99", "150.00", "200.50"] }),
          makeColumnStat({ name: "is_verified", sampleValues: ["true", "false", "true"] }),
        ],
      });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: [],
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
      expect(result.columns).toHaveLength(4);

      // Heuristic should infer types
      const emailCol = result.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.format).toBe("email");

      const dateCol = result.columns.find((c) => c.sourceField === "created_date")!;
      expect(dateCol.type).toBe("date");

      const amountCol = result.columns.find((c) => c.sourceField === "amount")!;
      expect(amountCol.type).toBe("number");

      const boolCol = result.columns.find((c) => c.sourceField === "is_verified")!;
      expect(boolCol.type).toBe("boolean");
    });

    it("heuristic matches existing columns when AI is down", async () => {
      mockGenerateText.mockRejectedValue(new Error("Network error"));

      const existingColumns: ExistingColumnDefinition[] = [
        { id: "col_email", key: "email", label: "Email", type: "string" },
      ];

      const parseResult = makeParseResult({
        headers: ["email", "phone"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com"] }),
          makeColumnStat({ name: "phone", sampleValues: ["+1-555-0100"] }),
        ],
      });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns,
        priorRecommendations: [],
      });

      const emailCol = result.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.action).toBe("match_existing");
      expect(emailCol.existingColumnDefinitionId).toBe("col_email");
      expect(emailCol.confidence).toBe(1);

      const phoneCol = result.columns.find((c) => c.sourceField === "phone")!;
      expect(phoneCol.action).toBe("create_new");
      expect(phoneCol.confidence).toBe(0);
    });
  });

  describe("Multi-file analysis builds cumulative context correctly", () => {
    it("second file matches columns from first file's recommendations", async () => {
      // First file: AI succeeds
      const parseResult1 = makeParseResult({
        fileName: "contacts.csv",
        headers: ["email", "name"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com"] }),
          makeColumnStat({ name: "name", sampleValues: ["Alice"] }),
        ],
      });

      const aiResult1 = makeAiRecommendation(parseResult1);
      mockGenerateText.mockResolvedValueOnce({ output: aiResult1 });

      const result1 = await FileAnalysisService.getRecommendations({
        parseResult: parseResult1,
        existingColumns: [],
        priorRecommendations: [],
      });

      // Second file: AI fails, heuristic uses prior recommendations
      mockGenerateText.mockRejectedValueOnce(new Error("AI down"));

      const parseResult2 = makeParseResult({
        fileName: "orders.csv",
        headers: ["email", "order_id", "total"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com", "bob@test.com"] }),
          makeColumnStat({ name: "order_id", sampleValues: ["ORD001", "ORD002"] }),
          makeColumnStat({ name: "total", sampleValues: ["99.99", "150.00"] }),
        ],
      });

      const result2 = await FileAnalysisService.getRecommendations({
        parseResult: parseResult2,
        existingColumns: [],
        priorRecommendations: [result1],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result2);
      expect(validated.success).toBe(true);

      // email should be matched from prior recommendations with confidence 0.9
      const emailCol = result2.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.action).toBe("match_existing");
      expect(emailCol.confidence).toBe(0.9);

      // order_id and total should be create_new
      const orderCol = result2.columns.find((c) => c.sourceField === "order_id")!;
      expect(orderCol.action).toBe("create_new");
      expect(orderCol.confidence).toBe(0);
    });

    it("existing column definitions take priority over prior recommendations", async () => {
      mockGenerateText.mockRejectedValue(new Error("AI down"));

      const existingColumns: ExistingColumnDefinition[] = [
        { id: "col_email_org", key: "email", label: "Org Email", type: "string" },
      ];

      const priorRecommendation = {
        entityKey: "contacts",
        entityLabel: "contacts",
        sourceFileName: "contacts.csv",
        columns: [
          {
            sourceField: "email", key: "email", label: "email",
            type: "string" as const, format: "email", isPrimaryKey: false, required: true,
            action: "create_new" as const, existingColumnDefinitionId: null, confidence: 0,
            sampleValues: ["alice@test.com"],
          },
        ],
      };

      const parseResult = makeParseResult({
        fileName: "orders.csv",
        headers: ["email"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com"] }),
        ],
      });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns,
        priorRecommendations: [priorRecommendation],
      });

      // Existing column definition should win over prior recommendation
      const emailCol = result.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.action).toBe("match_existing");
      expect(emailCol.existingColumnDefinitionId).toBe("col_email_org");
      expect(emailCol.confidence).toBe(1);
    });

    it("three-file sequential analysis accumulates context correctly", async () => {
      // File 1: AI succeeds
      const parseResult1 = makeParseResult({
        fileName: "file1.csv",
        headers: ["email"],
        columnStats: [makeColumnStat({ name: "email", sampleValues: ["a@test.com"] })],
      });
      mockGenerateText.mockResolvedValueOnce({ output: makeAiRecommendation(parseResult1) });
      const result1 = await FileAnalysisService.getRecommendations({
        parseResult: parseResult1,
        existingColumns: [],
        priorRecommendations: [],
      });

      // File 2: AI succeeds
      const parseResult2 = makeParseResult({
        fileName: "file2.csv",
        headers: ["email", "phone"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["b@test.com"] }),
          makeColumnStat({ name: "phone", sampleValues: ["+1-555"] }),
        ],
      });
      mockGenerateText.mockResolvedValueOnce({ output: makeAiRecommendation(parseResult2) });
      const result2 = await FileAnalysisService.getRecommendations({
        parseResult: parseResult2,
        existingColumns: [],
        priorRecommendations: [result1],
      });

      // File 3: AI fails, heuristic uses cumulative prior
      mockGenerateText.mockRejectedValueOnce(new Error("AI down"));
      const parseResult3 = makeParseResult({
        fileName: "file3.csv",
        headers: ["email", "phone", "address"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["c@test.com"] }),
          makeColumnStat({ name: "phone", sampleValues: ["+1-555"] }),
          makeColumnStat({ name: "address", sampleValues: ["123 Main St"] }),
        ],
      });
      const result3 = await FileAnalysisService.getRecommendations({
        parseResult: parseResult3,
        existingColumns: [],
        priorRecommendations: [result1, result2],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result3);
      expect(validated.success).toBe(true);

      // email and phone should be matched from prior recs
      const emailCol = result3.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.action).toBe("match_existing");
      expect(emailCol.confidence).toBe(0.9);

      const phoneCol = result3.columns.find((c) => c.sourceField === "phone")!;
      expect(phoneCol.action).toBe("match_existing");
      expect(phoneCol.confidence).toBe(0.9);

      // address should be create_new
      const addressCol = result3.columns.find((c) => c.sourceField === "address")!;
      expect(addressCol.action).toBe("create_new");
      expect(addressCol.confidence).toBe(0);
    });
  });
});
