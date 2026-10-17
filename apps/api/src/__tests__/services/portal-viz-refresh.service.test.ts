import { describe, it, expect, jest } from "@jest/globals";

import { PortalVizRefreshService } from "../../services/portal-viz-refresh.service.js";
import type { VizRefreshDeps } from "../../services/portal-viz-refresh.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import { STALE_REFERENCE } from "../../services/portal-sql-validation.util.js";

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
      {
        messageId: "msg-1",
        blockIndex: 1,
        organizationId: "org-1",
        userId: "user-1",
      },
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
      { stationId: "st-1", organizationId: "org-1", userId: "user-1" }
    );
  });

  it("maps a handle delivery to the handle variant", async () => {
    const out = await PortalVizRefreshService.refresh(
      {
        messageId: "msg-1",
        blockIndex: 1,
        organizationId: "org-1",
        userId: "user-1",
      },
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
        {
          messageId: "nope",
          blockIndex: 1,
          organizationId: "org-1",
          userId: "user-1",
        },
        deps({ findMessageById: jest.fn(async () => undefined) as never })
      ),
      ApiCode.VIZ_WIDGET_NOT_FOUND,
      404
    );
  });

  it("out-of-range or non-d3 block → VIZ_WIDGET_NOT_FOUND (404)", async () => {
    await expectApiCode(
      PortalVizRefreshService.refresh(
        {
          messageId: "msg-1",
          blockIndex: 0,
          organizationId: "org-1",
          userId: "user-1",
        }, // the text block
        deps()
      ),
      ApiCode.VIZ_WIDGET_NOT_FOUND,
      404
    );
    await expectApiCode(
      PortalVizRefreshService.refresh(
        {
          messageId: "msg-1",
          blockIndex: 9,
          organizationId: "org-1",
          userId: "user-1",
        }, // out of range
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
      {
        messageId: "msg-1",
        blockIndex: 0,
        organizationId: "org-1",
        userId: "user-1",
      },
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
      {
        messageId: "msg-1",
        blockIndex: 0,
        organizationId: "org-1",
        userId: "user-1",
      },
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
        {
          messageId: "msg-1",
          blockIndex: 1,
          organizationId: "other-org",
          userId: "user-1",
        },
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
        {
          messageId: "msg-1",
          blockIndex: 0,
          organizationId: "org-1",
          userId: "user-1",
        },
        deps({ findMessageById: jest.fn(async () => noPipeline) as never })
      ),
      ApiCode.VIZ_WIDGET_NOT_REFRESHABLE,
      422
    );
  });
});

