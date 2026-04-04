/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<(...a: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
const mockNormalize = jest.fn<(...a: unknown[]) => Promise<Record<string, unknown>>>().mockResolvedValue({ name: "Jane" });
const mockCreate = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: "rec-1" });

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/normalization.service.js", () => ({
  NormalizationService: { normalize: mockNormalize },
}));
const mockFindEntityById = jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: "ce-1", label: "My Entity" });

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: { create: mockCreate },
      connectorEntities: { findById: mockFindEntityById },
    },
  },
}));

const { EntityRecordCreateTool } = await import("../../tools/entity-record-create.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

interface Input { connectorEntityId: string; sourceId?: string; data: Record<string, unknown> }
const exec = (input: Input, onMutation?: () => void) =>
  new EntityRecordCreateTool().build("station-1", "org-1", "user-1", onMutation)
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("EntityRecordCreateTool", () => {
  it("creates record with auto-normalized data via NormalizationService", async () => {
    const result: any = await exec({ connectorEntityId: "ce-1", data: { Name: "Jane" } });
    expect(result.success).toBe(true);
    expect(mockNormalize).toHaveBeenCalledWith("ce-1", { Name: "Jane" });
    expect(mockCreate).toHaveBeenCalled();
  });

  it('sets origin: "portal" and checksum: "manual"', async () => {
    await exec({ connectorEntityId: "ce-1", data: { x: 1 } });
    const createdData = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createdData.origin).toBe("portal");
    expect(createdData.checksum).toBe("manual");
  });

  it("auto-generates UUID sourceId when omitted", async () => {
    await exec({ connectorEntityId: "ce-1", data: {} });
    const createdData = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createdData.sourceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses provided sourceId when given", async () => {
    await exec({ connectorEntityId: "ce-1", data: {}, sourceId: "custom-id" });
    const createdData = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createdData.sourceId).toBe("custom-id");
  });

  it("returns error when scope check fails", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope violation"));
    const result: any = await exec({ connectorEntityId: "ce-1", data: {} });
    expect(result.error).toBeDefined();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns error when write check fails", async () => {
    mockAssertWriteCapability.mockRejectedValueOnce(new Error("Write disabled"));
    const result: any = await exec({ connectorEntityId: "ce-1", data: {} });
    expect(result.error).toBeDefined();
  });

  it("calls onMutation after successful write", async () => {
    const onMutation = jest.fn();
    await exec({ connectorEntityId: "ce-1", data: {} }, onMutation);
    expect(onMutation).toHaveBeenCalledTimes(1);
  });

  it("does not call onMutation on failure", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("fail"));
    const onMutation = jest.fn();
    await exec({ connectorEntityId: "ce-1", data: {} }, onMutation);
    expect(onMutation).not.toHaveBeenCalled();
  });
});
