/**
 * PortalResultPinService.materialize (#312, recast by #640): per-type
 * validation + the **recipe** a pin persists — its query and how to draw it,
 * never rows. All deps injected — no Redis, no DB.
 */
import { jest, describe, it, expect } from "@jest/globals";

import { PortalResultPinService } from "../../services/portal-result-pin.service.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

const SCOPE = { stationId: "station-1", organizationId: "org-1" };

const PIPELINE = {
  sql: "SELECT region, total FROM sales",
  stationId: "station-1",
  organizationId: "org-1",
};

const expiredError = () =>
  new ApiError(404, ApiCode.READ_HANDLE_EXPIRED, "expired");

/** Everything a source block may carry that a pin must not keep. */
const DATA_BEARING = {
  rows: [{ region: "NE", total: 7 }],
  samplePeek: [{ region: "NE", total: 7 }],
  rowCount: 1,
  matchedCount: 1,
  matchedCountExact: true,
  truncated: false,
  sampled: false,
  schema: [
    { name: "region", type: "text" },
    { name: "total", type: "numeric" },
  ],
};

describe("PortalResultPinService.materialize", () => {
  // ── text ────────────────────────────────────────────────────────────

  it("passes a text block through", async () => {
    const result = await PortalResultPinService.materialize(
      "text",
      "## Total revenue: $1.2M",
      SCOPE
    );
    expect(result.content).toBe("## Total revenue: $1.2M");
  });

  it("rejects text content that is not a string", async () => {
    await expect(
      PortalResultPinService.materialize("text", { body: "x" }, SCOPE)
    ).rejects.toMatchObject({
      code: ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
    });
  });

  it("rejects a type with no pinned-content contract", async () => {
    await expect(
      PortalResultPinService.materialize(
        "bulk-job-progress" as never,
        {},
        SCOPE
      )
    ).rejects.toMatchObject({
      code: ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
    });
  });

  // ── #640: a recipe, never rows ──────────────────────────────────────

  it("keeps a data-table's query and columns, and none of its data", async () => {
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        type: "data-table",
        columns: ["region", "total"],
        pipeline: PIPELINE,
        ...DATA_BEARING,
      },
      SCOPE
    );
    expect(result.content).toEqual({
      columns: ["region", "total"],
      pipeline: PIPELINE,
    });
  });

  it("names a handle table's columns from its schema", async () => {
    const result = await PortalResultPinService.materialize(
      "data-table",
      { queryHandle: "qh-1", ...DATA_BEARING, sql: PIPELINE.sql },
      SCOPE
    );
    expect(result.content).toEqual({
      columns: ["region", "total"],
      pipeline: PIPELINE,
    });
  });

  it("keeps a chart's program, title and params with its query", async () => {
    const result = await PortalResultPinService.materialize(
      "d3",
      {
        program: "api.d3;",
        title: "Sales",
        params: { color: "teal" },
        pipeline: PIPELINE,
        ...DATA_BEARING,
      },
      SCOPE
    );
    expect(result.content).toEqual({
      program: "api.d3;",
      title: "Sales",
      params: { color: "teal" },
      pipeline: PIPELINE,
    });
  });

  it("keeps a map's spec, and marks a handle-backed map tiled", async () => {
    const spec = {
      layers: [{ kind: "points", source: { geometryColumn: "geom" } }],
    };
    const inline = await PortalResultPinService.materialize(
      "geo",
      { spec, pipeline: PIPELINE, ...DATA_BEARING },
      SCOPE
    );
    expect(inline.content).toEqual({
      spec: expect.objectContaining(spec),
      pipeline: PIPELINE,
    });

    const large = await PortalResultPinService.materialize(
      "geo",
      { spec, pipeline: PIPELINE, queryHandle: "qh-1", rowCount: 9000 },
      SCOPE
    );
    expect(large.content).toEqual({
      spec: expect.objectContaining(spec),
      pipeline: PIPELINE,
      tiled: true,
    });
  });

  // ── where the query comes from ──────────────────────────────────────

  it("derives the query from a block's sql", async () => {
    const result = await PortalResultPinService.materialize(
      "data-table",
      { columns: ["region"], sql: PIPELINE.sql, rows: [] },
      SCOPE
    );
    expect((result.content as { pipeline: unknown }).pipeline).toEqual(
      PIPELINE
    );
  });

  it("derives the query from the handle's retained sql when the block omits it", async () => {
    const getMeta = jest.fn(async () => ({ sql: PIPELINE.sql }));
    const result = await PortalResultPinService.materialize(
      "data-table",
      { columns: ["region"], queryHandle: "qh-1" },
      SCOPE,
      { getMeta: getMeta as never }
    );
    expect(getMeta).toHaveBeenCalledWith("qh-1");
    expect((result.content as { pipeline: unknown }).pipeline).toEqual(
      PIPELINE
    );
  });

  it("refuses rows supplied with no query (nothing to re-run)", async () => {
    await expect(
      PortalResultPinService.materialize(
        "data-table",
        { columns: ["region"], rows: [{ region: "NE" }], sql: null },
        SCOPE
      )
    ).rejects.toMatchObject({
      status: 422,
      code: ApiCode.PORTAL_RESULT_NOT_REEXECUTABLE,
    });
  });

  it("refuses a handle that has expired, rather than pinning a snapshot", async () => {
    await expect(
      PortalResultPinService.materialize(
        "data-table",
        { columns: ["region"], queryHandle: "qh-gone" },
        SCOPE,
        {
          getMeta: jest.fn(async () => {
            throw expiredError();
          }) as never,
        }
      )
    ).rejects.toMatchObject({ code: ApiCode.PORTAL_RESULT_NOT_REEXECUTABLE });
  });

  it("refuses a handle whose meta retains no sql (a transform)", async () => {
    await expect(
      PortalResultPinService.materialize(
        "data-table",
        { columns: ["region"], queryHandle: "qh-t" },
        SCOPE,
        { getMeta: jest.fn(async () => ({})) as never }
      )
    ).rejects.toMatchObject({ code: ApiCode.PORTAL_RESULT_NOT_REEXECUTABLE });
  });

  it("lets any other handle failure propagate", async () => {
    await expect(
      PortalResultPinService.materialize(
        "data-table",
        { columns: ["region"], queryHandle: "qh-1" },
        SCOPE,
        {
          getMeta: jest.fn(async () => {
            throw new Error("redis down");
          }) as never,
        }
      )
    ).rejects.toThrow("redis down");
  });

  it("rejects a chart whose recipe doesn't match the contract", async () => {
    await expect(
      PortalResultPinService.materialize(
        "d3",
        { program: "", pipeline: PIPELINE },
        SCOPE
      )
    ).rejects.toMatchObject({ code: ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE });
  });
});