describe("PortalVizRefreshService.refresh → data-table (#349)", () => {
  function tableMessage(content: Record<string, unknown>) {
    return {
      id: "msg-1",
      organizationId: "org-1",
      portalId: "portal-1",
      role: "assistant",
      blocks: [{ type: "data-table", content }],
    } as never;
  }

  const inlineTable = {
    type: "data-table",
    columns: ["month", "total"],
    rows: [{ month: "Jan", total: 12 }],
    pipeline: PIPELINE,
  };

  it("re-executes an inline data-table block's pipeline", async () => {
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const out = await PortalVizRefreshService.refresh(
      {
        messageId: "msg-1",
        blockIndex: 0,
        organizationId: "org-1",
        userId: "user-1",
      },
      deps({
        findMessageById: jest.fn(async () =>
          tableMessage(inlineTable)
        ) as never,
        resolveSqlDelivery: resolveSqlDelivery as never,
      })
    );
    expect(out).toEqual({
      kind: "inline",
      rows: [{ month: "Jan", total: 12 }],
    });
    expect(resolveSqlDelivery).toHaveBeenCalledWith(
      { sql: PIPELINE.sql },
      { stationId: "st-1", organizationId: "org-1", userId: "user-1" }
    );
  });

  it("maps a large re-execution to the handle variant", async () => {
    const out = await PortalVizRefreshService.refresh(
      {
        messageId: "msg-1",
        blockIndex: 0,
        organizationId: "org-1",
        userId: "user-1",
      },
      deps({
        findMessageById: jest.fn(async () =>
          tableMessage(inlineTable)
        ) as never,
        resolveSqlDelivery: jest.fn(async () => handleDelivery) as never,
      })
    );
    expect(out).toMatchObject({ kind: "handle", queryHandle: "qh-fresh" });
  });

  it("refreshes a handle-backed data-table block", async () => {
    const out = await PortalVizRefreshService.refresh(
      {
        messageId: "msg-1",
        blockIndex: 0,
        organizationId: "org-1",
        userId: "user-1",
      },
      deps({
        findMessageById: jest.fn(async () =>
          tableMessage({
            type: "data-table",
            queryHandle: "qh-old",
            rowCount: 9000,
            pipeline: PIPELINE,
          })
        ) as never,
      })
    );
    expect(out).toMatchObject({ kind: "inline" });
  });

  /**
   * The deliberate status change in #349: a pre-#349 table block used to 404
   * (wrong block type) and now 422s (right type, no durable pipeline). 422 is
   * the honest answer and the one `useWidgetRefresh` already renders as
   * `notRefreshable`.
   */
  it("legacy data-table block without a pipeline → VIZ_WIDGET_NOT_REFRESHABLE (422, not 404)", async () => {
    await expectApiCode(
      PortalVizRefreshService.refresh(
        {
          messageId: "msg-1",
          blockIndex: 0,
          organizationId: "org-1",
          userId: "user-1",
        },
        deps({
          findMessageById: jest.fn(async () =>
            tableMessage({
              type: "data-table",
              columns: ["a"],
              rows: [{ a: 1 }],
            })
          ) as never,
        })
      ),
      ApiCode.VIZ_WIDGET_NOT_REFRESHABLE,
      422
    );
  });

  it("a block type outside the refreshable set still → VIZ_WIDGET_NOT_FOUND (404)", async () => {
    const mutation = {
      id: "msg-1",
      organizationId: "org-1",
      portalId: "portal-1",
      role: "assistant",
      blocks: [{ type: "mutation-result", content: { pipeline: PIPELINE } }],
    } as never;
    await expectApiCode(
      PortalVizRefreshService.refresh(
        {
          messageId: "msg-1",
          blockIndex: 0,
          organizationId: "org-1",
          userId: "user-1",
        },
        deps({ findMessageById: jest.fn(async () => mutation) as never })
      ),
      ApiCode.VIZ_WIDGET_NOT_FOUND,
      404
    );
  });

  it("cross-org caller → VIZ_WIDGET_NOT_FOUND (404, no existence leak)", async () => {
    await expectApiCode(
      PortalVizRefreshService.refresh(
        {
          messageId: "msg-1",
          blockIndex: 0,
          organizationId: "org-OTHER",
          userId: "user-1",
        },
        deps({
          findMessageById: jest.fn(async () =>
            tableMessage(inlineTable)
          ) as never,
        })
      ),
      ApiCode.VIZ_WIDGET_NOT_FOUND,
      404
    );
  });

  /**
   * The acceptance criterion that motivated the ticket: a "top N" table
   * re-runs the FULL original SELECT, so the result *set* changes — a
   * newly-largest row appears, rather than the existing rows merely restating
   * themselves. Nothing is parameterized or replayed by id.
   */
  it("a top-N query re-runs the full SELECT, so the row SET can change", async () => {
    const topN = {
      ...inlineTable,
      rows: [{ name: "Cedar Flat", acres: 388 }],
      pipeline: {
        ...PIPELINE,
        sql: "SELECT name, acres FROM parcels ORDER BY acres DESC LIMIT 1",
      },
    };
    const resolveSqlDelivery = jest.fn(async () => ({
      kind: "inline" as const,
      // A bigger parcel now exists — a different row, not an updated one.
      result: { rows: [{ name: "New Burn", acres: 902 }] },
    }));

    const out = await PortalVizRefreshService.refresh(
      {
        messageId: "msg-1",
        blockIndex: 0,
        organizationId: "org-1",
        userId: "user-1",
      },
      deps({
        findMessageById: jest.fn(async () => tableMessage(topN)) as never,
        resolveSqlDelivery: resolveSqlDelivery as never,
      })
    );

    expect(resolveSqlDelivery).toHaveBeenCalledWith(
      { sql: topN.pipeline.sql },
      { stationId: "st-1", organizationId: "org-1", userId: "user-1" }
    );
    expect(out).toEqual({
      kind: "inline",
      rows: [{ name: "New Burn", acres: 902 }],
    });
  });
});

