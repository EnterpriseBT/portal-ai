import { describe, it, expect, jest } from "@jest/globals";

import { PortalVizRefreshService } from "../../services/portal-viz-refresh.service.js";
import type {
  VizRefreshDeps,
  PinRefreshDeps,
} from "../../services/portal-viz-refresh.service.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

// The service loads the persisted message + re-executes its pipeline. Both the
// message loader and resolveSqlDelivery are injected via the deps seam so the
// test drives every branch without a DB row or a live SQL run (#270 slice 2).

const PIPELINE = {
  sql: "SELECT month, total FROM sales",
  stationId: "st-1",
  organizationId: "org-1",
};

// Persisted display blocks are wrapped `{ type, content }` — the d3 tool
// result (program, pipeline, …) rides under `content` (resolveDisplayBlock).
function d3Message(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    organizationId: "org-1",
    portalId: "portal-1",
    role: "assistant",
    blocks: [
      { type: "text", content: "here" },
      {
        type: "d3",
        content: { type: "d3", program: "api.d3;", pipeline: PIPELINE },
      },
    ],
    ...overrides,
  } as never;
}

const inlineDelivery = {
  kind: "inline" as const,
  result: { rows: [{ month: "Jan", total: 12 }] },
};
const handleDelivery = {
  kind: "handle" as const,
  envelope: {
    queryHandle: "qh-fresh",
    rowCount: 5000,
    schema: [{ name: "month", type: "text" }],
    sampled: false,
    truncated: false,
    samplePeek: [],
    sql: PIPELINE.sql,
  },
};

function deps(over: Partial<VizRefreshDeps> = {}): VizRefreshDeps {
  return {
    findMessageById: jest.fn(async () => d3Message()) as never,
    resolveSqlDelivery: jest.fn(async () => inlineDelivery) as never,
    ...over,
  };
}

async function expectApiCode(
  p: Promise<unknown>,
  code: ApiCode,
  status: number
) {
  await expect(p).rejects.toMatchObject({ code, status });
}

