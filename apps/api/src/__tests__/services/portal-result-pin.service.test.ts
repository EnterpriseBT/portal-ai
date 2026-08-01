/**
 * PortalResultPinService.materialize (#312): per-type validation + the
 * self-contained snapshot a pin persists. All deps injected — no Redis, no DB.
 */
import { jest, describe, it, expect } from "@jest/globals";
import { PIN_SNAPSHOT_ROW_CAP } from "@portalai/core/constants";

import { PortalResultPinService } from "../../services/portal-result-pin.service.js";
import type { MaterializeDeps } from "../../services/portal-result-pin.service.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

const SCOPE = { stationId: "station-1", organizationId: "org-1" };

const expiredError = () =>
  new ApiError(404, ApiCode.READ_HANDLE_EXPIRED, "expired");

/** A live-handle snapshot reader returning `total` rows (capped by limit). */
const fakeSnapshot = (total: number) =>
  jest.fn(async (_id: string, range: { offset?: number; limit?: number }) => {
    const limit = range.limit ?? total;
    const n = Math.min(total, limit);
    return {
      rows: Array.from({ length: n }, (_, i) => ({ a: i })),
      total,
      offset: 0,
      limit,
    };
  });

describe("PortalResultPinService.materialize", () => {
  // ── text ────────────────────────────────────────────────────────────

  it("passes a text block through and stamps snapshotUpdatedAt", async () => {
    const before = Date.now();
    const result = await PortalResultPinService.materialize(
      "text",
      "## Total revenue: $1.2M",
      SCOPE
    );
    expect(result.content).toBe("## Total revenue: $1.2M");
    expect(result.snapshotUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  it("rejects text content that is not a string", async () => {
    await expect(
      PortalResultPinService.materialize("text", { body: "x" }, SCOPE)
    ).rejects.toMatchObject({
      code: ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
    });
  });

  // ── unregistered type ───────────────────────────────────────────────

  it("rejects a type with no registered content schema (geo pre-#84)", async () => {
    await expect(
      PortalResultPinService.materialize("geo", { layers: [] }, SCOPE)
    ).rejects.toMatchObject({
      code: ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
    });
  });

  // ── inline content ──────────────────────────────────────────────────

  it("stores an inline data-table as-is with no derived pipeline", async () => {
    const result = await PortalResultPinService.materialize(
      "data-table",
      { columns: ["a"], rows: [{ a: 1 }] },
      SCOPE
    );
    expect(result.content).toEqual({ columns: ["a"], rows: [{ a: 1 }] });
  });

  it("stores an inline d3 block as-is, preserving its pipeline", async () => {
    const content = {
      program: "api.svg;",
      rows: [{ x: 1 }],
      pipeline: {
        sql: "SELECT x FROM t",
        stationId: "station-1",
        organizationId: "org-1",
      },
    };
    const result = await PortalResultPinService.materialize(
      "d3",
      content,
      SCOPE
    );
    expect(result.content).toEqual(content);
  });

  // ── handle-backed content, live handle ──────────────────────────────

  it("materializes a handle-backed data-table: rows ≤ cap, rowCount, truncated, derived pipeline", async () => {
    const getSnapshot = fakeSnapshot(PIN_SNAPSHOT_ROW_CAP + 500);
    const deps: MaterializeDeps = { getSnapshot: getSnapshot as never };
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        queryHandle: "qh-1",
        rowCount: PIN_SNAPSHOT_ROW_CAP + 500,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
        sql: "SELECT a FROM t",
      },
      SCOPE,
      deps
    );
    const content = result.content as Record<string, unknown>;
    expect(getSnapshot).toHaveBeenCalledWith("qh-1", {
      offset: 0,
      limit: PIN_SNAPSHOT_ROW_CAP,
    });
    expect((content.rows as unknown[]).length).toBe(PIN_SNAPSHOT_ROW_CAP);
    expect(content.columns).toEqual(["a"]);
    expect(content.rowCount).toBe(PIN_SNAPSHOT_ROW_CAP + 500);
    expect(content.truncated).toBe(true);
    expect(content.pipeline).toEqual({
      sql: "SELECT a FROM t",
      stationId: "station-1",
      organizationId: "org-1",
    });
    // The ephemeral envelope never persists.
    expect(content.queryHandle).toBeUndefined();
  });

  it("derives no pipeline when the envelope's sql is null (produceFromRows)", async () => {
    const deps: MaterializeDeps = {
      getSnapshot: fakeSnapshot(3) as never,
      getMeta: jest.fn(async () => ({ sql: null })) as never,
    };
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        queryHandle: "qh-2",
        rowCount: 3,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
        sql: null,
      },
      SCOPE,
      deps
    );
    const content = result.content as Record<string, unknown>;
    expect((content.rows as unknown[]).length).toBe(3);
    expect(content.truncated).toBe(false);
    expect(content.pipeline).toBeUndefined();
  });

  // #312 smoke find: the persisted display block omits the envelope's
  // retained sql — the server-side handle meta is the authoritative source.
  it("derives the pipeline from server-side handle meta when the block omits sql", async () => {
    const getMeta = jest.fn(async () => ({ sql: "SELECT a FROM t" }));
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        // The real block shape: no `sql`, no `truncated` (see portal.service
        // resolveDisplayBlock) — only what the client renderer needs.
        queryHandle: "qh-4",
        rowCount: 3,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        samplePeek: [],
      },
      SCOPE,
      { getSnapshot: fakeSnapshot(3) as never, getMeta: getMeta as never }
    );
    expect(getMeta).toHaveBeenCalledWith("qh-4");
    const content = result.content as Record<string, unknown>;
    expect(content.pipeline).toEqual({
      sql: "SELECT a FROM t",
      stationId: "station-1",
      organizationId: "org-1",
    });
  });

  it("stays a static snapshot when the meta read fails mid-pin", async () => {
    const getMeta = jest.fn(async () => {
      throw expiredError();
    });
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        queryHandle: "qh-5",
        rowCount: 3,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        samplePeek: [],
      },
      SCOPE,
      { getSnapshot: fakeSnapshot(3) as never, getMeta: getMeta as never }
    );
    const content = result.content as Record<string, unknown>;
    expect((content.rows as unknown[]).length).toBe(3);
    expect(content.pipeline).toBeUndefined();
  });

  it("keeps a handle-backed d3 block's own pipeline and strips the envelope", async () => {
    const deps: MaterializeDeps = { getSnapshot: fakeSnapshot(10) as never };
    const result = await PortalResultPinService.materialize(
      "d3",
      {
        program: "api.svg;",
        queryHandle: "qh-3",
        rowCount: 10,
        schema: [{ name: "x", type: "number" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
        sql: "SELECT x FROM t",
        pipeline: {
          sql: "SELECT x FROM t",
          stationId: "station-1",
          organizationId: "org-1",
        },
      },
      SCOPE,
      deps
    );
    const content = result.content as Record<string, unknown>;
    expect(content.program).toBe("api.svg;");
    expect((content.rows as unknown[]).length).toBe(10);
    expect(content.pipeline).toBeDefined();
    expect(content.queryHandle).toBeUndefined();
  });

  // ── handle-backed content, expired handle ───────────────────────────

  it("re-executes the pipeline when the handle has expired", async () => {
    const getSnapshot = jest.fn(async () => {
      throw expiredError();
    });
    const resolveSqlDelivery = jest.fn(async () => ({
      kind: "inline" as const,
      result: { rows: [{ a: 1 }, { a: 2 }] },
    }));
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        queryHandle: "qh-dead",
        rowCount: 2,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
        sql: "SELECT a FROM t",
      },
      SCOPE,
      {
        getSnapshot: getSnapshot as never,
        resolveSqlDelivery: resolveSqlDelivery as never,
      }
    );
    expect(resolveSqlDelivery).toHaveBeenCalledWith(
      { sql: "SELECT a FROM t" },
      { stationId: "station-1", organizationId: "org-1" }
    );
    const content = result.content as Record<string, unknown>;
    expect(content.rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(content.pipeline).toBeDefined();
  });

  it("throws 422 PORTAL_RESULT_CONTENT_EXPIRED when expired with no pipeline", async () => {
    const getSnapshot = jest.fn(async () => {
      throw expiredError();
    });
    await expect(
      PortalResultPinService.materialize(
        "data-table",
        {
          queryHandle: "qh-dead",
          rowCount: 2,
          schema: [{ name: "a", type: "number" }],
          sampled: false,
          truncated: false,
          samplePeek: [],
          sql: null,
        },
        SCOPE,
        { getSnapshot: getSnapshot as never }
      )
    ).rejects.toMatchObject({
      status: 422,
      code: ApiCode.PORTAL_RESULT_CONTENT_EXPIRED,
    });
  });
});
