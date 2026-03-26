import React, { useState, useRef, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useRouter } from "@tanstack/react-router";
import { Box } from "@portalai/core/ui";
import { ContentBlockRenderer } from "@portalai/core";
import type {
  PortalMessageResponse,
  PortalMessageBlock,
  DeltaEvent,
  ToolResultEvent,
  DoneEvent,
} from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { ChatWindowUI } from "./ChatWindow.component";
import { PortalMessage } from "./PortalMessage.component";

// ── UI ────────────────────────────────────────────────────────────────

export interface PortalSessionUIProps {
  portalId: string;
  messages: PortalMessageResponse[];
  streamingBlocks: PortalMessageBlock[] | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  onCancel: () => void;
  onExit: () => void;
  isStreaming: boolean;
}

export const PortalSessionUI: React.FC<PortalSessionUIProps> = ({
  portalId,
  messages,
  streamingBlocks,
  inputValue,
  onInputChange,
  onSubmit,
  onReset,
  onCancel,
  onExit,
  isStreaming,
}) => (
  <ChatWindowUI
    value={inputValue}
    onChange={onInputChange}
    onSubmit={onSubmit}
    onReset={onReset}
    onCancel={onCancel}
    onExit={onExit}
    disabled={isStreaming}
  >
    {messages.map((msg) => (
      <PortalMessage key={msg.id} message={msg} portalId={portalId} />
    ))}

    {streamingBlocks !== null && streamingBlocks.length > 0 && (
      <Box sx={{ mb: 2 }}>
        {streamingBlocks.map((block, i) => (
          <ContentBlockRenderer key={i} block={block} />
        ))}
      </Box>
    )}
  </ChatWindowUI>
);

// ── Container ─────────────────────────────────────────────────────────

interface PortalSessionProps {
  portalId: string;
}

export const PortalSession: React.FC<PortalSessionProps> = ({ portalId }) => {
  const { getAccessTokenSilently } = useAuth0();
  const router = useRouter();

  // Server messages come directly from the query (no local copy).
  const portalQuery = sdk.portals.get(portalId);
  const serverMessages = portalQuery.data?.messages ?? [];

  // Local messages: optimistic user messages + finalized assistant messages
  // added during this session. Combined with serverMessages for display.
  const [localMessages, setLocalMessages] = useState<PortalMessageResponse[]>([]);
  const [streamingBlocks, setStreamingBlocks] =
    useState<PortalMessageBlock[] | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);

  // Keep a ref to the latest streaming blocks so the done handler can
  // read the current value without stale closure issues.
  const streamingBlocksRef = useRef<PortalMessageBlock[]>([]);

  const esRef = useRef<EventSource | null>(null);
  const sendMessage = sdk.portals.sendMessage(portalId);

  const allMessages = [...serverMessages, ...localMessages];

  const handleCancel = () => {
    esRef.current?.close();
    esRef.current = null;
    setIsStreaming(false);
    setStreamingBlocks(null);
    streamingBlocksRef.current = [];
  };

  const handleReset = () => {
    handleCancel();
    setLocalMessages([]);
    setInputValue("");
  };

  const handleSubmit = async () => {
    const message = inputValue.trim();
    if (!message || isStreaming) return;

    setInputValue("");

    // Add optimistic user message to local state (called from event handler, not effect).
    const optimisticUserMsg: PortalMessageResponse = {
      id: `optimistic-${Date.now()}`,
      portalId,
      organizationId: "",
      role: "user",
      blocks: [{ type: "text", content: message }],
      created: Date.now(),
    };
    setLocalMessages((prev) => [...prev, optimisticUserMsg]);

    try {
      await sendMessage.mutateAsync({ message });
    } catch {
      // Remove the optimistic message if the send failed.
      setLocalMessages((prev) =>
        prev.filter((m) => m.id !== optimisticUserMsg.id)
      );
      return;
    }

    let token: string;
    try {
      token = await getAccessTokenSilently({
        authorizationParams: {
          audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        },
      });
    } catch {
      return;
    }

    streamingBlocksRef.current = [];
    setStreamingBlocks([]);
    setIsStreaming(true);

    const url = `/api/sse/portals/${encodeURIComponent(portalId)}/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
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
      if (result && typeof result === "object" && result["type"] === "vega-lite") {
        const block: PortalMessageBlock = {
          type: "vega-lite",
          content: result["spec"],
        };
        setStreamingBlocks((prev) => {
          const next = [...(prev ?? []), block];
          streamingBlocksRef.current = next;
          return next;
        });
      }
    });

    es.addEventListener("done", (_e: MessageEvent) => {
      JSON.parse(_e.data) as DoneEvent;
      es.close();
      esRef.current = null;

      // Finalise assistant message into local state from event listener (not effect).
      const finalBlocks = streamingBlocksRef.current;
      if (finalBlocks.length > 0) {
        const assistantMsg: PortalMessageResponse = {
          id: `local-assistant-${Date.now()}`,
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
    });

    es.onerror = () => {
      es.close();
      esRef.current = null;
      setIsStreaming(false);
      setStreamingBlocks(null);
      streamingBlocksRef.current = [];
    };
  };

  // Cleanup EventSource on unmount.
  useEffect(() => {
    return () => {
      esRef.current?.close();
    };
  }, []);

  return (
    <PortalSessionUI
      portalId={portalId}
      messages={allMessages}
      streamingBlocks={streamingBlocks}
      inputValue={inputValue}
      onInputChange={setInputValue}
      onSubmit={handleSubmit}
      onReset={handleReset}
      onCancel={handleCancel}
      onExit={() => router.history.back()}
      isStreaming={isStreaming}
    />
  );
};
