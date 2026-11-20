import { useState, useRef, useEffect, useCallback } from "react";

import type {
  PortalMessageResponse,
  PortalMessageBlock,
  DeltaEvent,
  ToolCallEvent,
  ToolCallEndEvent,
  ToolResultEvent,
  DoneEvent,
  StreamErrorEvent,
} from "@portalai/core/contracts";

import { sse } from "../api/sse.api";

// --- Types ---

/**
 * A tool call currently in flight (#279). Opened by a `tool_call` event and
 * closed by the matching `tool_call_end`.
 */
export interface ToolStep {
  toolCallId: string;
  toolName: string;
  /** Epoch ms, captured in the event handler — never during render. */
  startedAt: number;
}

export interface PortalStreamState {
  streamingBlocks: PortalMessageBlock[] | null;
  isStreaming: boolean;
  streamError: string | null;
  localMessages: PortalMessageResponse[];
  /**
   * Tool calls open right now, oldest first — so the **last** element is the
   * one the user is shown. A turn can run several tools concurrently; when the
   * newest closes, the one before it becomes current again rather than the
   * indicator going blank.
   */
  toolSteps: ToolStep[];
}

/** #1036: what a finished turn did, passed to `onTurnEnd`. */
export interface PortalStreamTurn {
  /** Every tool whose result arrived during the turn. */
  toolNames: ReadonlySet<string>;
}

export interface PortalStreamActions {
  send: (portalId: string) => Promise<void>;
  cancel: () => void;
  addLocalMessage: (msg: PortalMessageResponse) => void;
  removeLocalMessage: (id: string) => void;
  clearLocalMessages: () => void;
}

/**
 * Map a `tool_result` SSE payload to the display block to render, or `null`
 * when the result has no display shape. Charts route by the result's `type`
 * (the server tags it): `d3` for a visualize_d3 success, `data-table` for its
 * codegen fallback — so the fallback (which shares the toolName) renders as a
 * table, not an empty d3 widget.
 */
export function streamingBlockFor(
  _toolName: string,
  result: Record<string, unknown> | null
): PortalMessageBlock | null {
  if (result == null || typeof result !== "object") return null;
  const type = result["type"];

  if (type === "d3") return { type: "d3", content: result };
  if (type === "data-table") return { type: "data-table", content: result };
  if (type === "mutation-result")
    return { type: "mutation-result", content: result };
  // #1049: platform_help's verbatim help entries.
  if (type === "help") return { type: "help", content: result };
  // #847: an invitation, without its link.
  if (type === "invitation") return { type: "invitation", content: result };
  return null;
}

// --- Hook ---

/**
 * Manages the SSE stream for a portal session.
 *
 * - Opens a stream to receive assistant responses after a message is sent.
 * - Accumulates streaming blocks (text, d3, data-table, mutation-result).
 * - Finalises the assistant message into `localMessages` on `done`.
 * - Handles `stream_error` and connection loss.
 * - Cleans up EventSource on cancel or unmount.
 *
 * @param onDone - Optional callback invoked after a stream completes.
 *   Receives `clearLocalMessages` so the caller can clear optimistic messages
 *   after refetching server data without a circular dependency.
 * @param onTurnEnd - #1036: invoked once per turn however it ended — done, a
 *   stream error, a lost connection or a cancel — with the tools whose results
 *   arrived. A tool's write commits when its result does, so a turn that
 *   failed later still changed what it changed; the caller refreshes that.
 */