// #727: a stored pipeline naming a column (or view) the caller's views no
// longer expose was refused by the SQL layer, then answered 500. It's a
// widget that can't be refreshed until its prompt is re-run: the 422 the web
// already shows as "can't auto-refresh — re-run the prompt".
describe("PortalVizRefreshService — stale pipelines (#727)", () => {
  const unknownColumn = () =>
    jest.fn(async () => {
      throw new ApiError(
        400,
        ApiCode.PORTAL_SQL_FORBIDDEN,
        "unknown column: c_name",
        { reason: STALE_REFERENCE }
      );
    });

  it("widget refresh: an unknown column → VIZ_WIDGET_NOT_REFRESHABLE (422)", async () => {
    await expectApiCode(
      PortalVizRefreshService.refresh(
        {
          messageId: "msg-1",
          blockIndex: 1,
          organizationId: "org-1",
          userId: "user-1",
        },
        deps({ resolveSqlDelivery: unknownColumn() as never })
      ),
      ApiCode.VIZ_WIDGET_NOT_REFRESHABLE,
      422
    );
  });

  it("a PORTAL_SQL_FORBIDDEN that isn't a stale reference still propagates", async () => {
    await expectApiCode(
      PortalVizRefreshService.refresh(
        {
          messageId: "msg-1",
          blockIndex: 1,
          organizationId: "org-1",
          userId: "user-1",
        },
        deps({
          resolveSqlDelivery: jest.fn(async () => {
            throw new ApiError(
              400,
              ApiCode.PORTAL_SQL_FORBIDDEN,
              "unknown entity: lookalike, but not a stale-reference refusal"
            );
          }) as never,
        })
      ),
      ApiCode.PORTAL_SQL_FORBIDDEN,
      400
    );
  });

  it("any other failure still propagates as itself", async () => {
    await expectApiCode(
      PortalVizRefreshService.refresh(
        {
          messageId: "msg-1",
          blockIndex: 1,
          organizationId: "org-1",
          userId: "user-1",
        },
        deps({
          resolveSqlDelivery: jest.fn(async () => {
            throw new ApiError(
              400,
              ApiCode.PORTAL_SQL_TIMEOUT,
              "query timed out (30s)"
            );
          }) as never,
        })
      ),
      ApiCode.PORTAL_SQL_TIMEOUT,
      400
    );
  });
});

// ── #640: live, definer's-rights pin reads ─────────────────────────────────

