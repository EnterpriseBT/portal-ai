/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFindById = jest.fn<any>().mockResolvedValue({ id: "cd-1", key: "email", type: "text" });
const mockUpdate = jest.fn<any>().mockResolvedValue({ id: "cd-1" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { columnDefinitions: { findById: mockFindById, update: mockUpdate } } },
}));

const { ColumnDefinitionUpdateTool } = await import("../../tools/column-definition-update.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { columnDefinitionId: string; label?: string; description?: string | null; enumValues?: string[] | null }
const exec = (input: Input, onMutation?: () => void) =>
  new ColumnDefinitionUpdateTool().build("user-1", onMutation)
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ColumnDefinitionUpdateTool", () => {
  it("updates label and description", async () => {
    const result: any = await exec({ columnDefinitionId: "cd-1", label: "New Label", description: "desc" });
    expect(result.success).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith("cd-1", expect.objectContaining({ label: "New Label", description: "desc" }));
  });

  it("does not accept key or type changes (schema rejects)", () => {
    const tool = new ColumnDefinitionUpdateTool();
    const schema = tool.schema;
    // Schema should not have key or type fields
    expect((schema.shape as any).key).toBeUndefined();
    expect((schema.shape as any).type).toBeUndefined();
  });

  it("calls onMutation after success", async () => {
    const onMutation = jest.fn();
    await exec({ columnDefinitionId: "cd-1", label: "X" }, onMutation);
    expect(onMutation).toHaveBeenCalledTimes(1);
  });
});
