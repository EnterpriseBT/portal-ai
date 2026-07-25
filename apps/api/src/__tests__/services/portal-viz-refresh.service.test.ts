import { describe, it, expect, jest } from "@jest/globals";

import { PortalVizRefreshService } from "../../services/portal-viz-refresh.service.js";
import type { VizRefreshDeps } from "../../services/portal-viz-refresh.service.js";
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
