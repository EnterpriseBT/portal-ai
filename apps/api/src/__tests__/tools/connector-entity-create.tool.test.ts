/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFindByStationId = jest
  .fn<() => Promise<unknown[]>>()
  .mockResolvedValue([{ connectorInstanceId: "ci-1", stationId: "station-1" }]);
const mockFindInstanceById = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({
    id: "ci-1",
    organizationId: "org-1",
    connectorDefinitionId: "cd-1",
    enabledCapabilityFlags: null,
  });
const mockFindDefinitionById = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({
    id: "cd-1",
    capabilityFlags: { read: true, write: true },
  });
const mockUpsertByKey = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({ id: "ce-new" });
const mockTransaction = jest
  .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule(
  "../../db/repositories/station-instances.repository.js",
  () => ({
    stationInstancesRepo: { findByStationId: mockFindByStationId },
  })
);
jest.unstable_mockModule(
  "../../db/repositories/connector-definitions.repository.js",
  () => ({
    connectorDefinitionsRepo: { findById: mockFindDefinitionById },
  })
);
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorInstances: { findById: mockFindInstanceById },
      connectorEntities: { upsertByKey: mockUpsertByKey },
    },
  },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyEntityInsertMany: jest.fn() },
}));
jest.unstable_mockModule("../../db/repositories/base.repository.js", () => {
  class MockRepository {
    static transaction = mockTransaction;
  }
  return { Repository: MockRepository };
});

const { ConnectorEntityCreateTool } =
  await import("../../tools/connector-entity-create.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

type Item = { connectorInstanceId: string; key: string; label: string };
const exec = (input: { items: Item[] }) =>
  new ConnectorEntityCreateTool().build("station-1", "user-1").execute!(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });

describe("ConnectorEntityCreateTool", () => {
  it("single-item regression — creates entity via upsertByKey", async () => {
    const result: any = await exec({
      items: [
        { connectorInstanceId: "ci-1", key: "contacts", label: "Contacts" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].entityId).toBe("ce-new");
    expect(mockUpsertByKey).toHaveBeenCalledWith(
      expect.objectContaining({ key: "contacts", label: "Contacts" }),
      "mock-tx"
    );
  });

  it("bulk create — 3 entities in transaction", async () => {
    mockUpsertByKey
      .mockResolvedValueOnce({ id: "ce-1" })
      .mockResolvedValueOnce({ id: "ce-2" })
      .mockResolvedValueOnce({ id: "ce-3" });

    const result: any = await exec({
      items: [
        { connectorInstanceId: "ci-1", key: "a", label: "A" },
        { connectorInstanceId: "ci-1", key: "b", label: "B" },
        { connectorInstanceId: "ci-1", key: "c", label: "C" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockFindByStationId).toHaveBeenCalledTimes(1);
    expect(mockFindInstanceById).toHaveBeenCalledTimes(1); // grouped by ci-1
    expect(mockUpsertByKey).toHaveBeenCalledTimes(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("bulk create — mixed connectorInstanceIds", async () => {
    mockFindByStationId.mockResolvedValueOnce([
      { connectorInstanceId: "ci-1", stationId: "station-1" },
      { connectorInstanceId: "ci-2", stationId: "station-1" },
    ]);
    mockFindInstanceById
      .mockResolvedValueOnce({
        id: "ci-1",
        organizationId: "org-1",
        connectorDefinitionId: "cd-1",
        enabledCapabilityFlags: null,
      })
      .mockResolvedValueOnce({
        id: "ci-2",
        organizationId: "org-1",
        connectorDefinitionId: "cd-1",
        enabledCapabilityFlags: null,
      });
    mockUpsertByKey
      .mockResolvedValueOnce({ id: "ce-1" })
      .mockResolvedValueOnce({ id: "ce-2" });

    const result: any = await exec({
      items: [
        { connectorInstanceId: "ci-1", key: "a", label: "A" },
        { connectorInstanceId: "ci-2", key: "b", label: "B" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(mockFindInstanceById).toHaveBeenCalledTimes(2);
  });

  it("validation failure — instance not attached to station", async () => {
    const result: any = await exec({
      items: [{ connectorInstanceId: "ci-other", key: "k", label: "L" }],
    });

    expect(result.success).toBe(false);
    expect(result.failures[0].error).toContain("not attached");
    expect(mockUpsertByKey).not.toHaveBeenCalled();
  });

  it("validation failure — write capability disabled", async () => {
    mockFindDefinitionById.mockResolvedValueOnce({
      id: "cd-1",
      capabilityFlags: { read: true, write: false },
    });

    const result: any = await exec({
      items: [{ connectorInstanceId: "ci-1", key: "k", label: "L" }],
    });

    expect(result.success).toBe(false);
    expect(result.failures[0].error).toContain("write capability");
    expect(mockUpsertByKey).not.toHaveBeenCalled();
  });
});