describe("PortalVizRefreshService.refresh (#270)", () => {
  it("re-executes the pipeline and maps an inline delivery", async () => {
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const out = await PortalVizRefreshService.refresh(
      { messageId: "msg-1", blockIndex: 1, organizationId: "org-1" },
      deps({ resolveSqlDelivery: resolveSqlDelivery as never })
    );
    expect(out).toEqual({
      kind: "inline",
      rows: [{ month: "Jan", total: 12 }],
    });
    // Re-executed under the pipeline's station + the caller's org, using the
    // pipeline's SQL — never client input.
    expect(resolveSqlDelivery).toHaveBeenCalledWith(
      { sql: PIPELINE.sql },
      { stationId: "st-1", organizationId: "org-1" }
    );
  });

  it("maps a handle delivery to the handle variant", async () => {
    const out = await PortalVizRefreshService.refresh(
      { messageId: "msg-1", blockIndex: 1, organizationId: "org-1" },
      deps({ resolveSqlDelivery: jest.fn(async () => handleDelivery) as never })
    );
    expect(out).toMatchObject({
      kind: "handle",
      queryHandle: "qh-fresh",
      rowCount: 5000,
    });
  });

  it("missing message → VIZ_WIDGET_NOT_FOUND (404)", async () => {
    await expectApiCode(
      PortalVizRefreshService.refresh(
        { messageId: "nope", blockIndex: 1, organizationId: "org-1" },
        deps({ findMessageById: jest.fn(async () => undefined) as never })
      ),
      ApiCode.VIZ_WIDGET_NOT_FOUND,
      404
    );
  });

  it("out-of-range or non-d3 block → VIZ_WIDGET_NOT_FOUND (404)", async () => {
    await expectApiCode(
      PortalVizRefreshService.refresh(
        { messageId: "msg-1", blockIndex: 0, organizationId: "org-1" }, // the text block
        deps()
      ),
      ApiCode.VIZ_WIDGET_NOT_FOUND,
      404
    );
    await expectApiCode(
      PortalVizRefreshService.refresh(
        { messageId: "msg-1", blockIndex: 9, organizationId: "org-1" }, // out of range
        deps()
      ),
      ApiCode.VIZ_WIDGET_NOT_FOUND,
      404
    );
  });

  it("refreshes a geo block (#314), re-executing its durable pipeline", async () => {
    const geoMessage = {
      id: "msg-1",
      organizationId: "org-1",
      portalId: "portal-1",
      role: "assistant",
      blocks: [
        {
          type: "geo",
          content: { type: "geo", spec: { layers: [] }, pipeline: PIPELINE },
        },
      ],
    } as never;
    const out = await PortalVizRefreshService.refresh(
      { messageId: "msg-1", blockIndex: 0, organizationId: "org-1" },
      deps({ findMessageById: jest.fn(async () => geoMessage) as never })
    );
    expect(out).toEqual({
      kind: "inline",
      rows: [{ month: "Jan", total: 12 }],
    });
  });

  it("geo inline refresh re-projects geometry columns to GeoJSON (#314)", async () => {
    const geoMessage = {
      id: "msg-1",
      organizationId: "org-1",
      portalId: "portal-1",
      role: "assistant",
      blocks: [
        {
          type: "geo",
          content: {
            type: "geo",
            spec: {
              layers: [
                { kind: "points", source: { geometryColumn: "c_geometry" } },
              ],
            },
            pipeline: PIPELINE,
          },
        },
      ],
    } as never;
    // Raw delivery hands back geometry as WKB hex; the display query re-projects
    // it to GeoJSON via the shared helper.
    const rawInline = {
      kind: "inline" as const,
      result: { rows: [{ c_geometry: "0101000020E6100000", name: "a" }] },
    };
    const sqlQuery = jest.fn(async () => ({
      rows: [
        {
          _row: {
            c_geometry: { type: "Point", coordinates: [-111.9, 40.7] },
            name: "a",
          },
        },
      ],
    }));
    const out = await PortalVizRefreshService.refresh(
      { messageId: "msg-1", blockIndex: 0, organizationId: "org-1" },
      deps({
        findMessageById: jest.fn(async () => geoMessage) as never,
        resolveSqlDelivery: jest.fn(async () => rawInline) as never,
        sqlQuery: sqlQuery as never,
      })
    );
    expect(out).toEqual({
      kind: "inline",
      rows: [
        {
          c_geometry: { type: "Point", coordinates: [-111.9, 40.7] },
          name: "a",
        },
      ],
    });
    // The re-projection query ran (ST_AsGeoJSON over the pipeline SQL).
    const calls = sqlQuery.mock.calls as unknown as Array<[{ sql: string }]>;
    expect(calls[0][0].sql).toContain("ST_AsGeoJSON");
  });

  it("cross-org caller → VIZ_WIDGET_NOT_FOUND (404, no existence leak)", async () => {
    await expectApiCode(
      PortalVizRefreshService.refresh(
        { messageId: "msg-1", blockIndex: 1, organizationId: "other-org" },
        deps()
      ),
      ApiCode.VIZ_WIDGET_NOT_FOUND,
      404
    );
  });

  it("d3 block without a pipeline → VIZ_WIDGET_NOT_REFRESHABLE (422)", async () => {
    const noPipeline = d3Message({
      blocks: [{ type: "d3", content: { type: "d3", program: "api.d3;" } }], // pre-#270 block
    });
    await expectApiCode(
      PortalVizRefreshService.refresh(
        { messageId: "msg-1", blockIndex: 0, organizationId: "org-1" },
        deps({ findMessageById: jest.fn(async () => noPipeline) as never })
      ),
      ApiCode.VIZ_WIDGET_NOT_REFRESHABLE,
      422
    );
  });
});

// ── refreshPinnedResult (#312) ───────────────────────────────────────

function pinRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pr-1",
    organizationId: "org-1",
    stationId: "st-1",
    portalId: "portal-1",
    messageId: null,
    blockIndex: null,
    name: "Pinned chart",
    type: "d3",
    content: {
      program: "api.d3;",
      rows: [{ month: "Dec", total: 1 }],
      pipeline: PIPELINE,
    },
    snapshotUpdatedAt: 111,
    created: 100,
    createdBy: "u-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  } as never;
}

function pinDeps(over: Partial<PinRefreshDeps> = {}): PinRefreshDeps {
  return {
    findPortalResultById: jest.fn(async () => pinRow()) as never,
    updatePortalResult: jest.fn(async () => pinRow()) as never,
    resolveSqlDelivery: jest.fn(async () => inlineDelivery) as never,
    getSnapshot: jest.fn(async () => ({
      rows: [{ month: "Jan", total: 12 }],
      total: 5000,
      offset: 0,
      limit: 5000,
    })) as never,
    ...over,
  };
}

