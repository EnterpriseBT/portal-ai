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

import type {
  DeltaEvent,
  ToolCallEvent,
  ToolCallEndEvent,
  ToolResultEvent,
  DoneEvent,
  PinnedBlockEntry,
  InitialMessageOutcome,
} from "@portalai/core/contracts";
import {
  HelpBlockContentSchema,
  InvitationBlockContentSchema,
} from "@portalai/core/contracts";
import { ALL_TOOL_CAPABILITIES } from "@portalai/core/registries";
import { eq, and } from "drizzle-orm";

import { AiService } from "./ai.service.js";
import { geocodingTools } from "../utils/geocoding-tools.util.js";
import { AnalyticsService } from "./analytics.service.js";
import type { EntitySchema } from "./analytics.service.js";
import { scopeEntityGroupsToEntities } from "../utils/entity-group-scope.util.js";
import { PortalSqlService } from "./portal-sql.service.js";
import { StationAttachmentService } from "./station-attachment.service.js";
import { SeatService } from "./seat.service.js";
import { DissolvePrecomputeService } from "./dissolve-precompute.service.js";
import { EntitlementService } from "./entitlement.service.js";
import { ToolService } from "./tools.service.js";
import { DbService } from "./db.service.js";
import { AgentTurnCeilingService } from "./agent-turn-ceiling.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import {
  buildSystemPrompt,
  type StationContext,
} from "../prompts/system.prompt.js";
import {
  resolveCapabilities,
  resolveEntityCapabilities,
  resolveStationCapabilities,
} from "../utils/resolve-capabilities.util.js";
import { isValidIanaTimezone } from "../utils/timezone.util.js";
import { getRedisClient } from "../utils/redis.util.js";
import { stationInstancesRepo } from "../db/repositories/station-instances.repository.js";
import { connectorInstancesRepo } from "../db/repositories/connector-instances.repository.js";
import { connectorDefinitionsRepo } from "../db/repositories/connector-definitions.repository.js";
import type {
  CallerIdentity,
  ConnectorInstanceContext,
} from "../prompts/system.prompt.js";
import { SseUtil } from "../utils/sse.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";
import { stripNulDeep } from "../utils/nul-character.util.js";
import type { PortalSelect, PortalMessageSelect } from "../db/schema/zod.js";
import { portalResults } from "../db/schema/index.js";
import { toModelView } from "./model-output.util.js";
import {
  describeStoredResult,
  isStoredResultSummary,
  RESULT_BLOCK_TYPES,
  stripStoredMessage,
  toStoredBlockContent,
  toStoredToolResult,
} from "./stored-result.util.js";

const logger = createLogger({ module: "portal-service" });

/**
 * #805: an assistant message's blocks without U+0000, which the jsonb
 * `blocks` column can't store. Model text or a custom tool's result can carry
 * one; it's model output, so there's no caller to refuse it back to, and the
 * turn would otherwise fail to save. Logs the count, never the text.
 */
function storableBlocks<T>(blocks: T[], portalId: string): T[] {
  const { value, stripped } = stripNulDeep(blocks);
  if (stripped > 0) {
    logger.warn(
      { portalId, stripped },
      "Stripped U+0000 from an assistant message before persisting it"
    );
  }
  return value;
}

/** Redis Pub/Sub channel prefix for portal-level events (#85 Phase 2). */
export const PORTAL_EVENTS_CHANNEL_PREFIX = "portal:events:";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { StationContext };

