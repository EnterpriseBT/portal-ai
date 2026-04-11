import { useState, useRef, useEffect, useCallback } from "react";

import type {
  PortalMessageResponse,
  PortalMessageBlock,
  DeltaEvent,
  ToolResultEvent,
  DoneEvent,
  StreamErrorEvent,
} from "@portalai/core/contracts";

import { sse } from "../api/sse.api";

// --- Types ---

export interface PortalStreamState {
  streamingBlocks: PortalMessageBlock[] | null;
  isStreaming: boolean;
  streamError: string | null;
  localMessages: PortalMessageResponse[];
}

export interface PortalStreamActions {
  send: (portalId: string) => Promise<void>;
  cancel: () => void;
  addLocalMessage: (msg: PortalMessageResponse) => void;
  removeLocalMessage: (id: string) => void;
  clearLocalMessages: () => void;
}

// --- Hook ---

/**
 * Manages the SSE stream for a portal session.
 *
 * - Opens a stream to receive assistant responses after a message is sent.
 * - Accumulates streaming blocks (text, vega-lite, vega, data-table, mutation-result).
 * - Finalises the assistant message into `localMessages` on `done`.
 * - Handles `stream_error` and connection loss.
 * - Cleans up EventSource on cancel or unmount.
 *
 * @param onDone - Optional callback invoked after a stream completes.
 *   Receives `clearLocalMessages` so the caller can clear optimistic messages
 *   after refetching server data without a circular dependency.
 */
export const usePortalStream = (
  onDone?: (clearLocalMessages: () => void) => void,
): [PortalStreamState, PortalStreamActions] => {
  const createSSEConnection = sse.create();

  const [localMessages, setLocalMessages] = useState<PortalMessageResponse[]>([]);
  const [streamingBlocks, setStreamingBlocks] =
    useState<PortalMessageBlock[] | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Keep a ref to the latest streaming blocks so the done handler can
  // read the current value without stale closure issues.
  const streamingBlocksRef = useRef<PortalMessageBlock[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const cancel = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setIsStreaming(false);
    setStreamingBlocks(null);
    streamingBlocksRef.current = [];
  }, []);

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
      setStreamingBlocks([]);
      setIsStreaming(true);
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

      es.addEventListener("tool_result", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as ToolResultEvent;
        const result = data.result as Record<string, unknown> | null;

        let block: PortalMessageBlock | null = null;

        const isVegaLite =
          result != null &&
          typeof result === "object" &&
          (data.toolName === "visualize" || result["type"] === "vega-lite");

        const isVega =
          result != null &&
          typeof result === "object" &&
          (data.toolName === "visualize_tree" || result["type"] === "vega");

        if (isVegaLite) {
          block = { type: "vega-lite", content: result };
        } else if (isVega) {
          block = { type: "vega", content: result };
        } else if (result && typeof result === "object" && result["type"] === "data-table") {
          block = { type: "data-table", content: result };
        } else if (result && typeof result === "object" && result["type"] === "mutation-result") {
          block = { type: "mutation-result", content: result };
        }

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

        onDoneRef.current?.(clearLocalMessages);
      });

      es.addEventListener("stream_error", (e: MessageEvent) => {
        const data = JSON.parse(e.data) as StreamErrorEvent;
        es.close();
        esRef.current = null;
        setIsStreaming(false);
        setStreamingBlocks(null);
        streamingBlocksRef.current = [];
        setStreamError(data.message);
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setIsStreaming(false);
        setStreamingBlocks(null);
        streamingBlocksRef.current = [];
        setStreamError("Connection to the server was lost. Please try again.");
      };
    },
    [createSSEConnection, clearLocalMessages]
  );

  // Cleanup EventSource on unmount.
  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  return [
    { streamingBlocks, isStreaming, streamError, localMessages },
    { send, cancel, addLocalMessage, removeLocalMessage, clearLocalMessages },
  ];
};
