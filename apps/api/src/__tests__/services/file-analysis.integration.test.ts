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
      confidence: 0.85,
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
            sourceField: "customer_id",
            existingColumnDefinitionId: "cd-text", existingColumnDefinitionKey: "text",
            confidence: 0.9,
            sampleValues: ["CUS001", "CUS002", "CUS003"],
            format: null, isPrimaryKey: true, required: true,
            normalizedKey: "customer_id", defaultValue: null, enumValues: null,
          },
          {
            sourceField: "email",
            existingColumnDefinitionId: "cd-email", existingColumnDefinitionKey: "email",
            confidence: 0.95,
            sampleValues: ["alice@example.com", "bob@test.org", "carol@acme.io"],
            format: "email", isPrimaryKey: false, required: true,
            normalizedKey: "email", defaultValue: null, enumValues: null,
          },
          {
            sourceField: "created_at",
            existingColumnDefinitionId: "cd-date", existingColumnDefinitionKey: "date",
            confidence: 0.88,
            sampleValues: ["2024-01-15", "2024-02-20", "2024-03-10"],
            format: null, isPrimaryKey: false, required: false,
            normalizedKey: "created_at", defaultValue: null, enumValues: null,
          },
          {
            sourceField: "is_active",
            existingColumnDefinitionId: "cd-boolean", existingColumnDefinitionKey: "boolean",
            confidence: 0.92,
            sampleValues: ["true", "false", "true"],
            format: null, isPrimaryKey: false, required: false,
            normalizedKey: "is_active", defaultValue: null, enumValues: null,
          },
          {
            sourceField: "total_spent",
            existingColumnDefinitionId: "cd-decimal", existingColumnDefinitionKey: "decimal",
            confidence: 0.87,
            sampleValues: ["150.00", "299.99", "45.50"],
            format: null, isPrimaryKey: false, required: false,
            normalizedKey: "total_spent", defaultValue: null, enumValues: null,
          },
        ],
      };

      mockGenerateText.mockResolvedValue({ output: aiResult });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
      expect(result.entityKey).toBe("customers");
      expect(result.columns).toHaveLength(5);
    });

    it("AI result with existing column matches preserves existingColumnDefinitionId", async () => {
      const existingColumns: ExistingColumnDefinition[] = [
        ...makeSeedColumns(),
        { id: "col_email", key: "email", label: "Email Address", type: "string", description: "Email", validationPattern: null, canonicalFormat: "lowercase" },
        { id: "col_name", key: "name", label: "Full Name", type: "string", description: "Name", validationPattern: null, canonicalFormat: "trim" },
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
            sourceField: "email",
            existingColumnDefinitionId: "col_email", existingColumnDefinitionKey: "email",
            confidence: 0.98,
            sampleValues: ["alice@test.com"],
            format: "email", isPrimaryKey: false, required: true,
            normalizedKey: "email", defaultValue: null, enumValues: null,
          },
          {
            sourceField: "name",
            existingColumnDefinitionId: "col_name", existingColumnDefinitionKey: "name",
            confidence: 0.95,
            sampleValues: ["Alice"],
            format: null, isPrimaryKey: false, required: true,
            normalizedKey: "name", defaultValue: null, enumValues: null,
          },
          {
            sourceField: "phone",
            existingColumnDefinitionId: "cd-phone", existingColumnDefinitionKey: "phone",
            confidence: 0.7,
            sampleValues: ["+1-555-0100"],
            format: null, isPrimaryKey: false, required: false,
            normalizedKey: "phone", defaultValue: null, enumValues: null,
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
      expect(emailCol.existingColumnDefinitionId).toBe("col_email");

      const nameCol = result.columns.find((c) => c.sourceField === "name")!;
      expect(nameCol.existingColumnDefinitionId).toBe("col_name");

      const phoneCol = result.columns.find((c) => c.sourceField === "phone")!;
      expect(phoneCol.existingColumnDefinitionId).toBe("cd-phone");
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
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result);
      expect(validated.success).toBe(true);
      expect(result.columns).toHaveLength(4);

      // Heuristic should map to appropriate seed column definitions
      const emailCol = result.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.format).toBe("email");
      expect(emailCol.existingColumnDefinitionId).toBe("cd-email");

      const dateCol = result.columns.find((c) => c.sourceField === "created_date")!;
      expect(dateCol.existingColumnDefinitionId).toBe("cd-date");

      const amountCol = result.columns.find((c) => c.sourceField === "amount")!;
      expect(amountCol.existingColumnDefinitionId).toBe("cd-decimal");

      const boolCol = result.columns.find((c) => c.sourceField === "is_verified")!;
      expect(boolCol.existingColumnDefinitionId).toBe("cd-boolean");
    });

    it("heuristic matches existing columns when AI is down", async () => {
      mockGenerateText.mockRejectedValue(new Error("Network error"));

      const parseResult = makeParseResult({
        headers: ["email", "phone"],
        columnStats: [
          makeColumnStat({ name: "email", sampleValues: ["alice@test.com"] }),
          makeColumnStat({ name: "phone", sampleValues: ["+1-555-0100"] }),
        ],
      });

      const result = await FileAnalysisService.getRecommendations({
        parseResult,
        existingColumns: makeSeedColumns(),
        priorRecommendations: [],
      });

      const emailCol = result.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.existingColumnDefinitionId).toBe("cd-email");
      expect(emailCol.confidence).toBe(1);

      const phoneCol = result.columns.find((c) => c.sourceField === "phone")!;
      expect(phoneCol.existingColumnDefinitionId).toBe("cd-phone");
    });
  });

  describe("Multi-file analysis with existing column definitions", () => {
    it("second file uses seed columns for heuristic fallback", async () => {
      const seedColumns = makeSeedColumns();

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
        existingColumns: seedColumns,
        priorRecommendations: [],
      });

      // Second file: AI fails, heuristic uses seed columns
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
        existingColumns: seedColumns,
        priorRecommendations: [result1],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result2);
      expect(validated.success).toBe(true);

      // email should be matched to seed column via exact key match
      const emailCol = result2.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.existingColumnDefinitionId).toBe("cd-email");
      expect(emailCol.confidence).toBe(1);

      // order_id should fall back to text via type-based fallback
      const orderCol = result2.columns.find((c) => c.sourceField === "order_id")!;
      expect(orderCol.existingColumnDefinitionId).toBe("cd-text");
    });

    it("existing column definitions take priority over prior recommendations", async () => {
      mockGenerateText.mockRejectedValue(new Error("AI down"));

      const existingColumns: ExistingColumnDefinition[] = [
        ...makeSeedColumns(),
        { id: "col_email_org", key: "org_email", label: "Org Email", type: "string", description: "Org email", validationPattern: null, canonicalFormat: "lowercase" },
      ];

      const priorRecommendation = {
        entityKey: "contacts",
        entityLabel: "contacts",
        sourceFileName: "contacts.csv",
        columns: [
          {
            sourceField: "email",
            existingColumnDefinitionId: "cd-text",
            existingColumnDefinitionKey: "text",
            confidence: 0.85,
            sampleValues: ["alice@test.com"],
            format: "email",
            isPrimaryKey: false,
            required: true,
            normalizedKey: "email",
            defaultValue: null,
            enumValues: null,
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

      // Existing column definition should win — exact key match on seed "email"
      const emailCol = result.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.existingColumnDefinitionId).toBe("cd-email");
      expect(emailCol.confidence).toBe(1);
    });

    it("three-file sequential analysis all produce valid output", async () => {
      const seedColumns = makeSeedColumns();

      // File 1: AI succeeds
      const parseResult1 = makeParseResult({
        fileName: "file1.csv",
        headers: ["email"],
        columnStats: [makeColumnStat({ name: "email", sampleValues: ["a@test.com"] })],
      });
      mockGenerateText.mockResolvedValueOnce({ output: makeAiRecommendation(parseResult1) });
      const result1 = await FileAnalysisService.getRecommendations({
        parseResult: parseResult1,
        existingColumns: seedColumns,
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
        existingColumns: seedColumns,
        priorRecommendations: [result1],
      });

      // File 3: AI fails, heuristic uses seed columns
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
        existingColumns: seedColumns,
        priorRecommendations: [result1, result2],
      });

      const validated = FileUploadRecommendationEntitySchema.safeParse(result3);
      expect(validated.success).toBe(true);

      // email should match seed column via exact key
      const emailCol = result3.columns.find((c) => c.sourceField === "email")!;
      expect(emailCol.existingColumnDefinitionId).toBe("cd-email");
      expect(emailCol.confidence).toBe(1);

      // phone should match seed column via exact key
      const phoneCol = result3.columns.find((c) => c.sourceField === "phone")!;
      expect(phoneCol.existingColumnDefinitionId).toBe("cd-phone");

      // address should fall back to text via type-based fallback
      const addressCol = result3.columns.find((c) => c.sourceField === "address")!;
      expect(addressCol.existingColumnDefinitionId).toBe("cd-text");
    });
  });
});
