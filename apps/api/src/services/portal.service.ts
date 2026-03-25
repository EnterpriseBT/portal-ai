/**
 * Portal Service — orchestrates portal lifecycle.
 *
 * Responsibilities:
 *  - Creating portals and loading station data into memory
 *  - Persisting portal messages
 *  - Running the Claude agentic streaming loop and fanning out SSE events
 */

import { streamText, stepCountIs, type ModelMessage } from "ai";

import type { DeltaEvent, ToolResultEvent, DoneEvent } from "@portalai/core/contracts";

import { AiService } from "./ai.service.js";
import {
  AnalyticsService,
  type EntitySchema,
  type EntityGroupContext,
  type StationData,
} from "./analytics.service.js";
import { buildAnalyticsTools } from "./analytics.tools.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { SseUtil } from "../utils/sse.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";
import type { PortalSelect, PortalMessageSelect } from "../db/schema/zod.js";

const logger = createLogger({ module: "portal-service" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StationContext {
  stationId: string;
  stationName: string;
  entities: EntitySchema[];
  entityGroups: EntityGroupContext[];
}

export interface CreatePortalResult {
  portalId: string;
  stationContext: StationContext;
}

export interface PortalWithMessages {
  portal: PortalSelect;
  messages: PortalMessageSelect[];
}

// ---------------------------------------------------------------------------
// In-memory station data cache (keyed by portalId)
// ---------------------------------------------------------------------------

/** Cached station data for active portal sessions. */
const stationDataCache = new Map<string, StationData>();

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PortalService {
  // -------------------------------------------------------------------------
  // createPortal
  // -------------------------------------------------------------------------

  /**
   * Create a new portal for a station.
   *
   * Validates the station, creates the DB row, loads station data into
   * in-memory AlaSQL tables, and returns the portal ID plus station context.
   */
  static async createPortal({
    stationId,
    organizationId,
    userId,
  }: {
    stationId: string;
    organizationId: string;
    userId: string;
  }): Promise<CreatePortalResult> {
    const repo = DbService.repository;

    // Validate station exists and belongs to the org
    const station = await repo.stations.findById(stationId);
    if (!station || station.organizationId !== organizationId) {
      throw new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found");
    }

    // Validate station has at least one tool pack
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolPacks = (station as any).toolPacks as string[] | null;
    if (!toolPacks || toolPacks.length === 0) {
      throw new ApiError(
        400,
        ApiCode.PORTAL_STATION_NO_TOOLS,
        "Station must have at least one tool pack enabled"
      );
    }

    // Auto-generate portal name from current date
    const now = SystemUtilities.utc.now().getTime();
    const name = `Portal — ${SystemUtilities.utc.format(now, "MMM d, yyyy")}`;

    const portal = await repo.portals.create({
      id: SystemUtilities.id.v4.generate(),
      organizationId,
      stationId,
      name,
      created: now,
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    });

    // Load station data and cache it for the session
    const stationData = await AnalyticsService.loadStation(
      stationId,
      organizationId
    );
    stationDataCache.set(portal.id, stationData);

    const stationContext: StationContext = {
      stationId: station.id,
      stationName: station.name,
      entities: stationData.entities,
      entityGroups: stationData.entityGroups,
    };

    logger.info({ portalId: portal.id, stationId }, "Portal created");
    return { portalId: portal.id, stationContext };
  }

  // -------------------------------------------------------------------------
  // getPortal
  // -------------------------------------------------------------------------

  /** Load a portal and its full message history from the DB. */
  static async getPortal(portalId: string): Promise<PortalWithMessages> {
    const repo = DbService.repository;

    const portal = await repo.portals.findById(portalId);
    if (!portal) {
      throw new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");
    }

    const messages = await repo.portalMessages.findByPortal(portalId);
    return { portal, messages };
  }

  // -------------------------------------------------------------------------
  // addMessage
  // -------------------------------------------------------------------------

  /**
   * Persist a single-block message to the DB.
   *
   * Wraps the plain `content` string in a `{ type: "text", content }` block.
   * Used by route handlers to persist user turns before starting the stream.
   */
  static async addMessage(
    portalId: string,
    { role, content }: { role: "user" | "assistant"; content: string }
  ): Promise<PortalMessageSelect> {
    const repo = DbService.repository;

    const portal = await repo.portals.findById(portalId);
    if (!portal) {
      throw new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");
    }

    const now = SystemUtilities.utc.now().getTime();
    const blocks: Record<string, unknown>[] = [{ type: "text", content }];

    return repo.portalMessages.create({
      id: SystemUtilities.id.v4.generate(),
      portalId,
      organizationId: portal.organizationId,
      role,
      blocks,
      created: now,
      createdBy: portal.createdBy,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    });
  }

  // -------------------------------------------------------------------------
  // streamResponse
  // -------------------------------------------------------------------------

  /**
   * Run the Claude agentic loop and stream results to the client via SSE.
   *
   * Events emitted:
   *  - `delta`       — text chunk from the model
   *  - `tool_result` — vega-lite chart from `visualize` or a webhook tool
   *  - `done`        — stream finished; carries the persisted messageId
   */
  static async streamResponse({
    portalId,
    messages,
    stationContext,
    organizationId,
    sse,
  }: {
    portalId: string;
    messages: ModelMessage[];
    stationContext: StationContext;
    organizationId: string;
    sse: SseUtil;
  }): Promise<void> {
    const systemPrompt = buildSystemPrompt(stationContext);
    const analyticsTools = await buildAnalyticsTools(
      organizationId,
      stationContext.stationId
    );

    const result = streamText({
      model: AiService.providers.anthropic(AiService.DEFAULT_MODEL),
      system: systemPrompt,
      messages,
      tools: analyticsTools,
      stopWhen: stepCountIs(10),
    });

    // Accumulate assistant content blocks
    const assistantBlocks: Record<string, unknown>[] = [];
    let currentText = "";

    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        currentText += chunk.text;
        const event: DeltaEvent = { type: "delta", content: chunk.text };
        sse.send("delta", event);
      } else if (chunk.type === "tool-result") {
        // Flush any accumulated text into a block before the tool result
        if (currentText) {
          assistantBlocks.push({ type: "text", content: currentText });
          currentText = "";
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolResult = (chunk as any).output as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolName = (chunk as any).toolName as string;
        const isVegaLite =
          toolName === "visualize" ||
          (toolResult != null && toolResult.type === "vega-lite");

        if (isVegaLite) {
          const event: ToolResultEvent = {
            type: "tool_result",
            toolName,
            result: toolResult,
          };
          sse.send("tool_result", event);
          assistantBlocks.push({ type: "vega-lite", content: toolResult });
        } else {
          assistantBlocks.push({
            type: "tool_result",
            toolName,
            content: toolResult,
          });
        }
      } else if (chunk.type === "finish") {
        // Flush remaining text on finish
        if (currentText) {
          assistantBlocks.push({ type: "text", content: currentText });
          currentText = "";
        }
      }
    }

    // Final flush in case stream ended without a finish event
    if (currentText) {
      assistantBlocks.push({ type: "text", content: currentText });
    }

    // Persist the assistant message
    const repo = DbService.repository;
    const portal = await repo.portals.findById(portalId);
    if (!portal) {
      throw new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");
    }

    const now = SystemUtilities.utc.now().getTime();
    const savedMessage = await repo.portalMessages.create({
      id: SystemUtilities.id.v4.generate(),
      portalId,
      organizationId: portal.organizationId,
      role: "assistant",
      blocks: assistantBlocks,
      created: now,
      createdBy: portal.createdBy,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    });

    const doneEvent: DoneEvent = {
      type: "done",
      portalId,
      messageId: savedMessage.id,
    };
    sse.send("done", doneEvent);

    logger.info(
      { portalId, messageId: savedMessage.id },
      "Portal stream complete"
    );
  }
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

/**
 * Build the Claude system prompt from station name, entity schemas, and
 * entity group relationship metadata.
 */
function buildSystemPrompt(stationContext: StationContext): string {
  const lines: string[] = [
    `You are an analytics assistant for the "${stationContext.stationName}" station.`,
    "",
    "## Available Data",
    "",
  ];

  for (const entity of stationContext.entities) {
    lines.push(`### ${entity.label} (\`${entity.key}\`)`);
    lines.push("Columns:");
    for (const col of entity.columns) {
      lines.push(`  - \`${col.key}\` (${col.type}): ${col.label}`);
    }
    lines.push("");
  }

  if (stationContext.entityGroups.length > 0) {
    lines.push("## Cross-Entity Relationships");
    lines.push("");
    lines.push(
      "Use the specified link columns when joining across member entities. " +
      "Prefer data from the primary entity when displaying a unified view."
    );
    lines.push("");

    for (const group of stationContext.entityGroups) {
      lines.push(`### ${group.name}`);
      lines.push("Members:");
      for (const member of group.members) {
        const primaryFlag = member.isPrimary ? " [primary]" : "";
        lines.push(
          `  - \`${member.entityKey}\` — link column: \`${member.linkColumnKey}\` (${member.linkColumnLabel})${primaryFlag}`
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
