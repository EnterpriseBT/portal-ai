/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockProduce = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../services/portal-sql-handle.service.js", () => ({
  PortalSqlHandleService: {
    produce: mockProduce,
  },
}));

const { DisplayEntityRecordsTool } =
  await import("../../tools/display-entity-records.tool.js");

async function run(input: { entityKey: string; columns?: string[] }) {
  const t = new DisplayEntityRecordsTool().build(
    "station-1",
    "org-1",
    "user-1"
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (t as any).execute(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  })) as Record<string, unknown>;
}

beforeEach(() => {
  mockProduce.mockReset();
  mockProduce.mockResolvedValue({
    envelope: {
      queryHandle: "qh-1",
      rowCount: 3,
      schema: [{ name: "c_name", type: "text" }],
      samplePeek: [{ c_name: "Acme" }],
      sampled: false,
      sql: 'SELECT * FROM "contacts"',
    },
  });
});

describe("display_entity_records", () => {
  it("#1038: carries the pipeline that re-runs it as the reader", async () => {
    const result = await run({
      entityKey: "contacts",
      columns: ["c_name"],
    });

    expect(result.type).toBe("data-table");
    expect(result.queryHandle).toBe("qh-1");
    expect(result.pipeline).toEqual({
      sql: 'SELECT "c_name" FROM "contacts"',
      stationId: "station-1",
      organizationId: "org-1",
    });
  });
});