export interface CreatePortalResult {
  portalId: string;
  stationContext: StationContext;
  /** #1079: set exactly when the create carried an initial message. */
  initialMessage?: InitialMessageOutcome;
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

// Display routing keys off each tool's declared `capability.resultKind`
// (#121 child G) — see `resolveDisplayBlock`. The former `ROW_SET_TOOLS` /
// `MUTATION_TOOLS` slug sets are gone; the routing reads metadata instead.

// ---------------------------------------------------------------------------
// Stream chunk handlers
// ---------------------------------------------------------------------------

interface StreamContext {
  assistantBlocks: Record<string, unknown>[];
  sse: SseUtil;
  currentText: string;
  /**
   * #846: calls the SDK refused against the tool's schema, keyed by id. The
   * SDK flags the `tool-call` part `invalid` and puts the error object there;
   * the `tool-error` that follows carries only its message string.
   */
  invalidToolCalls: Map<string, unknown>;
}

/**
 * Tools whose result is a self-contained display block, and the schema that
 * block must parse as. The block is the whole answer: the help entries
 * (#1049) and an invitation with its own "Get invite link" button (#847).
 */
const SELF_CONTAINED_BLOCK_TOOLS: Record<
  string,
  { safeParse: (value: unknown) => { success: boolean } }
> = {
  platform_help: HelpBlockContentSchema,
  member_invite: InvitationBlockContentSchema,
  invitation_show: InvitationBlockContentSchema,
};

/**
 * A step whose tool calls all produced self-contained blocks ends the turn,
 * so the model gets no further step in which to restate them. Walks saw it
 * quote help entries back (#1049) and list the invitations it had just shown
 * (#847), despite the prompt. A step that also called another tool, or whose
 * call failed (a refusal, which the model should relay, or bad input it
 * should retry), carries on as usual.
 */
export function endsOnSelfContainedBlocks({
  steps,
}: {
  steps: ReadonlyArray<{
    toolCalls: ReadonlyArray<{ toolName: string }>;
    toolResults: ReadonlyArray<{ toolName: string; output: unknown }>;
  }>;
}): boolean {
  const last = steps[steps.length - 1];
  if (!last || last.toolCalls.length === 0) return false;
  return (
    last.toolResults.length === last.toolCalls.length &&
    last.toolResults.every(
      (r) =>
        SELF_CONTAINED_BLOCK_TOOLS[r.toolName]?.safeParse(r.output).success ===
        true
    )
  );
}

/**
 * The reminder added to the system prompt for the step after a result that
 * rendered a block (#1102). Walks saw the agent list the invitations or rows
 * it had just shown; Response Style alone didn't hold, so the rule is
 * repeated at the one step where a recap happens. It names the tools whose
 * results rendered (the system prompt sits before the messages, so "the
 * result above" would point nowhere), keeps the answer to a question the
 * block holds ("Q3 revenue was $1.24M."), and, when the step ran other
 * tools, leaves their results to be explained or relayed as usual.
 */
export function renderedBlockReminder(
  renderedTools: readonly string[],
  stepHadOtherCalls: boolean
): string {
  const names = [...new Set(renderedTools)].map((t) => `\`${t}\``);
  const subject =
    names.length === 1
      ? `The result of ${names[0]} is`
      : `The results of ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are`;
  return (
    `${subject} already on screen as a block. Don't list or restate the ` +
    "block's rows or contents. If it answers the user's question, give " +
    "that answer in one sentence; otherwise reply with nothing, or with one " +
    "sentence the block doesn't show." +
    (stepHadOtherCalls
      ? " This covers only those results: explain or relay your other tool " +
        "results from that step as usual, including any that failed."
      : "")
  );
}

/**
 * The reminder added to every step of a turn (#1102). The smoke walk saw
 * preambles between calls ("Let me peek at the data…", "Now charting
 * them:") after scalar results and rendered blocks alike, and in a turn's
 * first step ("Let me look up both the pending invitations…"), with
 * Response Style in the prompt; this repeats the rule at the end of the
 * system prompt on every step. Explanation isn't forbidden, only moved after
 * the last call, and a step with no tool call (a clarifying question) is
 * untouched by it.
 */
export const NEXT_TOOL_REMINDER =
  "When you call a tool, call it with no text before it: no " +
  '"Let me…", "Now…" or note of what you found so far. Keep any ' +
  "explanation for your reply after your last tool call.";

/**
 * The `prepareStep` for a portal turn (#1102): when results of the previous
 * step rendered display blocks (built-in or a custom tool's payload, both
 * via `resolveDisplayBlock`), that step's system prompt gains
 * {@link renderedBlockReminder} naming those tools. The turn carries on, so
 * a table can still be charted. Every step, the first included, gets
 * {@link NEXT_TOOL_REMINDER}.
 */
export function narrationStepPrep(system: string) {
  return ({
    steps,
  }: {
    steps: ReadonlyArray<{
      toolCalls?: ReadonlyArray<{ toolName: string }>;
      toolResults: ReadonlyArray<{ toolName: string; output: unknown }>;
    }>;
  }): { system?: string } => {
    const last = steps[steps.length - 1];
    if (!last) return { system: `${system}\n\n${NEXT_TOOL_REMINDER}` };
    // A failed call has no result, so count calls, not results.
    const calls = last.toolCalls?.length ?? last.toolResults.length;
    // Arrays included: resolveDisplayBlock renders a bare row array as a
    // table, exactly as handleToolResult passes it.
    const rendered = last.toolResults
      .filter(
        (r) =>
          r.output !== null &&
          typeof r.output === "object" &&
          resolveDisplayBlock(
            r.toolName,
            r.output as Record<string, unknown>
          ) !== null
      )
      .map((r) => r.toolName);
    const reminders =
      rendered.length > 0
        ? [renderedBlockReminder(rendered, calls > rendered.length)]
        : [];
    reminders.push(NEXT_TOOL_REMINDER);
    return { system: [system, ...reminders].join("\n\n") };
  };
}

/**
 * A tool call's input as an object, whatever the stream produced (#1049).
 * When the model emits invalid JSON for a tool's input, the SDK hands back
 * the raw text; stored and later replayed as a string, it makes the model API
 * refuse every later turn ("tool_use.input: Input should be an object"). A
 * string that parses to an object is used as that object; anything else is
 * `{}` (the call already failed, and its tool-result says why).
 */
export function asToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON: fall through to an empty input.
    }
  }
  return {};
}

/** Handle a text-delta chunk: accumulate text and send SSE. */
function handleTextDelta(ctx: StreamContext, text: string): void {
  ctx.currentText += text;
  const event: DeltaEvent = { type: "delta", content: text };
  ctx.sse.send("delta", event);
}

/**
 * Handle a tool-call chunk: flush text, persist tool-call block, and open a
 * client-side activity step (#279).
 *
 * The `tool_call` event is the only signal the frontend has that a tool is
 * running: a tool turn's first delta is usually a one-line preamble, after
 * which the feed would sit frozen for the tool's whole duration.
 */
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
    // AI SDK v6 renamed `args` → `input`. Always stored as an object (#1049).
    input: asToolInput(chunk.input ?? chunk.args),
  });

  const toolCallId = chunk.toolCallId as string | undefined;
  if (chunk.invalid === true && typeof toolCallId === "string") {
    ctx.invalidToolCalls.set(toolCallId, chunk.error);
  }
  // Without an id the client can't pair the close event — emitting anyway
  // would open a step that never closes, which is worse than no step.
  if (typeof toolCallId === "string" && toolCallId.length > 0) {
    const event: ToolCallEvent = {
      type: "tool_call",
      toolCallId,
      toolName: chunk.toolName as string,
    };
    ctx.sse.send("tool_call", event);
  }
}

