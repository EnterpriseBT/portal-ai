/**
 * Portal Service — orchestrates portal lifecycle.
 *
 * Responsibilities:
 *  - Creating portals and loading station data into memory
 *  - Persisting portal messages (full ModelMessage[] representation)
 *  - Running the Claude agentic streaming loop and fanning out SSE events
 *  - Reconstructing full ModelMessage[] history for multi-turn continuity
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
  /** Full Vercel AI SDK ModelMessage[] reconstructed from persisted blocks. */
  coreMessages: ModelMessage[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tools whose results contain row sets and should be surfaced as data-table blocks. */
const ROW_SET_TOOLS = new Set(["sql_query", "detect_outliers", "cluster"]);

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

  /**
   * Load a portal, its message history, and reconstruct the full ModelMessage[]
   * array (user + assistant turns, including tool call/result pairs) for
   * multi-turn continuity with `streamText`.
   */
  static async getPortal(portalId: string): Promise<PortalWithMessages> {
    const repo = DbService.repository;

    const portal = await repo.portals.findById(portalId);
    if (!portal) {
      throw new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");
    }

    const messages = await repo.portalMessages.findByPortal(portalId);
    const coreMessages = reconstructModelMessages(messages);
    return { portal, messages, coreMessages };
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

  /*
   * ── LangGraph Migration Seam ──────────────────────────────────────────
   *
   * When we migrate to LangGraph, this method is the primary swap point.
   *
   * What changes:
   *   - Replace `streamText()` with `graph.stream()` from @langchain/langgraph
   *   - The graph will own the agentic loop (tool dispatch, retries, routing)
   *   - LangGraph checkpoints replace our manual ModelMessage[] persistence
   *
   * What stays the same:
   *   - API contract: SSE events (delta, tool_result, done) are unchanged
   *   - DB schema: portal_messages.blocks continues to store ModelMessage[] parts
   *   - Tool definitions: analytics tools remain identical (LangGraph uses the
   *     same Zod-based tool schema as Vercel AI SDK)
   *
   * Mapping table:
   *   Current primitive          → LangGraph equivalent
   *   ─────────────────────────────────────────────────────
   *   streamText()               → graph.stream()
   *   stepCountIs(10)            → recursion_limit: 10
   *   result.fullStream          → graph event stream
   *   ModelMessage[]              → LangGraph checkpoint state
   *   tool-call / tool-result    → ToolNode messages
   *   assistantBlocks persistence→ checkpoint persistence (auto)
   * ────────────────────────────────────────────────────────────────────────
   */

  /**
   * Run the Claude agentic loop and stream results to the client via SSE.
   *
   * Events emitted:
   *  - `delta`       — text chunk from the model
   *  - `tool_result` — vega-lite chart, data-table, or structured result
   *  - `done`        — stream finished; carries the persisted messageId
   *
   * Persistence:
   *  Blocks store the full ModelMessage[] representation of the assistant turn,
   *  including `tool-call` and `tool-result` content parts. This is the
   *  LangGraph checkpoint format; only rendered display blocks are sent as SSE
   *  events, but all parts are persisted for multi-turn reconstruction.
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

    // Accumulate assistant content blocks (full ModelMessage[] parts)
    const assistantBlocks: Record<string, unknown>[] = [];
    let currentText = "";

    for await (const chunk of result.fullStream) {
      if (chunk.type === "text-delta") {
        currentText += chunk.text;
        const event: DeltaEvent = { type: "delta", content: chunk.text };
        sse.send("delta", event);
      } else if (chunk.type === "tool-call") {
        // Flush any accumulated text into a block before the tool call
        if (currentText) {
          assistantBlocks.push({ type: "text", content: currentText });
          currentText = "";
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolCall = chunk as any;
        // Persist tool-call part for ModelMessage[] reconstruction
        assistantBlocks.push({
          type: "tool-call",
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          args: toolCall.args,
        });
      } else if (chunk.type === "tool-result") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolResult = (chunk as any).output as Record<string, unknown>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolName = (chunk as any).toolName as string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolCallId = (chunk as any).toolCallId as string | undefined;

        // Persist tool-result part for ModelMessage[] reconstruction
        assistantBlocks.push({
          type: "tool-result",
          toolCallId,
          toolName,
          content: toolResult,
        });

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
        } else if (ROW_SET_TOOLS.has(toolName)) {
          // Row-set tools emit a data-table SSE event for inline rendering
          const rows = Array.isArray(toolResult?.rows)
            ? (toolResult.rows as Record<string, unknown>[])
            : [];
          const columns =
            rows.length > 0 ? Object.keys(rows[0] as object) : [];

          const dataTableBlock = {
            type: "data-table" as const,
            columns,
            rows,
          };

          const event: ToolResultEvent = {
            type: "tool_result",
            toolName,
            result: dataTableBlock,
          };
          sse.send("tool_result", event);
          assistantBlocks.push(dataTableBlock);
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
// ModelMessage[] reconstruction
// ---------------------------------------------------------------------------

/**
 * Reconstruct the full Vercel AI SDK `ModelMessage[]` array from persisted
 * portal message rows. User messages become `{ role: "user", content }`.
 * Assistant messages are walked block-by-block: text parts become assistant
 * content, tool-call parts become `tool-call` content, and tool-result blocks
 * are grouped into a single `{ role: "tool", content: [...] }` message.
 */
function reconstructModelMessages(
  messages: PortalMessageSelect[]
): ModelMessage[] {
  const coreMessages: ModelMessage[] = [];

  for (const msg of messages) {
    const blocks = (msg.blocks ?? []) as Record<string, unknown>[];

    if (msg.role === "user") {
      // User turns: extract text content from the first text block
      const textBlock = blocks.find((b) => b.type === "text");
      coreMessages.push({
        role: "user",
        content: String(textBlock?.content ?? ""),
      });
      continue;
    }

    // Assistant turns: split into assistant content parts + tool results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assistantParts: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = [];

    for (const block of blocks) {
      if (block.type === "text") {
        assistantParts.push({
          type: "text",
          text: String(block.content ?? ""),
        });
      } else if (block.type === "tool-call") {
        assistantParts.push({
          type: "tool-call",
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          args: block.args,
        });
      } else if (block.type === "tool-result") {
        toolResults.push({
          type: "tool-result",
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          result: block.content,
        });
      }
      // Display-only blocks (vega-lite, data-table) are skipped for
      // ModelMessage reconstruction — they duplicate tool-result data.
    }

    if (assistantParts.length > 0) {
      coreMessages.push({ role: "assistant", content: assistantParts });
    }

    if (toolResults.length > 0) {
      coreMessages.push({ role: "tool", content: toolResults });
    }
  }

  return coreMessages;
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
