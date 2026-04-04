/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockValidateDelete = jest.fn<any>().mockResolvedValue(undefined);
const mockFindById = jest.fn<any>().mockResolvedValue({ id: "cd-1", organizationId: "org-1", key: "email", label: "Email" });
const mockSoftDelete = jest.fn<any>().mockResolvedValue({ id: "cd-1" });

jest.unstable_mockModule("../../services/column-definition-validation.service.js", () => ({
  ColumnDefinitionValidationService: { validateDelete: mockValidateDelete },
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { columnDefinitions: { findById: mockFindById, softDelete: mockSoftDelete } } },
}));

const { ColumnDefinitionDeleteTool } = await import("../../tools/column-definition-delete.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { columnDefinitionId: string }
const exec = (input: Input, onMutation?: () => void) =>
  new ColumnDefinitionDeleteTool().build("org-1", "user-1", onMutation)
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ColumnDefinitionDeleteTool", () => {
  it("deletes successfully when no dependencies", async () => {
    const result: any = await exec({ columnDefinitionId: "cd-1" });
    expect(result.success).toBe(true);
    expect(mockSoftDelete).toHaveBeenCalledWith("cd-1", "user-1");
  });

  it("returns error when field mappings reference it", async () => {
    mockValidateDelete.mockRejectedValueOnce(new Error("Has dependencies"));
    const result: any = await exec({ columnDefinitionId: "cd-1" });
    expect(result.error).toBeDefined();
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it("calls onMutation after success", async () => {
    const onMutation = jest.fn();
    await exec({ columnDefinitionId: "cd-1" }, onMutation);
    expect(onMutation).toHaveBeenCalledTimes(1);
  });
});