/**
 * Handle a tool-result chunk: persist the raw tool-result block for
 * ModelMessage reconstruction, close the client's activity step (#279), then
 * detect display block types and emit SSE events + display blocks as needed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleToolResult(ctx: StreamContext, chunk: any): void {
  const toolResult = chunk.output as Record<string, unknown>;
  const toolName = chunk.toolName as string;
  const toolCallId = chunk.toolCallId as string | undefined;

  // Persist tool-result part for ModelMessage[] reconstruction. #1038: a row
  // result keeps its shape (columns, count, query), never its rows.
  ctx.assistantBlocks.push({
    type: "tool-result",
    toolCallId,
    toolName,
    content: toStoredToolResult(toolResult),
  });

  // Close the step FIRST, and unconditionally — deliberately outside the
  // display-block branch below (#279). A scalar-result tool (hypothesis_test,
  // regression, the entity writers) emits no `tool_result` at all, so closing
  // inside that branch would leave its step open for the rest of the turn.
  if (typeof toolCallId === "string" && toolCallId.length > 0) {
    const endEvent: ToolCallEndEvent = {
      type: "tool_call_end",
      toolCallId,
      toolName,
    };
    ctx.sse.send("tool_call_end", endEvent);
  }

  const displayBlock = resolveDisplayBlock(toolName, toolResult);
  if (displayBlock) {
    const event: ToolResultEvent = {
      type: "tool_result",
      toolName,
      result: displayBlock.sseResult ?? toolResult,
    };
    ctx.sse.send("tool_result", event);
    // #1038: the live stream above carries the rows the reader may see now;
    // the stored block keeps only the recipe that re-reads them as its reader.
    const block = displayBlock.block;
    ctx.assistantBlocks.push(
      typeof block.type === "string" && RESULT_BLOCK_TYPES.has(block.type)
        ? { ...block, content: toStoredBlockContent(block.type, block.content) }
        : block
    );
  }
}

/** The zod issue messages somewhere down an error's `cause` chain, if any. */
function issueMessages(error: unknown): string[] {
  for (let e = error, depth = 0; e && depth < 5; depth++) {
    const issues = (e as { issues?: { message?: unknown }[] }).issues;
    if (Array.isArray(issues)) {
      return issues
        .map((i) => i.message)
        .filter((m): m is string => typeof m === "string");
    }
    e = (e as { cause?: unknown }).cause;
  }
  return [];
}

/**
 * Handle a tool-error chunk (#846): the AI SDK refused the call's input
 * against the tool's schema, or the tool threw. Close the client's activity
 * step and persist a typed tool-result in place of the missing one, so the
 * step doesn't hang for the rest of the turn and the call isn't stripped from
 * history as an orphan.
 *
 * A refusal keeps the schema's reasons (the SDK's own message embeds the whole
 * input). A thrown error's text is logged, never stored: it can carry raw DB
 * detail (#687), and history is readable by everyone in the session.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleToolError(ctx: StreamContext, chunk: any): void {
  const toolName = chunk.toolName as string;
  const toolCallId = chunk.toolCallId as string | undefined;
  const error = chunk.error as unknown;

  // The refusal's error object is on the call's `tool-call` part; this
  // chunk's `error` is only its message (see StreamContext.invalidToolCalls).
  const invalidInput =
    typeof toolCallId === "string" && ctx.invalidToolCalls.has(toolCallId);
  const reasons = invalidInput
    ? issueMessages(ctx.invalidToolCalls.get(toolCallId))
    : [];
  if (!invalidInput) {
    logger.warn(
      {
        toolName,
        toolCallId,
        error,
      },
      "Tool threw during a portal turn"
    );
  }

  ctx.assistantBlocks.push({
    type: "tool-result",
    toolCallId,
    toolName,
    content: {
      error: invalidInput
        ? {
            code: ApiCode.TOOL_INPUT_INVALID,
            message:
              reasons.join("; ") ||
              "The tool input didn't match the tool's schema.",
          }
        : {
            code: ApiCode.TOOL_EXECUTION_FAILED,
            message: "The tool failed while running.",
          },
    },
  });

  if (typeof toolCallId === "string" && toolCallId.length > 0) {
    const endEvent: ToolCallEndEvent = {
      type: "tool_call_end",
      toolCallId,
      toolName,
    };
    ctx.sse.send("tool_call_end", endEvent);
  }
}

/**
 * Determine if a tool result should produce a display block for inline
 * rendering. Returns null for scalar/non-display results.
 *
 * Exported for unit testing.
 */