describe("PortalVizRefreshService.executePin (#640)", () => {
  const pinRow = (content: Record<string, unknown> = { pipeline: PIPELINE }) =>
    ({
      id: "pin-1",
      organizationId: "org-1",
      stationId: "st-1",
      type: "d3",
      content: { program: "api.d3;", ...content },
      createdBy: "definer-1",
      definerPrincipalType: "user",
      definerPrincipalId: "definer-1",
    }) as never;
  const sharee = { userId: "sharee-1", canWrite: false };
  const manager = { userId: "admin-1", canWrite: true };
  const activeDefiner = () =>
    jest.fn(async () => ({ userId: "definer-1" })) as never;
  const lostDefiner = () =>
    jest.fn(async () => {
      const { DefinerAccessLostError } =
        await import("../../services/pin-definer.service.js");
      throw new DefinerAccessLostError("pin-1");
    }) as never;

  it("executes as the definer, not the viewer, in the pin's own org", async () => {
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const out = await PortalVizRefreshService.executePin(pinRow(), sharee, {
      resolveSqlDelivery: resolveSqlDelivery as never,
      assertDefinerActive: activeDefiner(),
    });
    expect(out).toEqual({
      kind: "inline",
      rows: [{ month: "Jan", total: 12 }],
    });
    expect(resolveSqlDelivery).toHaveBeenCalledWith(
      { sql: PIPELINE.sql },
      {
        stationId: "st-1",
        organizationId: "org-1",
        userId: "definer-1",
        portalResultId: "pin-1",
      }
    );
  });

  it("returns a large result as a handle that belongs to the pin", async () => {
    const out = await PortalVizRefreshService.executePin(pinRow(), sharee, {
      resolveSqlDelivery: jest.fn(async () => handleDelivery) as never,
      assertDefinerActive: activeDefiner(),
    });
    expect(out).toMatchObject({ kind: "handle", queryHandle: "qh-fresh" });
  });

  it("returns an ordinary empty result when the definer's views match no rows", async () => {
    const out = await PortalVizRefreshService.executePin(pinRow(), sharee, {
      resolveSqlDelivery: jest.fn(async () => ({
        kind: "inline",
        result: { rows: [] },
      })) as never,
      assertDefinerActive: activeDefiner(),
    });
    expect(out).toEqual({ kind: "inline", rows: [] });
  });

  it("a pin with no stored query → PORTAL_RESULT_NOT_REEXECUTABLE (422), without executing", async () => {
    const resolveSqlDelivery = jest.fn();
    await expectApiCode(
      PortalVizRefreshService.executePin(
        pinRow({ pipeline: undefined }),
        manager,
        {
          resolveSqlDelivery: resolveSqlDelivery as never,
          assertDefinerActive: activeDefiner(),
        }
      ),
      ApiCode.PORTAL_RESULT_NOT_REEXECUTABLE,
      422
    );
    expect(resolveSqlDelivery).not.toHaveBeenCalled();
  });

  it("a removed definer: neutral for a reader, the reason for a manager", async () => {
    const resolveSqlDelivery = jest.fn();
    await expectApiCode(
      PortalVizRefreshService.executePin(pinRow(), sharee, {
        resolveSqlDelivery: resolveSqlDelivery as never,
        assertDefinerActive: lostDefiner(),
      }),
      ApiCode.PORTAL_RESULT_DATA_UNAVAILABLE,
      422
    );
    await expectApiCode(
      PortalVizRefreshService.executePin(pinRow(), manager, {
        resolveSqlDelivery: resolveSqlDelivery as never,
        assertDefinerActive: lostDefiner(),
      }),
      ApiCode.PORTAL_RESULT_DEFINER_ACCESS_LOST,
      422
    );
    expect(resolveSqlDelivery).not.toHaveBeenCalled();
  });

  it("a query naming a view the definer lost is the same access loss", async () => {
    const stale = jest.fn(async () => {
      throw new ApiError(400, ApiCode.PORTAL_SQL_FORBIDDEN, "unknown entity", {
        reason: STALE_REFERENCE,
      });
    });
    await expectApiCode(
      PortalVizRefreshService.executePin(pinRow(), sharee, {
        resolveSqlDelivery: stale as never,
        assertDefinerActive: activeDefiner(),
      }),
      ApiCode.PORTAL_RESULT_DATA_UNAVAILABLE,
      422
    );
  });

  describe("a tiled map pin", () => {
    const tiledPin = () =>
      ({
        ...(pinRow() as object),
        type: "geo",
        content: { spec: {}, tiled: true, pipeline: PIPELINE },
      }) as never;

    it("plans the query as the definer and answers tiles, without running it", async () => {
      const resolveSqlDelivery = jest.fn();
      const explainSqlQuery = jest.fn(async () => ({
        totalCost: 1,
        estimatedRows: 1,
      }));
      const out = await PortalVizRefreshService.executePin(tiledPin(), sharee, {
        resolveSqlDelivery: resolveSqlDelivery as never,
        explainSqlQuery: explainSqlQuery as never,
        assertDefinerActive: activeDefiner(),
      });
      expect(out).toEqual({ kind: "tiles" });
      expect(explainSqlQuery).toHaveBeenCalledWith({
        sql: PIPELINE.sql,
        stationId: PIPELINE.stationId,
        organizationId: "org-1",
        userId: "definer-1",
      });
      expect(resolveSqlDelivery).not.toHaveBeenCalled();
    });

    it("a view the definer lost is the same access loss", async () => {
      const explainSqlQuery = jest.fn(async () => {
        throw new ApiError(
          400,
          ApiCode.PORTAL_SQL_FORBIDDEN,
          "unknown entity",
          {
            reason: STALE_REFERENCE,
          }
        );
      });
      await expectApiCode(
        PortalVizRefreshService.executePin(tiledPin(), manager, {
          explainSqlQuery: explainSqlQuery as never,
          assertDefinerActive: activeDefiner(),
        }),
        ApiCode.PORTAL_RESULT_DEFINER_ACCESS_LOST,
        422
      );
    });

    it("a removed definer is refused before planning", async () => {
      const explainSqlQuery = jest.fn();
      await expectApiCode(
        PortalVizRefreshService.executePin(tiledPin(), sharee, {
          explainSqlQuery: explainSqlQuery as never,
          assertDefinerActive: lostDefiner(),
        }),
        ApiCode.PORTAL_RESULT_DATA_UNAVAILABLE,
        422
      );
      expect(explainSqlQuery).not.toHaveBeenCalled();
    });

    it("an untiled map pin still runs its query", async () => {
      const resolveSqlDelivery = jest.fn(async () => ({
        kind: "inline",
        result: { rows: [] },
      }));
      const explainSqlQuery = jest.fn();
      const untiled = {
        ...(pinRow() as object),
        type: "geo",
        content: { spec: {}, pipeline: PIPELINE },
      } as never;
      await PortalVizRefreshService.executePin(untiled, sharee, {
        resolveSqlDelivery: resolveSqlDelivery as never,
        explainSqlQuery: explainSqlQuery as never,
        sqlQuery: jest.fn() as never,
        assertDefinerActive: activeDefiner(),
      });
      expect(resolveSqlDelivery).toHaveBeenCalled();
      expect(explainSqlQuery).not.toHaveBeenCalled();
    });
  });

  it("any other failure propagates as itself", async () => {
    const boom = jest.fn(async () => {
      throw new ApiError(503, ApiCode.PORTAL_SQL_UNAVAILABLE, "no reader role");
    });
    await expectApiCode(
      PortalVizRefreshService.executePin(pinRow(), sharee, {
        resolveSqlDelivery: boom as never,
        assertDefinerActive: activeDefiner(),
      }),
      ApiCode.PORTAL_SQL_UNAVAILABLE,
      503
    );
  });
});