describe("PortalVizRefreshService.refreshPinnedResult (#312)", () => {
  it("executes the row's pipeline and maps an inline delivery", async () => {
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const out = await PortalVizRefreshService.refreshPinnedResult(
      { portalResultId: "pr-1", organizationId: "org-1" },
      pinDeps({ resolveSqlDelivery: resolveSqlDelivery as never })
    );
    expect(out).toEqual({
      kind: "inline",
      rows: [{ month: "Jan", total: 12 }],
    });
    expect(resolveSqlDelivery).toHaveBeenCalledWith(
      { sql: PIPELINE.sql },
      { stationId: "st-1", organizationId: "org-1" }
    );
  });

  it("maps a handle delivery to the handle variant", async () => {
    const out = await PortalVizRefreshService.refreshPinnedResult(
      { portalResultId: "pr-1", organizationId: "org-1" },
      pinDeps({
        resolveSqlDelivery: jest.fn(async () => handleDelivery) as never,
      })
    );
    expect(out).toMatchObject({
      kind: "handle",
      queryHandle: "qh-fresh",
      rowCount: 5000,
    });
  });

  it("missing row → PORTAL_RESULT_NOT_FOUND (404)", async () => {
    await expectApiCode(
      PortalVizRefreshService.refreshPinnedResult(
        { portalResultId: "nope", organizationId: "org-1" },
        pinDeps({
          findPortalResultById: jest.fn(async () => undefined) as never,
        })
      ),
      ApiCode.PORTAL_RESULT_NOT_FOUND,
      404
    );
  });

  it("cross-org caller → PORTAL_RESULT_NOT_FOUND (404, no existence leak)", async () => {
    await expectApiCode(
      PortalVizRefreshService.refreshPinnedResult(
        { portalResultId: "pr-1", organizationId: "other-org" },
        pinDeps()
      ),
      ApiCode.PORTAL_RESULT_NOT_FOUND,
      404
    );
  });

  it("pin without a pipeline → VIZ_WIDGET_NOT_REFRESHABLE (422)", async () => {
    const staticPin = pinRow({
      type: "data-table",
      content: { columns: ["a"], rows: [{ a: 1 }] },
    });
    await expectApiCode(
      PortalVizRefreshService.refreshPinnedResult(
        { portalResultId: "pr-1", organizationId: "org-1" },
        pinDeps({
          findPortalResultById: jest.fn(async () => staticPin) as never,
        })
      ),
      ApiCode.VIZ_WIDGET_NOT_REFRESHABLE,
      422
    );
  });

  it("persists the fresh snapshot back onto the row (inline delivery)", async () => {
    const updatePortalResult = jest.fn(async () => pinRow());
    const before = Date.now();
    await PortalVizRefreshService.refreshPinnedResult(
      { portalResultId: "pr-1", organizationId: "org-1" },
      pinDeps({ updatePortalResult: updatePortalResult as never })
    );
    expect(updatePortalResult).toHaveBeenCalledTimes(1);
    const [id, patch] = updatePortalResult.mock.calls[0] as unknown as [
      string,
      {
        content: Record<string, unknown>;
        snapshotUpdatedAt: number;
      },
    ];
    expect(id).toBe("pr-1");
    // The stored content keeps its identity (program, pipeline) and swaps
    // in the fresh rows.
    expect(patch.content.program).toBe("api.d3;");
    expect(patch.content.pipeline).toEqual(PIPELINE);
    expect(patch.content.rows).toEqual([{ month: "Jan", total: 12 }]);
    expect(patch.content.rowCount).toBe(1);
    expect(patch.content.truncated).toBe(false);
    expect(patch.snapshotUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  it("hydrates the persist-back snapshot from a handle delivery", async () => {
    const updatePortalResult = jest.fn(async () => pinRow());
    const getSnapshot = jest.fn(async () => ({
      rows: [{ month: "Jan", total: 12 }],
      total: 5000,
      offset: 0,
      limit: 5000,
    }));
    await PortalVizRefreshService.refreshPinnedResult(
      { portalResultId: "pr-1", organizationId: "org-1" },
      pinDeps({
        resolveSqlDelivery: jest.fn(async () => handleDelivery) as never,
        updatePortalResult: updatePortalResult as never,
        getSnapshot: getSnapshot as never,
      })
    );
    expect(getSnapshot).toHaveBeenCalledWith(
      "qh-fresh",
      expect.objectContaining({ offset: 0 })
    );
    const [, patch] = updatePortalResult.mock.calls[0] as unknown as [
      string,
      { content: Record<string, unknown> },
    ];
    expect(patch.content.rowCount).toBe(5000);
    expect(patch.content.truncated).toBe(true);
  });

  it("a persist-back failure is non-fatal — the delivery still returns", async () => {
    const updatePortalResult = jest.fn(async () => {
      throw new Error("db blip");
    });
    const out = await PortalVizRefreshService.refreshPinnedResult(
      { portalResultId: "pr-1", organizationId: "org-1" },
      pinDeps({ updatePortalResult: updatePortalResult as never })
    );
    expect(out).toEqual({
      kind: "inline",
      rows: [{ month: "Jan", total: 12 }],
    });
  });
});