export function resolveDisplayBlock(
  toolName: string,
  toolResult: Record<string, unknown> | null
): {
  block: Record<string, unknown>;
  sseResult?: Record<string, unknown>;
} | null {
  const resultKind = ALL_TOOL_CAPABILITIES[toolName]?.resultKind;

  // Progress (async bulk job): content-carried `blockKind`, robust
  // regardless of the declared kind. The frontend mounts a live-data
  // widget against the job id (#85 Phase 2).
  if (
    toolResult != null &&
    toolResult.blockKind === "bulk-job-progress" &&
    typeof toolResult.blockContent === "object"
  ) {
    return {
      block: {
        type: "bulk-job-progress",
        content: toolResult.blockContent as Record<string, unknown>,
      },
    };
  }

  // D3 (#269). visualize_d3 is `resultKind: "d3"`, but on codegen failure it
  // falls back to a `type: "data-table"` result — so the d3 block only mints
  // when the result is actually tagged `d3`; the fallback falls through to the
  // data-table arm below (which also matches on `toolResult.type`).
  if (
    (resultKind === "d3" ||
      (resultKind === undefined && toolResult?.type === "d3")) &&
    toolResult?.type === "d3"
  ) {
    return {
      block: { type: "d3", content: toolResult },
      sseResult: toolResult ?? undefined,
    };
  }

  // Geo (#314). visualize_map is `resultKind: "geo"`; the `resultKind ===
  // undefined` fallback mirrors the d3 arm so a geo result still routes by its
  // `type` tag before the capability lands (slice 3 pins the capability).
  if (
    (resultKind === "geo" ||
      (resultKind === undefined && toolResult?.type === "geo")) &&
    toolResult?.type === "geo"
  ) {
    return {
      block: { type: "geo", content: toolResult },
      sseResult: toolResult ?? undefined,
    };
  }

  // Help (#1049). platform_help's result is the block, built here from the
  // tool's own output so the quoted entries reach the user exactly as the
  // tool chose them; the model's text sits outside the block. A result that
  // isn't a valid help block makes no block at all.
  if (resultKind === "help") {
    const parsed = HelpBlockContentSchema.safeParse(toolResult);
    if (!parsed.success) return null;
    return {
      block: { type: "help", content: parsed.data },
      sseResult: parsed.data,
    };
  }

  // Invitation (#847). member_invite / invitation_show return an invitation
  // without its link; the block's button gets a fresh link in the browser.
  // The schema is strict, so a result carrying a link (or a relayed
  // { error, code }) makes no block.
  if (resultKind === "invitation") {
    const parsed = InvitationBlockContentSchema.safeParse(toolResult);
    if (!parsed.success) return null;
    return {
      block: { type: "invitation", content: parsed.data },
      sseResult: parsed.data,
    };
  }

  if (resultKind === "data-table" || toolResult?.type === "data-table") {
    // Handle path (#85 Phase 1): the tool returned a queryHandle
    // envelope instead of inline rows. Route it through the
    // streaming-table block so the frontend hydrates via the Redis
    // snapshot. The envelope is the block content verbatim (web layer
    // detects `queryHandle` + renders QueryResultDataBlock).
    if (toolResult != null && typeof toolResult.queryHandle === "string") {
      const handleContent = {
        type: "data-table" as const,
        queryHandle: toolResult.queryHandle,
        rowCount: toolResult.rowCount,
        schema: toolResult.schema,
        samplePeek: toolResult.samplePeek,
        sampled: toolResult.sampled,
        // #349: the durable pipeline must survive the whitelist — dropping it
        // here is what made every table block terminal. Spread so a legacy
        // result (no pipeline) leaves the key absent rather than undefined.
        ...(toolResult.pipeline != null
          ? { pipeline: toolResult.pipeline }
          : {}),
      };
      return {
        block: { type: "data-table" as const, content: handleContent },
        sseResult: handleContent,
      };
    }
    const rows = Array.isArray(toolResult)
      ? (toolResult as Record<string, unknown>[])
      : Array.isArray(toolResult?.rows)
        ? (toolResult!.rows as Record<string, unknown>[])
        : [];
    // #120: never surface an empty data-table. A data-table tool whose
    // result carries neither a handle nor rows produces no block — this
    // is what made cluster/detect_outliers (now resultKind "scalar")
    // emit spurious empty widgets when they were in ROW_SET_TOOLS.
    if (rows.length === 0) return null;
    const columns = Object.keys(rows[0] as object);
    const dataTableContent = {
      type: "data-table" as const,
      columns,
      rows,
      // #349: see the handle arm above — inline tables were the other half of
      // the terminal-snapshot defect.
      ...(toolResult?.pipeline != null
        ? { pipeline: toolResult.pipeline }
        : {}),
    };
    return {
      block: { type: "data-table" as const, content: dataTableContent },
      sseResult: dataTableContent,
    };
  }

  if (
    resultKind === "mutation-result" &&
    toolResult != null &&
    toolResult.success === true &&
    typeof toolResult.operation === "string" &&
    typeof toolResult.entity === "string" &&
    Array.isArray(toolResult.items) &&
    toolResult.items.length > 0
  ) {
    const items = toolResult.items as {
      entityId: string;
      summary?: Record<string, unknown>;
    }[];
    const base = {
      type: "mutation-result" as const,
      operation: toolResult.operation as "created" | "updated" | "deleted",
      entity: toolResult.entity as string,
    };
    const mutationContent =
      items.length === 1
        ? { ...base, item: items[0] }
        : { ...base, count: items.length, items };
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
   *
   * #1079: an `initialMessage` (already trimmed by the contract) is the
   * portal's first user turn. The order is fixed so an invalid or refused
   * request never consumes a turn: validate, then ask the agent-turn ceiling,
   * then write the portal and (when admitted) its user row in one
   * transaction. A refused message still creates the portal; the outcome
   * says why there's no turn.
   *
   * Admission counts the turn as it admits it, so a write that fails after
   * admission (a DB error, a pool admission timeout) still counts one turn
   * against the ceiling with nothing stored. The send route behaves the same
   * way: its admission also runs before its write. The ceiling is a rate
   * limit on attempts, not a ledger, so this isn't compensated (#1137 code
   * review).
   */
  static async createPortal({
    stationId,
    organizationId,
    userId,
    initialMessage,
  }: {
    stationId: string;
    organizationId: string;
    userId: string;
    initialMessage?: string;
  }): Promise<CreatePortalResult> {
    const repo = DbService.repository;

    // Validate station exists and belongs to the org
    const station = await repo.stations.findById(stationId);
    if (!station || station.organizationId !== organizationId) {
      throw new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found");
    }

    // Validate the station has at least one tool pack enabled, of **either**
    // kind (#306). This used to count built-in slugs only, which made a
    // custom-only station unable to open a portal at all — a phase-1 rule that
    // outlived its era: since #214 `buildAnalyticsTools` accepts
    // builtin-or-custom (`tools.service.ts:416`), so the executor already
    // treats a custom-only station as valid.
    const enabled = await repo.stationToolpacks.findByStationId(stationId);
    const enabledPackCount = enabled.filter(
      (r) => r.builtinSlug !== null || r.organizationToolpackId !== null
    ).length;
    if (enabledPackCount === 0) {
      throw new ApiError(
        400,
        ApiCode.PORTAL_STATION_NO_TOOLS,
        "Station must have at least one tool pack enabled"
      );
    }

    // Auto-generate portal name from current date
    const now = SystemUtilities.utc.now().getTime();
    const name = `Portal — ${SystemUtilities.utc.format(now, "MMM d, yyyy")}`;

    // Admission runs after validation and before any write, so a station
    // that can't open a portal never burns a turn.
    const admission =
      initialMessage === undefined
        ? undefined
        : await AgentTurnCeilingService.checkAdmission(organizationId);

    const portal = await DbService.transaction(async (tx) => {
      const created = await repo.portals.create(
        {
          id: SystemUtilities.id.v4.generate(),
          organizationId,
          stationId,
          name,
          lastOpened: null,
          created: now,
          createdBy: userId,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
        tx
      );
      if (initialMessage !== undefined && admission?.allowed) {
        // The row shape `addMessage` writes for a sent turn.
        await repo.portalMessages.create(
          {
            id: SystemUtilities.id.v4.generate(),
            portalId: created.id,
            organizationId,
            role: "user",
            blocks: [{ type: "text", content: initialMessage }],
            created: now,
            createdBy: userId,
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
          },
          tx
        );
      }
      return created;
    });

    let outcome: InitialMessageOutcome | undefined;
    if (admission) {
      outcome = admission.allowed
        ? { status: "pending" }
        : {
            status: "refused",
            code: "AGENT_TURN_LIMITED",
            message: AgentTurnCeilingService.refusalMessage(admission),
            retryAfterSeconds: admission.retryAfterSeconds,
          };
    }

    const stationContext = await buildStationContext({
      station,
      organizationId,
      userId,
    });

    logger.info(
      { portalId: portal.id, stationId, initialMessage: outcome?.status },
      "Portal created"
    );
    return {
      portalId: portal.id,
      stationContext,
      ...(outcome && { initialMessage: outcome }),
    };
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
    opts?: { include?: string[] }
  ): Promise<PortalWithMessages> {
    const repo = DbService.repository;

    const portal = await repo.portals.findById(portalId);
    if (!portal) {
      throw new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");
    }

    // #1038: a message stored before rows stopped being kept still leaves the
    // API without them, to the UI and to the model alike.
    const messages = (await repo.portalMessages.findByPortal(portalId)).map(
      stripStoredMessage
    );
    // #726 (review): the model messages are built on access only. The UI's
    // GET reads portal + messages and never pays for the projection.
    let coreMessages: ModelMessage[] | undefined;

    const result: PortalWithMessages = {
      portal,
      messages,
      get coreMessages() {
        return (coreMessages ??= reconstructModelMessages(messages));
      },
    };

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
    { role, content }: { role: "user" | "assistant"; content: string },
    /** #685: the caller who sent it; the message is theirs. */
    userId: string
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
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    });
  }

  // -------------------------------------------------------------------------
  // notifyJobTerminal (#85 Phase 2 slice 3)
  // -------------------------------------------------------------------------

  /**
   * Called by the worker hook after a portal-bound job reaches a
   * terminal status. Two side effects:
   *
   *   1. Persist a synthetic assistant-role message into the portal's
   *      message history. The message is template-driven (text summary
   *      + a failure-table block when applicable); no agent re-prompt.
   *   2. Publish a `bulk_job_terminal` event on the portal-events
   *      Pub/Sub channel so live clients see the terminal event
   *      immediately and unlock the chat input.
   *
   * Idempotency: the assistant message is keyed on jobId via a tag in
   * the block content. A second call for the same jobId would create a
   * duplicate row today — the worker hook (see jobs.worker.ts) guards
   * against double-invocation by checking the job's status before
   * firing.
   */
  static async notifyJobTerminal(
    portalId: string,
    jobId: string,
    terminal: {
      status: "completed" | "failed" | "cancelled";
      recordsProcessed: number;
      recordsFailed: number;
      durationMs: number;
      partialFailures?: Array<{
        sourceKey: string;
        error: Record<string, unknown>;
      }>;
      errorMessage?: string;
    }
  ): Promise<void> {
    const repo = DbService.repository;
    const portal = await repo.portals.findById(portalId);
    if (!portal) {
      logger.warn(
        { portalId, jobId },
        "notifyJobTerminal: portal not found; skipping"
      );
      return;
    }

    // #685: the message (and its precompute) belongs to the member who started
    // the job, read from the job row rather than inferred from the portal.
    const job = await repo.jobs.findById(jobId);
    const authorId = job?.createdBy ?? portal.createdBy;

    const blocks: Record<string, unknown>[] = [];

    if (terminal.status === "completed") {
      const ok = terminal.recordsProcessed - terminal.recordsFailed;
      const seconds = Math.max(1, Math.round(terminal.durationMs / 1000));
      blocks.push({
        type: "text",
        content:
          terminal.recordsFailed > 0
            ? `Done — ${ok} records written, ${terminal.recordsFailed} failed in ${seconds}s.`
            : `Done — ${terminal.recordsProcessed} records written in ${seconds}s.`,
      });
    } else if (terminal.status === "cancelled") {
      blocks.push({
        type: "text",
        content: `Cancelled at ${terminal.recordsProcessed} records. Already-committed batches are preserved.`,
      });
    } else {
      blocks.push({
        type: "text",
        content: `Failed: ${terminal.errorMessage ?? "the job did not complete"}.`,
      });
    }

    if (terminal.partialFailures && terminal.partialFailures.length > 0) {
      blocks.push({
        type: "bulk-failures-table",
        content: {
          jobId,
          failures: terminal.partialFailures,
        },
      });
    }

    const now = SystemUtilities.utc.now().getTime();
    const bulkMessageId = SystemUtilities.id.v4.generate();
    await repo.portalMessages.create({
      id: bulkMessageId,
      portalId,
      organizationId: portal.organizationId,
      role: "assistant",
      blocks: storableBlocks(blocks, portalId),
      created: now,
      createdBy: authorId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    });
    // #542: precompute dissolve coverage for any large polygon map block so its
    // low-zoom tiles never-drop before the user pins.
    await Promise.all(
      blocks.map((block, blockIndex) =>
        DissolvePrecomputeService.enqueueForMessageBlock({
          messageId: bulkMessageId,
          blockIndex,
          organizationId: portal.organizationId,
          userId: authorId,
          block,
        })
      )
    );

    const channel = `${PORTAL_EVENTS_CHANNEL_PREFIX}${portalId}`;
    const redis = getRedisClient();
    await redis.publish(
      channel,
      JSON.stringify({
        type: "bulk_job_terminal",
        jobId,
        portalId,
        status: terminal.status,
        recordsProcessed: terminal.recordsProcessed,
        recordsFailed: terminal.recordsFailed,
        timestamp: now,
      })
    );

    logger.info(
      {
        portalId,
        jobId,
        status: terminal.status,
        recordsProcessed: terminal.recordsProcessed,
      },
      "notifyJobTerminal: assistant message persisted + portal SSE published"
    );
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
   *  - `tool_result` — d3 chart, data-table, or structured result
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
      portalId
    );

    // streamText() is lazy in AI SDK v6 — it returns immediately and
    // errors surface during fullStream iteration or as "error" chunks.
    const result = streamText({
      model: AiService.providers.anthropic(AiService.DEFAULT_MODEL),
      system: systemPrompt,
      messages,
      tools: analyticsTools,
      stopWhen: [stepCountIs(10), endsOnSelfContainedBlocks],
      prepareStep: narrationStepPrep(systemPrompt),
      maxRetries: 3,
    });

    // Accumulate assistant content blocks (full ModelMessage[] parts)
    const ctx: StreamContext = {
      assistantBlocks: [],
      sse,
      currentText: "",
      invalidToolCalls: new Map(),
    };

    try {
      for await (const chunk of result.fullStream) {
        if (chunk.type === "text-delta") {
          handleTextDelta(ctx, chunk.text);
        } else if (chunk.type === "tool-call") {
          handleToolCall(ctx, chunk);
        } else if (chunk.type === "tool-result") {
          handleToolResult(ctx, chunk);
        } else if (chunk.type === "tool-error") {
          handleToolError(ctx, chunk);
        } else if (chunk.type === "error") {
          // AI SDK v6 emits error chunks instead of always throwing.
          // Surface the error to the client and abort the stream.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const err = (chunk as any).error;
          const message =
            err instanceof Error
              ? err.message
              : String(err ?? "Unknown AI error");
          logger.error({ portalId, error: err }, "AI stream error chunk");
          sse.sendError(message);
          return;
        } else if (chunk.type === "finish") {
          if (ctx.currentText) {
            ctx.assistantBlocks.push({
              type: "text",
              content: ctx.currentText,
            });
            ctx.currentText = "";
          }
        }
      }
    } catch (error) {
      // Thrown errors (e.g. network failures, validation) also land here.
      const message =
        error instanceof Error
          ? error.message
          : "An error occurred during streaming";
      logger.error({ portalId, error }, "AI stream error");
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
    const assistantBlocks = storableBlocks(
      ctx.assistantBlocks.filter(
        (b) => b.type !== "tool-call" || resultIds.has(b.toolCallId)
      ),
      portalId
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
      // #685: the turn runs as the caller; its reply is theirs.
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    });
    // #542: precompute dissolve coverage for any large polygon map block so its
    // low-zoom tiles never-drop before the user pins.
    await Promise.all(
      assistantBlocks.map((block, blockIndex) =>
        DissolvePrecomputeService.enqueueForMessageBlock({
          messageId: savedMessage.id,
          blockIndex,
          organizationId: portal.organizationId,
          userId,
          block,
        })
      )
    );

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

  // -------------------------------------------------------------------------
  // replayTurn (#504)
  // -------------------------------------------------------------------------

  /**
   * Re-emit a persisted assistant turn over SSE **without calling the model**.
   *
   * The #504 reconnect guard uses this: when a dropped `EventSource`
   * reconnects and the turn is already answered (or completes while the
   * reconnect waits), the stored blocks are replayed as the same
   * `delta` / `tool_result` events a live turn produces — closing the
   * double-spend while keeping the answer visible with zero web change.
   *
   * It walks the same two block kinds `streamResponse` emits to the client:
   * `text` parts become `delta`, and raw `tool-result` parts are routed
   * through {@link resolveDisplayBlock} (identical to the live
   * `handleToolResult` path) so a display result re-emits its `tool_result`.
   * `tool-call` parts and the derived display blocks are skipped — the former
   * has no render, the latter is reconstructed client-side from the
   * `tool_result` event. No `tool_call` / `tool_call_end` steps are sent: the
   * turn is already complete, so the transient activity spinner has nothing to
   * show.
   */
  static replayTurn(
    sse: SseUtil,
    storedMessage: PortalMessageSelect,
    portalId: string
  ): void {
    // #1038: replays what the message keeps, never rows. A table's event then
    // carries no data; the client refetches the portal on `done` and its
    // persisted widgets read live.
    const assistantMessage = stripStoredMessage(storedMessage);
    for (const block of assistantMessage.blocks) {
      const type = block.type as string | undefined;

      if (type === "text" && typeof block.content === "string") {
        const event: DeltaEvent = { type: "delta", content: block.content };
        sse.send("delta", event);
        continue;
      }

      if (type === "tool-result") {
        const toolName = block.toolName as string | undefined;
        if (!toolName) continue;
        const content =
          (block.content as Record<string, unknown> | undefined) ?? null;
        const display = resolveDisplayBlock(toolName, content);
        if (display) {
          const event: ToolResultEvent = {
            type: "tool_result",
            toolName,
            result: display.sseResult ?? content ?? undefined,
          };
          sse.send("tool_result", event);
        }
      }
    }

    const doneEvent: DoneEvent = {
      type: "done",
      portalId,
      messageId: assistantMessage.id,
    };
    sse.send("done", doneEvent);

    logger.info(
      { portalId, messageId: assistantMessage.id },
      "Portal turn replayed (no model call)"
    );
  }
}