export const usePortalStream = (
  onDone?: (clearLocalMessages: () => void) => void,
  onTurnEnd?: (turn: PortalStreamTurn) => void
): [PortalStreamState, PortalStreamActions] => {
  const createSSEConnection = sse.create();

  const [localMessages, setLocalMessages] = useState<PortalMessageResponse[]>(
    []
  );
  const [streamingBlocks, setStreamingBlocks] = useState<
    PortalMessageBlock[] | null
  >(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [toolSteps, setToolSteps] = useState<ToolStep[]>([]);

  // Keep a ref to the latest streaming blocks so the done handler can
  // read the current value without stale closure issues.
  const streamingBlocksRef = useRef<PortalMessageBlock[]>([]);
  // #1036: the tools this turn ran, reported once to onTurnEnd. Collected
  // from `tool_call_end`, which the server sends for every tool: `tool_result`
  // only comes for a result with a display shape, so a scalar-result tool
  // (curated_view_attach) never sends one. Found in the #1036 smoke walk.
  const turnToolNamesRef = useRef<Set<string>>(new Set());
  const turnEndedRef = useRef(true);
  const esRef = useRef<EventSource | null>(null);
  const onDoneRef = useRef(onDone);
  const onTurnEndRef = useRef(onTurnEnd);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    onTurnEndRef.current = onTurnEnd;
  }, [onTurnEnd]);

  /** Report the turn once, whichever of done/error/lost/cancel ends it. */
  const endTurn = useCallback(() => {
    if (turnEndedRef.current) return;
    turnEndedRef.current = true;
    onTurnEndRef.current?.({ toolNames: turnToolNamesRef.current });
  }, []);

  const cancel = useCallback(() => {
    endTurn();
    esRef.current?.close();
    esRef.current = null;
    setIsStreaming(false);
    setStreamingBlocks(null);
    streamingBlocksRef.current = [];
    setToolSteps([]);
  }, [endTurn]);

  const addLocalMessage = useCallback((msg: PortalMessageResponse) => {
    setLocalMessages((prev) => [...prev, msg]);
  }, []);

  const removeLocalMessage = useCallback((id: string) => {
    setLocalMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const clearLocalMessages = useCallback(() => {
    setLocalMessages([]);
  }, []);

  const send = useCallback(
    async (portalId: string) => {
      setStreamError(null);

      let es: EventSource;
      try {
        es = await createSSEConnection(
          `/api/sse/portals/${encodeURIComponent(portalId)}/stream`
        );
      } catch {
        return;
      }

      streamingBlocksRef.current = [];
      turnToolNamesRef.current = new Set();
      turnEndedRef.current = false;
      setStreamingBlocks([]);
      setIsStreaming(true);
      setToolSteps([]);
      esRef.current = es;

      es.addEventListener("delta", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as DeltaEvent;
        setStreamingBlocks((prev) => {
          const blocks = prev ?? [];
          const last = blocks[blocks.length - 1];
          let next: PortalMessageBlock[];
          if (last?.type === "text") {
            next = [
              ...blocks.slice(0, -1),
              { type: "text", content: String(last.content) + data.content },
            ];
          } else {
            next = [...blocks, { type: "text", content: data.content }];
          }
          streamingBlocksRef.current = next;
          return next;
        });
      });

      // #279 step lifecycle. Filter-then-append keeps the newest step last and
      // makes a repeated id idempotent rather than stacking duplicates.
      es.addEventListener("tool_call", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as ToolCallEvent;
        setToolSteps((prev) => [
          ...prev.filter((s) => s.toolCallId !== data.toolCallId),
          {
            toolCallId: data.toolCallId,
            toolName: data.toolName,
            startedAt: Date.now(),
          },
        ]);
      });

      es.addEventListener("tool_call_end", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as ToolCallEndEvent;
        turnToolNamesRef.current.add(data.toolName);
        setToolSteps((prev) =>
          prev.filter((s) => s.toolCallId !== data.toolCallId)
        );
      });

      es.addEventListener("tool_result", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as ToolResultEvent;
        const result = data.result as Record<string, unknown> | null;
        // A job's completion result arrives with no tool_call_end, so it
        // counts here too.
        turnToolNamesRef.current.add(data.toolName);

        const block = streamingBlockFor(data.toolName, result);

        if (block) {
          setStreamingBlocks((prev) => {
            const next = [...(prev ?? []), block];
            streamingBlocksRef.current = next;
            return next;
          });
        }
      });

      es.addEventListener("done", (_e: MessageEvent) => {
        const doneData = JSON.parse(_e.data) as DoneEvent;
        es.close();
        esRef.current = null;

        // Finalise assistant message into local state.
        const finalBlocks = streamingBlocksRef.current;
        if (finalBlocks.length > 0) {
          const assistantMsg: PortalMessageResponse = {
            id: doneData.messageId,
            portalId,
            organizationId: "",
            role: "assistant",
            blocks: finalBlocks,
            created: Date.now(),
          };
          setLocalMessages((prev) => [...prev, assistantMsg]);
        }

        streamingBlocksRef.current = [];
        setStreamingBlocks(null);
        setIsStreaming(false);
        setToolSteps([]);

        endTurn();
        onDoneRef.current?.(clearLocalMessages);
      });

      es.addEventListener("stream_error", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as StreamErrorEvent;
        endTurn();
        es.close();
        esRef.current = null;
        setIsStreaming(false);
        setStreamingBlocks(null);
        streamingBlocksRef.current = [];
        setToolSteps([]);
        setStreamError(data.message);
      });

      es.onerror = () => {
        endTurn();
        es.close();
        esRef.current = null;
        setIsStreaming(false);
        setStreamingBlocks(null);
        streamingBlocksRef.current = [];
        setToolSteps([]);
        setStreamError("Connection to the server was lost. Please try again.");
      };
    },
    [createSSEConnection, clearLocalMessages, endTurn]
  );

  // Cleanup EventSource on unmount.
  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  return [
    { streamingBlocks, isStreaming, streamError, localMessages, toolSteps },
    { send, cancel, addLocalMessage, removeLocalMessage, clearLocalMessages },
  ];
};
