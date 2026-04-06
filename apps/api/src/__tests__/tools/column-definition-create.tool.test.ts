/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUpsertByKey = jest.fn<any>().mockResolvedValue({ id: "cd-1" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { columnDefinitions: { upsertByKey: mockUpsertByKey } } },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyColumnDefinitionInsert: jest.fn() },
}));

const { ColumnDefinitionCreateTool } = await import("../../tools/column-definition-create.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

type ColumnDataType = "string" | "number" | "boolean" | "date" | "datetime" | "enum" | "json" | "array" | "reference" | "reference-array";
interface Input { key: string; label: string; type: ColumnDataType; validationPattern?: string; validationMessage?: string; canonicalFormat?: string; description?: string }
const exec = (input: Input) =>
  new ColumnDefinitionCreateTool().build("station-1", "org-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ColumnDefinitionCreateTool", () => {
  it("upserts by key", async () => {
    const result: any = await exec({ key: "email", label: "Email", type: "string" });
    expect(result.success).toBe(true);
    expect(result.entityId).toBe("cd-1");
    expect(mockUpsertByKey).toHaveBeenCalledWith(expect.objectContaining({ key: "email", label: "Email", organizationId: "org-1" }));
  });

  it("does not require station scope or write capability", async () => {
    const result: any = await exec({ key: "k", label: "L", type: "string" });
    expect(result.success).toBe(true);
  });

});