// ---------------------------------------------------------------------------
// ModelMessage[] reconstruction
// ---------------------------------------------------------------------------

/**
 * Number of most-recent assistant messages whose tool results are replayed in
 * full. Older tool results are replaced with a compact summary.
 */
const RECENT_TURNS_FULL_RESULTS = 2;

/**
 * #1038: a row result is never stored, so history names its shape — columns,
 * count — and says to re-run it for values. Applied to whatever the message
 * holds, so a caller that skipped `stripStoredMessage` replays no rows either.
 */
function storedSummary(toolName: string, content: unknown): string | null {
  const stored = toStoredToolResult(content);
  return isStoredResultSummary(stored)
    ? describeStoredResult(toolName, stored)
    : null;
}

/** Prefixes a replayed text result (see {@link replayResult}). */
export const EARLIER_TURN_PREFIX = "[From an earlier turn]";

/**
 * #726: a recent turn's tool result as the model reads it on replay — the same
 * projection the live step sent (`toModelOutput`), so the model's account of
 * a result doesn't change between turns. A row result is its stored summary.
 *
 * #1071 (adversarial walk): every replayed result is from an earlier turn,
 * and it says so. Unmarked, the model took a previous turn's `tag_list` and
 * `tag_target_list` results for this turn's ("Already done this turn"),
 * naming a station deleted since and a pack removed since. A row summary
 * already reads "[Previous … result: …]"; anything else is wrapped as
 * `{ fromEarlierTurn: true, result }`, or prefixed when it's text, and the
 * prompt says what the mark means.
 */
