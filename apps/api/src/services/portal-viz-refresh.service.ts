/**
 * Widget refresh (#270): re-execute a persisted `d3` widget's durable pipeline
 * for live data, long after its ephemeral Redis handle has expired.
 *
 * Reference-based by design (discovery D3): the caller names the widget by
 * `{ messageId, blockIndex }` and the server loads the *persisted* SQL from the
 * block — the client never supplies SQL, keeping the infiltration surface
 * minimal. Scope is gated on the message's own `organizationId` (the
 * authoritative owned row), and the SQL re-runs read-only under that org via
 * the same `resolveSqlDelivery` funnel `visualize_d3` used at mint time.
 */

import type { WidgetRefreshResponse } from "@portalai/core/contracts";
import { D3PipelineSchema } from "@portalai/core/contracts";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { resolveSqlDelivery as defaultResolveSqlDelivery } from "../tools/result-sink.js";
import { portalMessagesRepo } from "../db/repositories/portal-messages.repository.js";
import type { PortalMessageSelect } from "../db/schema/zod.js";

/** DI seam (test): the message loader + the SQL delivery resolver. */
export interface VizRefreshDeps {
  findMessageById?: (id: string) => Promise<PortalMessageSelect | undefined>;
  resolveSqlDelivery?: typeof defaultResolveSqlDelivery;
}

export interface VizRefreshParams {
  messageId: string;
  blockIndex: number;
  /** The caller's current org (from `req.application.metadata`). */
  organizationId: string;
}

function notFound(): ApiError {
  return new ApiError(
    404,
    ApiCode.VIZ_WIDGET_NOT_FOUND,
    "No refreshable visualization widget for this reference."
  );
}

export class PortalVizRefreshService {
  static async refresh(
    params: VizRefreshParams,
    deps: VizRefreshDeps = {}
  ): Promise<WidgetRefreshResponse> {
    const findMessageById =
      deps.findMessageById ?? ((id: string) => portalMessagesRepo.findById(id));
    const resolveSqlDelivery =
      deps.resolveSqlDelivery ?? defaultResolveSqlDelivery;

    const message = await findMessageById(params.messageId);
    if (!message) throw notFound();

    // Scope gate: the message's own org is the authoritative owner. Cross-org
    // callers get the same 404 as a missing widget — no existence leak.
    if (message.organizationId !== params.organizationId) throw notFound();

    const blocks = (message.blocks ?? []) as Array<Record<string, unknown>>;
    const block = blocks[params.blockIndex];
    if (!block || block.type !== "d3") throw notFound();

    const parsed = D3PipelineSchema.safeParse(block.pipeline);
    if (!parsed.success) {
      throw new ApiError(
        422,
        ApiCode.VIZ_WIDGET_NOT_REFRESHABLE,
        "This visualization has no durable pipeline and can't be refreshed."
      );
    }
    const pipeline = parsed.data;

    // Re-execute read-only, scoped to the pipeline's station under the caller's
    // (verified) org — same funnel as the original mint.
    const delivery = await resolveSqlDelivery(
      { sql: pipeline.sql },
      { stationId: pipeline.stationId, organizationId: params.organizationId }
    );

    if (delivery.kind === "handle") {
      return { kind: "handle", ...delivery.envelope };
    }
    const result = delivery.result as {
      rows?: Array<Record<string, unknown>>;
      sample?: Array<Record<string, unknown>>;
    };
    return { kind: "inline", rows: result.rows ?? result.sample ?? [] };
  }
}
