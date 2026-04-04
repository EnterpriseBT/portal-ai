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

import type { DeltaEvent, ToolResultEvent, DoneEvent, PinnedBlockEntry } from "@portalai/core/contracts";
import { eq, and } from "drizzle-orm";

import { AiService } from "./ai.service.js";
import {
  AnalyticsService,
} from "./analytics.service.js";
import { ToolService } from "./tools.service.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import {
  buildSystemPrompt,
  type StationContext,
} from "../prompts/system.prompt.js";
import { resolveEntityCapabilities } from "../utils/resolve-capabilities.util.js";
import { SseUtil } from "../utils/sse.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";
import type { PortalSelect, PortalMessageSelect } from "../db/schema/zod.js";
import { portalResults } from "../db/schema/index.js";

const logger = createLogger({ module: "portal-service" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { StationContext };

export interface CreatePortalResult {
  portalId: string;
  stationContext: StationContext;
}

export interface PortalWithMessages {
  portal: PortalSelect;
  messages: PortalMessageSelect[];
  /** Full Vercel AI SDK ModelMessage[] reconstructed from persisted blocks. */
  coreMessages: ModelMessage[];
  /** Present when `include` contains `"pinnedResults"`. */
  pinnedBlocks?: PinnedBlockEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tools whose results contain row sets and should be surfaced as data-table blocks. */
const ROW_SET_TOOLS = new Set(["sql_query", "detect_outliers", "cluster"]);

/** Tools whose results represent mutations and should be surfaced as mutation-result blocks. */
const MUTATION_TOOLS = new Set([
  "entity_record_create",
  "entity_record_update",
  "entity_record_delete",
  "connector_entity_create",
  "connector_entity_update",
  "connector_entity_delete",
  "column_definition_create",
  "column_definition_update",
  "column_definition_delete",
  "field_mapping_create",
  "field_mapping_update",
  "field_mapping_delete",
]);

// ---------------------------------------------------------------------------
// Stream chunk handlers
// ---------------------------------------------------------------------------

interface StreamContext {
  assistantBlocks: Record<string, unknown>[];
  sse: SseUtil;
  currentText: string;
}

/** Handle a text-delta chunk: accumulate text and send SSE. */
function handleTextDelta(
  ctx: StreamContext,
  text: string
): void {
  ctx.currentText += text;
  const event: DeltaEvent = { type: "delta", content: text };
  ctx.sse.send("delta", event);
}

/** Handle a tool-call chunk: flush text, persist tool-call block. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleToolCall(ctx: StreamContext, chunk: any): void {
  if (ctx.currentText) {
    ctx.assistantBlocks.push({ type: "text", content: ctx.currentText });
    ctx.currentText = "";
  }

  ctx.assistantBlocks.push({
    type: "tool-call",
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    // AI SDK v6 renamed `args` → `input`
    input: chunk.input ?? chunk.args,
  });
}

/**
 * Handle a tool-result chunk: persist the raw tool-result block for
 * ModelMessage reconstruction, then detect display block types and
 * emit SSE events + display blocks as needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleToolResult(ctx: StreamContext, chunk: any): void {
  const toolResult = chunk.output as Record<string, unknown>;
  const toolName = chunk.toolName as string;
  const toolCallId = chunk.toolCallId as string | undefined;

  // Persist tool-result part for ModelMessage[] reconstruction
  ctx.assistantBlocks.push({
    type: "tool-result",
    toolCallId,
    toolName,
    content: toolResult,
  });

  const displayBlock = resolveDisplayBlock(toolName, toolResult);
  if (displayBlock) {
    const event: ToolResultEvent = {
      type: "tool_result",
      toolName,
      result: displayBlock.sseResult ?? toolResult,
    };
    ctx.sse.send("tool_result", event);
    ctx.assistantBlocks.push(displayBlock.block);
  }
}

/**
 * Determine if a tool result should produce a display block for inline
 * rendering. Returns null for scalar/non-display results.
 */
function resolveDisplayBlock(
  toolName: string,
  toolResult: Record<string, unknown> | null
): {
  block: Record<string, unknown>;
  sseResult?: Record<string, unknown>;
} | null {
  const isVegaLite =
    toolName === "visualize" ||
    (toolResult != null && toolResult.type === "vega-lite");
  if (isVegaLite) {
    return { block: { type: "vega-lite", content: toolResult } };
  }

  const isVega =
    toolName === "visualize_tree" ||
    (toolResult != null && toolResult.type === "vega");
  if (isVega) {
    return { block: { type: "vega", content: toolResult } };
  }

  if (ROW_SET_TOOLS.has(toolName)) {
    const rows = Array.isArray(toolResult)
      ? (toolResult as Record<string, unknown>[])
      : Array.isArray(toolResult?.rows)
        ? (toolResult!.rows as Record<string, unknown>[])
        : [];
    const columns =
      rows.length > 0 ? Object.keys(rows[0] as object) : [];
    const dataTableContent = { type: "data-table" as const, columns, rows };
    return {
      block: { type: "data-table" as const, content: dataTableContent },
      sseResult: dataTableContent,
    };
  }

  if (
    MUTATION_TOOLS.has(toolName) &&
    toolResult != null &&
    toolResult.success === true &&
    typeof toolResult.operation === "string"
  ) {
    const mutationContent = {
      type: "mutation-result" as const,
      operation: toolResult.operation as string,
      entity: toolResult.entity as string,
      entityId: toolResult.entityId as string,
      summary: (toolResult.summary as Record<string, unknown>) ?? {},
    };
    return {
      block: { type: "mutation-result" as const, content: mutationContent },
      sseResult: mutationContent,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// In-memory station data cache (keyed by portalId)
// ---------------------------------------------------------------------------


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
    const entityCapabilities = toolPacks.includes("entity_management")
      ? await resolveEntityCapabilities(stationId)
      : undefined;

    const stationContext: StationContext = {
      stationId: station.id,
      stationName: station.name,
      entities: stationData.entities,
      entityGroups: stationData.entityGroups,
      toolPacks,
      entityCapabilities,
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
  static async getPortal(
    portalId: string,
    opts?: { include?: string[] },
  ): Promise<PortalWithMessages> {
    const repo = DbService.repository;

    const portal = await repo.portals.findById(portalId);
    if (!portal) {
      throw new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");
    }

    const messages = await repo.portalMessages.findByPortal(portalId);
    const coreMessages = reconstructModelMessages(messages);

    const result: PortalWithMessages = { portal, messages, coreMessages };

    if (opts?.include?.includes("pinnedResults")) {
      const allPins = await repo.portalResults.findMany(
        and(eq(portalResults.portalId, portalId))
      );

      result.pinnedBlocks = allPins
        .filter((r) => r.messageId != null && r.blockIndex != null)
        .map((r) => ({
          messageId: r.messageId!,
          blockIndex: r.blockIndex!,
          portalResultId: r.id,
        }));
    }

    return result;
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
  // resetPortal
  // -------------------------------------------------------------------------

  /**
   * Delete all messages associated with a portal, resetting the conversation.
   */
  static async resetPortal(portalId: string): Promise<number> {
    const repo = DbService.repository;

    const portal = await repo.portals.findById(portalId);
    if (!portal) {
      throw new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");
    }

    const count = await repo.portalMessages.deleteByPortal(portalId);
    logger.info({ portalId, deletedMessages: count }, "Portal reset");
    return count;
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
    userId,
    sse,
  }: {
    portalId: string;
    messages: ModelMessage[];
    stationContext: StationContext;
    organizationId: string;
    userId: string;
    sse: SseUtil;
  }): Promise<void> {
    const systemPrompt = buildSystemPrompt(stationContext);

    const analyticsTools = await ToolService.buildAnalyticsTools(
      organizationId,
      stationContext.stationId,
      userId,
    );

    // streamText() is lazy in AI SDK v6 — it returns immediately and
    // errors surface during fullStream iteration or as "error" chunks.
    const result = streamText({
      model: AiService.providers.anthropic(AiService.DEFAULT_MODEL),
      system: systemPrompt,
      messages,
      tools: analyticsTools,
      stopWhen: stepCountIs(10),
      maxRetries: 3,
    });

    // Accumulate assistant content blocks (full ModelMessage[] parts)
    const ctx: StreamContext = {
      assistantBlocks: [],
      sse,
      currentText: "",
    };

    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          handleTextDelta(ctx, chunk.text);
        } else if (chunk.type === "tool-call") {
          handleToolCall(ctx, chunk);
        } else if (chunk.type === "tool-result") {
          handleToolResult(ctx, chunk);
        } else if (chunk.type === "error") {
          // AI SDK v6 emits error chunks instead of always throwing.
          // Surface the error to the client and abort the stream.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const err = (chunk as any).error;
          const message =
            err instanceof Error ? err.message : String(err ?? "Unknown AI error");
          logger.error({ portalId, error: message }, "AI stream error chunk");
          sse.sendError(message);
          return;
        } else if (chunk.type === "finish") {
          if (ctx.currentText) {
            ctx.assistantBlocks.push({ type: "text", content: ctx.currentText });
            ctx.currentText = "";
          }
        }
      }
    } catch (error) {
      // Thrown errors (e.g. network failures, validation) also land here.
      const message =
        error instanceof Error ? error.message : "An error occurred during streaming";
      logger.error(
        { portalId, error: message },
        "AI stream error"
      );
      sse.sendError(message);
      return;
    }

    // Final flush in case stream ended without a finish event
    if (ctx.currentText) {
      ctx.assistantBlocks.push({ type: "text", content: ctx.currentText });
    }

    // Strip orphaned tool-call blocks that have no matching tool-result.
    // This can happen when the step limit (stopWhen) is reached after the
    // model emits tool-call chunks but before the SDK executes those tools.
    const resultIds = new Set(
      ctx.assistantBlocks
        .filter((b) => b.type === "tool-result")
        .map((b) => b.toolCallId)
    );
    const assistantBlocks = ctx.assistantBlocks.filter(
      (b) => b.type !== "tool-call" || resultIds.has(b.toolCallId)
    );

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
 * Number of most-recent assistant messages whose tool results are preserved
 * (with row capping). Older tool results are replaced with a compact summary.
 */
const RECENT_TURNS_FULL_RESULTS = 2;

/**
 * Maximum rows kept in a tool result even for recent turns. Results
 * exceeding this limit are capped with a note so the model knows more
 * data exists.
 */
const MAX_RESULT_ROWS = 50;

/**
 * Extract rows from a tool result regardless of shape.
 * Returns the array of rows and a reference to the parent object (if wrapped).
 */
function extractRows(
  content: unknown
): { rows: Record<string, unknown>[]; isWrapped: boolean } {
  if (Array.isArray(content)) {
    return { rows: content as Record<string, unknown>[], isWrapped: false };
  }
  if (content != null && typeof content === "object") {
    const obj = content as Record<string, unknown>;
    if (Array.isArray(obj.rows)) {
      return { rows: obj.rows as Record<string, unknown>[], isWrapped: true };
    }
  }
  return { rows: [], isWrapped: false };
}

/**
 * Cap the number of rows in a tool result. Returns the content unchanged if
 * there are no rows or the count is within limits.
 */
function capResultRows(content: unknown): unknown {
  const { rows, isWrapped } = extractRows(content);
  if (rows.length <= MAX_RESULT_ROWS) return content;

  const capped = rows.slice(0, MAX_RESULT_ROWS);
  const note = `[Showing ${MAX_RESULT_ROWS} of ${rows.length} rows]`;

  if (isWrapped) {
    return { ...(content as Record<string, unknown>), rows: capped, _truncated: note };
  }
  // Append a sentinel row so the model sees the note
  return [...capped, { _truncated: note }];
}

/**
 * Build a compact placeholder for a truncated tool result so the model
 * retains awareness that the tool was called without the full payload.
 * Includes column names and a sample row for context.
 */
function summarizeToolResult(
  toolName: string,
  content: unknown
): string {
  const { rows } = extractRows(content);

  if (rows.length === 0) {
    return `[Previous ${toolName} result — truncated]`;
  }

  const columns = Object.keys(rows[0] as object);
  const sample = rows[0];
  const sampleStr = columns
    .slice(0, 5)
    .map((c) => `${c}: ${JSON.stringify((sample as Record<string, unknown>)[c])}`)
    .join(", ");
  const colExtra = columns.length > 5 ? `, +${columns.length - 5} more` : "";

  return (
    `[Previous ${toolName} result: ${rows.length} rows, ` +
    `columns: [${columns.slice(0, 8).join(", ")}${colExtra}], ` +
    `sample: {${sampleStr}} — truncated]`
  );
}

/**
 * Reconstruct the full Vercel AI SDK `ModelMessage[]` array from persisted
 * portal message rows. User messages become `{ role: "user", content }`.
 * Assistant messages are walked block-by-block: text parts become assistant
 * content, tool-call parts become `tool-call` content, and tool-result blocks
 * are grouped into a single `{ role: "tool", content: [...] }` message.
 *
 * To prevent unbounded prompt growth, tool-result payloads older than the
 * most recent {@link RECENT_TURNS_FULL_RESULTS} assistant messages are
 * replaced with a short summary string.
 */
function reconstructModelMessages(
  messages: PortalMessageSelect[]
): ModelMessage[] {
  // Determine the cutoff: only assistant messages within the last N keep
  // full tool-result payloads.
  const assistantIndices: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "assistant") assistantIndices.push(i);
  }
  const cutoff =
    assistantIndices.length > RECENT_TURNS_FULL_RESULTS
      ? assistantIndices[assistantIndices.length - RECENT_TURNS_FULL_RESULTS]
      : -1;

  const coreMessages: ModelMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const blocks = (msg.blocks ?? []) as Record<string, unknown>[];
    const truncateResults = i < cutoff;

    if (msg.role === "user") {
      // User turns: extract text content from the first text block
      const textBlock = blocks.find((b) => b.type === "text");
      coreMessages.push({
        role: "user",
        content: String(textBlock?.content ?? ""),
      });
      continue;
    }

    // Assistant turns: split into alternating assistant → tool message
    // pairs. A single persisted assistant row may contain multiple agentic
    // steps (text → tool-call → tool-result → text → tool-call → …).
    // The Anthropic API requires each tool-call batch to be in its own
    // assistant message, immediately followed by a tool message with the
    // matching results. Text after a tool-result belongs to the NEXT
    // assistant message (it was generated after seeing the result).

    // Build a lookup for tool-result blocks keyed by toolCallId.
    const resultMap = new Map<string, Record<string, unknown>>();
    for (const block of blocks) {
      if (block.type === "tool-result" && block.toolCallId) {
        resultMap.set(String(block.toolCallId), block);
      }
    }

    // Walk blocks and split into steps. Each step accumulates text and
    // tool-call parts into an assistant message. When we hit a
    // tool-result, the preceding tool-calls (and their results) form a
    // complete step — flush them as an assistant + tool message pair,
    // then start a new step for any subsequent text/tool-calls.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentParts: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pendingCalls: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pendingResults: any[] = [];

    const flushStep = () => {
      if (pendingCalls.length > 0 && pendingResults.length > 0) {
        // Emit assistant message with text + tool-calls
        coreMessages.push({
          role: "assistant",
          content: [...currentParts, ...pendingCalls],
        });
        // Emit tool message with matching results
        coreMessages.push({ role: "tool", content: pendingResults });
        currentParts = [];
      }
      pendingCalls = [];
      pendingResults = [];
    };

    for (const block of blocks) {
      if (block.type === "text") {
        const text = String(block.content ?? "");
        if (!text) continue;

        // If we have pending results, this text was generated AFTER the
        // model saw those results — flush the previous step first.
        if (pendingResults.length > 0) {
          flushStep();
        }

        currentParts.push({ type: "text", text });
      } else if (block.type === "tool-call") {
        // Skip orphaned tool-calls (no matching result)
        if (!resultMap.has(String(block.toolCallId))) continue;

        // If we have pending results from a prior call, flush first —
        // this tool-call belongs to the next step.
        if (pendingResults.length > 0) {
          flushStep();
        }

        pendingCalls.push({
          type: "tool-call",
          toolCallId: block.toolCallId,
          toolName: block.toolName,
          // AI SDK v6 renamed `args` → `input`.
          // Default to {} for data saved while chunk.args was undefined.
          input: block.input ?? block.args ?? {},
        });
      } else if (block.type === "tool-result") {
        const toolName = String(block.toolName ?? "tool");
        const raw = truncateResults
          ? summarizeToolResult(toolName, block.content)
          : capResultRows(block.content);

        const output =
          typeof raw === "string"
            ? { type: "text" as const, value: raw }
            : { type: "json" as const, value: raw };

        pendingResults.push({
          type: "tool-result",
          toolCallId: block.toolCallId,
          toolName,
          output,
        });
      }
      // Display-only blocks (vega-lite, vega, data-table) are skipped —
      // they duplicate tool-result data.
    }

    // Flush any remaining step
    flushStep();

    // Emit trailing text (assistant's final response after all tools)
    if (currentParts.length > 0) {
      coreMessages.push({ role: "assistant", content: currentParts });
    }
  }

  return coreMessages;
}

