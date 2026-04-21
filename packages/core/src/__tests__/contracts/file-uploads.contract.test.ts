import { describe, it, expect } from "@jest/globals";

import {
  FileUploadParseResponsePayloadSchema,
  type FileUploadParseResponsePayload,
} from "../../contracts/index.js";

describe("FileUploadParseResponsePayloadSchema", () => {
  const validWorkbook = {
    sheets: [
      {
        name: "Sheet1",
        dimensions: { rows: 2, cols: 2 },
        cells: [
          { row: 1, col: 1, value: "Name" },
          { row: 1, col: 2, value: "Email" },
          { row: 2, col: 1, value: "Alice" },
          { row: 2, col: 2, value: "alice@example.com" },
        ],
      },
    ],
  };

  it("parses a minimal valid payload", () => {
    const result = FileUploadParseResponsePayloadSchema.safeParse({
      workbook: validWorkbook,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing workbook", () => {
    const result = FileUploadParseResponsePayloadSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects an empty sheets array", () => {
    const result = FileUploadParseResponsePayloadSchema.safeParse({
      workbook: { sheets: [] },
    });
    expect(result.success).toBe(false);
  });

  it("accepts multiple sheets", () => {
    const result = FileUploadParseResponsePayloadSchema.safeParse({
      workbook: {
        sheets: [
          validWorkbook.sheets[0],
          {
            name: "Sheet2",
            dimensions: { rows: 1, cols: 1 },
            cells: [{ row: 1, col: 1, value: null }],
          },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("exposes a usable FileUploadParseResponsePayload type", () => {
    const payload: FileUploadParseResponsePayload = {
      workbook: validWorkbook,
    };
    expect(payload.workbook.sheets).toHaveLength(1);
  });
});
