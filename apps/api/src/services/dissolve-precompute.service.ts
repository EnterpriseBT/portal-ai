import type { DissolvePrecomputeMetadata } from "@portalai/core/models";

import { JobsService } from "./jobs.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "dissolve-precompute-enqueue" });

/**
 * Enqueues the off-request `dissolve_precompute` job for a pinned polygon layer
 * (#472, extended #532). Any geo pin with a polygon layer gets its low-zoom
 * dissolve precomputed at pin create and on every refresh — a colorBy layer to a
 * per-value choropleth, a plain polygon layer to a single merged "dissolve-all"
 * coverage; everything else is a no-op. Keyed by `portalResultId` — the dissolve
 * is derived from the pin's durable pipeline, so it serves joined/aggregated
 * multi-source layers.
 */
export class DissolvePrecomputeService {
  /**
   * True when `content` is a geo block whose spec has **any polygon layer**
   * (#532). Every polygon layer dissolves — a colorBy one to a per-value
   * choropleth, a no-colorBy one to a single merged "dissolve-all" coverage.
   * Tolerant of an unvalidated content object (it reads a persisted block).
   */
  static isDissolvable(type: string, content: unknown): boolean {
    if (type !== "geo") return false;
    const layers = (
      content as
        | { spec?: { layers?: Array<Record<string, unknown>> } }
        | undefined
    )?.spec?.layers;
    if (!Array.isArray(layers)) return false;
    return layers.some((l) => l?.kind === "polygons");
  }

  /**
   * Enqueue a dissolve for a pin if it qualifies. **Best-effort**: a failed
   * enqueue is logged and swallowed — it must never fail the pin/refresh that
   * triggered it (the tile serve path falls back to raw-simplify without a
   * precompute).
   */
  static async enqueueForPin(params: {
    portalResultId: string;
    organizationId: string;
    userId: string;
    type: string;
    content: unknown;
  }): Promise<void> {
    if (!DissolvePrecomputeService.isDissolvable(params.type, params.content)) {
      return;
    }
    const metadata: DissolvePrecomputeMetadata = {
      portalResultId: params.portalResultId,
      organizationId: params.organizationId,
    };
    try {
      const job = await JobsService.create(params.userId, {
        type: "dissolve_precompute",
        organizationId: params.organizationId,
        metadata: metadata as unknown as Record<string, unknown>,
      });
      logger.info(
        { portalResultId: params.portalResultId, jobId: job.id },
        "dissolve_precompute job enqueued"
      );
    } catch (err) {
      logger.warn(
        { portalResultId: params.portalResultId, err },
        "Failed to enqueue dissolve_precompute; pin will fall back to raw-simplify"
      );
    }
  }
}