function replayResult(toolName: string, content: unknown): unknown {
  const summary = storedSummary(toolName, content);
  if (summary) return summary;
  const view = toModelView(content);
  if (view === undefined) return view;
  return typeof view === "string"
    ? `${EARLIER_TURN_PREFIX} ${view}`
    : { fromEarlierTurn: true, result: view };
}

/**
 * A compact placeholder for an older turn's tool result, so the model knows
 * the tool was called without the full payload.
 */
function summarizeToolResult(toolName: string, content: unknown): string {
  return (
    storedSummary(toolName, content) ??
    `[Previous ${toolName} result — truncated]`
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
          // AI SDK v6 renamed `args` → `input`. Rows saved before #1049 may
          // hold a malformed call's raw string; replay it as an object, or
          // `{}`, so one bad call can't break every later turn.
          input: asToolInput(block.input ?? block.args),
        });
      } else if (block.type === "tool-result") {
        const toolName = String(block.toolName ?? "tool");
        const raw = truncateResults
          ? summarizeToolResult(toolName, block.content)
          : replayResult(toolName, block.content);

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
      // Display-only blocks (d3, data-table) are skipped —
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

/**
 * Load connector-instance contexts for the prompt.
 *
 * Pulled into a helper so the load order is explicit: station_instances
 * → connector_instances → connector_definitions. Returns the safe
 * projection: `id, name, display, slug`. Never includes
 * `config`, `credentials`, or `lastErrorMessage`.
 */
/**
 * Resolve the IANA timezone for an organization. Falls back to "UTC"
 * with a logger.warn when the stored value isn't a recognized IANA
 * name. Shared by `createPortal` (session start) and the events router
 * (reconnect) so both code paths produce a `StationContext` with the
 * same timezone semantics.
 */
export async function loadOrganizationTimezone(
  organizationId: string
): Promise<string> {
  const org = await DbService.repository.organizations.findById(organizationId);
  const rawTz = org?.timezone ?? "UTC";
  if (isValidIanaTimezone(rawTz)) return rawTz;
  logger.warn(
    { organizationId, badValue: rawTz },
    "Org timezone is not a recognized IANA name, falling back to UTC"
  );
  return "UTC";
}

/**
 * Build a fresh StationContext from current DB state. Called by both
 * the portal-creation path AND the per-message stream path
 * (`portal-events.router.ts`) so each chat turn sees up-to-date
 * `connectorInstances` and `entityCapabilities` — connectors attached
 * mid-session must show up in the next turn's system prompt.
 *
 * Caller passes in the resolved `station` row; the **configured** packs are
 * read from `station_toolpacks` here rather than accepted as an argument
 * (#307). That parameter used to exist to save a re-fetch when the caller
 * already had the rows in scope — and it was how the streaming path came to
 * pass `(station as any).toolPacks`, a field no station row carries, so every
 * streamed turn built its context from `[]` and the prompt's capability
 * surface was empty. Deriving here costs one query the create path repeats
 * and makes the wrong-array bug unrepresentable.
 *
 * The split against the org's entitlements also happens inside (#284) —
 * callers do not pre-filter, and must not.
 */
export async function buildStationContext(args: {
  station: { id: string; name: string };
  organizationId: string;
  /** #599: the caller — the roster is scoped to their granted curated views
   *  (the same resolution the SQL session uses), so a member is never told
   *  about entities/columns they cannot query. */
  userId: string;
}): Promise<StationContext> {
  const { station, organizationId, userId } = args;

  // #1100: who the agent is talking to, from the same request identity that
  // authorizes the turn, scoped to this organization. Started now, since it
  // depends on nothing below. A missing membership (proven upstream) or a
  // failed lookup degrades to the id alone; it never fails a turn.
  const callerPromise: Promise<CallerIdentity> = SeatService.getMember(
    organizationId,
    userId
  )
    .catch((error: unknown) => {
      logger.warn(
        { organizationId, userId, error },
        "Caller lookup failed; the prompt names the userId only"
      );
      return null;
    })
    .then((member) =>
      member
        ? {
            userId,
            name: member.name,
            email: member.email,
            roles: member.roles,
            roleSlugs: member.roleSlugs,
          }
        : { userId, name: null, email: null, roles: [], roleSlugs: [] }
    );

  // The station's packs — built-in and custom — from the one derivation that
  // reads both columns of the join table (#306).
  //
  // #284: configured ≠ available. buildAnalyticsTools has filtered packs
  // against the tier since #214, so a context built from the configured set
  // described tools that didn't exist in the same session. Everything below
  // gates on `effective`.
  const {
    effective: effectiveToolPacks,
    unentitled: unentitledToolPacks,
    otherPlanPacks: otherPlanToolPacks,
    customPacks: customToolPacks,
    excludedCustomPacks: excludedCustomToolPacks,
  } = await EntitlementService.resolveStationPacks(station.id, organizationId);

  const stationData = await AnalyticsService.loadStation(
    station.id,
    organizationId
  );
  const entityManagementAvailable =
    effectiveToolPacks.includes("entity_management");
  const entityCapabilities = entityManagementAvailable
    ? await resolveEntityCapabilities(station.id)
    : undefined;
  const connectorInstances: ConnectorInstanceContext[] | undefined =
    entityManagementAvailable
      ? await loadConnectorInstanceContexts(station.id)
      : undefined;
  // #615: the rule buildAnalyticsTools builds the geocode tools by, so the
  // GIS section never offers a tool the session lacks. A prompt is always
  // for a portal session.
  const gisAvailable = effectiveToolPacks.includes("gis");
  const geocoding = geocodingTools({ gis: gisAvailable, inPortal: true });
  const geocodingAvailable = gisAvailable ? geocoding.geocode : undefined;
  // #824: the same resolution the write gate uses, so the prompt says writes
  // are off exactly when the gate withheld the write tools. Only needed when
  // a write tool could exist: entity management, or bulk geocoding (#615).
  const stationWritable =
    entityManagementAvailable || geocoding.bulkGeocode
      ? (await resolveStationCapabilities(station.id)).some(
          (c) => c.capabilities.write
        )
      : undefined;
  const organizationTimezone = await loadOrganizationTimezone(organizationId);

  // #599: the roster shows the caller's granted curated views (view key is the
  // queryable name), with each view's columns filtered to what the caller may
  // read — the same resolution the SQL session uses, so the two never disagree.
  // An admin resolves all attached views (via `*`); a member only their grants.
  const { views: grantedViewColumns } =
    await PortalSqlService.resolveGrantedViewColumns(
      station.id,
      organizationId,
      userId
    );
  const stationEntitiesById = new Map(
    stationData.entities.map((e) => [e.id, e])
  );
  const entities: EntitySchema[] = grantedViewColumns.map(
    ({ view, columns }) => {
      const readableFmIds = new Set(columns.map((c) => c.fieldMappingId));
      const src = stationEntitiesById.get(view.connectorEntityId);
      return {
        id: view.connectorEntityId,
        key: view.key,
        label: view.label,
        connectorInstanceId: src?.connectorInstanceId ?? "",
        columns: (src?.columns ?? []).filter((col) =>
          readableFmIds.has(col.fieldMappingId)
        ),
      };
    }
  );

  return {
    stationId: station.id,
    stationName: station.name,
    caller: await callerPromise,
    organizationTimezone,
    entities,
    // #648: scope the entity-group section to the same granted views as the
    // roster above — otherwise it leaks structure metadata for entities the
    // caller cannot query.
    entityGroups: scopeEntityGroupsToEntities(
      stationData.entityGroups,
      grantedViewColumns
    ),
    effectiveToolPacks,
    unentitledToolPacks,
    otherPlanToolPacks,
    customToolPacks,
    excludedCustomToolPacks,
    entityCapabilities,
    connectorInstances,
    stationWritable,
    geocodingAvailable,
    // #674: attachment counts for the empty-station lines.
    attachments: await StationAttachmentService.countsForCaller(
      station.id,
      organizationId,
      userId
    ),
  };
}

export async function loadConnectorInstanceContexts(
  stationId: string
): Promise<ConnectorInstanceContext[]> {
  const links = await stationInstancesRepo.findByStationId(stationId);
  if (links.length === 0) return [];

  const instances = await Promise.all(
    [...new Set(links.map((l) => l.connectorInstanceId))].map((id) =>
      connectorInstancesRepo.findById(id)
    )
  );
  const liveInstances = instances.filter(
    (i): i is NonNullable<typeof i> => i !== null && i !== undefined
  );

  const defIds = [
    ...new Set(liveInstances.map((i) => i.connectorDefinitionId)),
  ];
  const defs = await Promise.all(
    defIds.map((id) => connectorDefinitionsRepo.findById(id))
  );
  const defMap = new Map(
    defs
      .filter((d): d is NonNullable<typeof d> => d !== null && d !== undefined)
      .map((d) => [d.id, d])
  );

  const result: ConnectorInstanceContext[] = [];
  for (const inst of liveInstances) {
    const def = defMap.get(inst.connectorDefinitionId);
    if (!def) continue;
    result.push({
      id: inst.id,
      name: inst.name,
      display: def.display,
      slug: def.slug,
      writable: resolveCapabilities(def, inst).write,
    });
  }
  return result;
}
