/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUpsertByKey = jest.fn<any>().mockResolvedValue({ id: "cd-1" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { columnDefinitions: { upsertByKey: mockUpsertByKey } } },
}));

const { ColumnDefinitionCreateTool } = await import("../../tools/column-definition-create.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { organizationId: string; key: string; label: string; type: string; required?: boolean; enumValues?: string[]; description?: string }
const exec = (input: Input, onMutation?: () => void) =>
  new ColumnDefinitionCreateTool().build("org-1", "user-1", onMutation)
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ColumnDefinitionCreateTool", () => {
  it("upserts by key", async () => {
    const result: any = await exec({ organizationId: "org-1", key: "email", label: "Email", type: "text" });
    expect(result.success).toBe(true);
    expect(result.columnDefinitionId).toBe("cd-1");
    expect(mockUpsertByKey).toHaveBeenCalledWith(expect.objectContaining({ key: "email", label: "Email" }));
  });

  it("does not require station scope or write capability", async () => {
    const result: any = await exec({ organizationId: "org-1", key: "k", label: "L", type: "text" });
    expect(result.success).toBe(true);
  });

  it("calls onMutation after success", async () => {
    const onMutation = jest.fn();
    await exec({ organizationId: "org-1", key: "k", label: "L", type: "text" }, onMutation);
    expect(onMutation).toHaveBeenCalledTimes(1);
  });
});
