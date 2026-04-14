import React, { useEffect, useRef, useMemo, useCallback } from "react";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { Box, Icon, IconName, StatusMessage } from "@portalai/core/ui";
import { ContentBlockRenderer } from "@portalai/core";
import Typography from "@mui/material/Typography";
import MuiLink from "@mui/material/Link";
import type {
  PortalMessageResponse,
  PortalMessageBlock,
} from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { usePortalStream } from "../utils/portal-stream.util";
import { ChatWindowUI, type ChatWindowHandle } from "./ChatWindow.component";
import { PortalMessage } from "./PortalMessage.component";

// ── Message List (memoized to avoid re-renders on input changes) ─────

interface MessageListProps {
  portalId: string;
  messages: PortalMessageResponse[];
  pinnedBlocks: Map<string, string>;
  onPinChange: () => void;
  streamingBlocks: PortalMessageBlock[] | null;
  streamError: string | null;
}

const MessageList = React.memo<MessageListProps>(({
  portalId,
  messages,
  pinnedBlocks,
  onPinChange,
  streamingBlocks,
  streamError,
}) => {
  const hasStreamingContent =
    streamingBlocks !== null && streamingBlocks.length > 0;
  const isEmpty =
    messages.length === 0 && !hasStreamingContent && !streamError;

  if (isEmpty) {
    return <PortalSessionEmptyState />;
  }

  return (
    <>
      {messages.map((msg) => (
        <PortalMessage
          key={msg.id}
          message={msg}
          portalId={portalId}
          pinnedBlocks={pinnedBlocks}
          onPinChange={onPinChange}
        />
      ))}

      {hasStreamingContent && (
        <Box sx={{ mb: 2, minWidth: 0, maxWidth: "100%" }}>
          {streamingBlocks!.map((block, i) => (
            <Box key={i} sx={{ overflow: "auto" }}>
              <ContentBlockRenderer block={block} />
            </Box>
          ))}
        </Box>
      )}

      {streamError && (
        <StatusMessage variant="error" message={streamError} />
      )}
    </>
  );
});

// ── Empty State ──────────────────────────────────────────────────────

const PortalSessionEmptyState: React.FC = () => (
  <Box
    data-testid="portal-session-empty"
    sx={{
      height: "100%",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      px: 3,
      color: "text.secondary",
    }}
  >
    <Icon
      name={IconName.Portal}
      sx={{ fontSize: 64, color: "primary.main", mb: 2 }}
    />
    <Typography variant="h6" sx={{ mb: 1, color: "text.primary" }}>
      Ready when you are
    </Typography>
    <Typography variant="body2" sx={{ maxWidth: 520, mb: 1.5 }}>
      Portal sessions let you explore your data through conversation — ask
      questions, generate charts, and create or modify records, entities,
      and field mappings, all in natural language.
    </Typography>
    <MuiLink
      component={Link}
      to="/help"
      variant="body2"
      data-testid="portal-session-empty-help-link"
    >
      Learn what portal sessions can do →
    </MuiLink>
  </Box>
);

// ── UI ────────────────────────────────────────────────────────────────

export interface PortalSessionUIProps {
  portalId: string;
  messages: PortalMessageResponse[];
  pinnedBlocks: Map<string, string>;
  onPinChange: () => void;
  streamingBlocks: PortalMessageBlock[] | null;
  streamError: string | null;
  chatRef: React.Ref<ChatWindowHandle>;
  onSubmit: (message: string) => void;
  onReset: () => void;
  onCancel: () => void;
  onExit: () => void;
  isStreaming: boolean;
}

export const PortalSessionUI: React.FC<PortalSessionUIProps> = ({
  portalId,
  messages,
  pinnedBlocks,
  onPinChange,
  streamingBlocks,
  streamError,
  chatRef,
  onSubmit,
  onReset,
  onCancel,
  onExit,
  isStreaming,
}) => (
  <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
    <ChatWindowUI
      ref={chatRef}
      onSubmit={onSubmit}
      onReset={onReset}
      onCancel={onCancel}
      onExit={onExit}
      disabled={isStreaming}
    >
      <MessageList
        portalId={portalId}
        messages={messages}
        pinnedBlocks={pinnedBlocks}
        onPinChange={onPinChange}
        streamingBlocks={streamingBlocks}
        streamError={streamError}
      />
    </ChatWindowUI>
  </Box>
);

// ── Container ─────────────────────────────────────────────────────────

interface PortalSessionProps {
  portalId: string;
}

export const PortalSession: React.FC<PortalSessionProps> = ({ portalId }) => {
  const router = useRouter();
  const location = useLocation();
  // The hash in the URL (e.g. "#msg-123") identifies a specific pinned-result
  // message block that the session was opened from. When present, we scroll
  // that block into view instead of scrolling to the bottom of the feed.
  const targetMessageId = useMemo(
    () => location.hash.replace(/^#/, "") || null,
    [location.hash],
  );

  // Server messages come directly from the query (no local copy).
  const portalQuery = sdk.portals.get(portalId, { include: "pinnedResults" });
  const serverMessages = useMemo(
    () => portalQuery.data?.messages ?? [],
    [portalQuery.data?.messages],
  );

  // Build a lookup map from the server-side pinnedBlocks data:
  // "messageId:blockIndex" → portalResultId
  const pinnedBlockEntries = portalQuery.data?.pinnedBlocks;
  const pinnedBlocks = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of pinnedBlockEntries ?? []) {
      map.set(`${entry.messageId}:${entry.blockIndex}`, entry.portalResultId);
    }
    return map;
  }, [pinnedBlockEntries]);

  const handlePinChange = useCallback(() => {
    portalQuery.refetch();
  }, [portalQuery]);

  // Refetch so server-stored blocks (which include tool-call/tool-result
  // metadata) replace the display-only local copies. This ensures pin
  // operations send correct block indices. The hook stores onDone in a ref
  // internally, so this callback can safely close over portalQuery.
  const handleStreamDone = useCallback((clear: () => void) => {
    portalQuery.refetch().then(() => {
      clear();
    });
  }, [portalQuery]);

  const [streamState, streamActions] = usePortalStream(handleStreamDone);

  const chatRef = useRef<ChatWindowHandle>(null);
  const sendMessage = sdk.portals.sendMessage(portalId);
  const resetMessages = sdk.portals.resetMessages(portalId);

  // On session open: scroll to the target message (if opened from a pinned
  // result) or to the bottom of the feed. Runs once per portalId + first
  // non-empty message batch. `didInitialScrollRef` prevents repeats when
  // subsequent refetches change the `messages` array identity.
  const didInitialScrollRef = useRef(false);
  useEffect(() => {
    didInitialScrollRef.current = false;
  }, [portalId]);
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (serverMessages.length === 0) return;
    const chat = chatRef.current;
    if (!chat) return;

    if (targetMessageId) {
      const found = chat.scrollToMessage(targetMessageId);
      if (!found) chat.scrollToBottom();
    } else {
      chat.scrollToBottom();
    }
    didInitialScrollRef.current = true;
  }, [portalId, serverMessages, targetMessageId]);

  // Deduplicate: prefer server messages over local optimistic copies so that
  // block arrays (which include tool-call/tool-result metadata blocks) have
  // correct indices for operations like pinning.
  const allMessages = useMemo(() => {
    const serverIds = new Set(serverMessages.map((m) => m.id));
    return [
      ...serverMessages,
      ...streamState.localMessages.filter((m) => !serverIds.has(m.id)),
    ];
  }, [serverMessages, streamState.localMessages]);

  // Auto-scroll to bottom whenever new content is appended — a new message
  // arrives, or a streaming block lands. Skips the very first observation so
  // it doesn't fight the initial-scroll effect (which may be scrolling to a
  // specific pinned message instead of the bottom). Reset on portal change.
  const messageCount = allMessages.length;
  const streamingBlockCount = streamState.streamingBlocks?.length ?? 0;
  const prevCountsRef = useRef<{ messages: number; blocks: number } | null>(null);
  useEffect(() => {
    prevCountsRef.current = null;
  }, [portalId]);
  useEffect(() => {
    const prev = prevCountsRef.current;
    prevCountsRef.current = { messages: messageCount, blocks: streamingBlockCount };
    if (prev === null) return;
    if (messageCount > prev.messages || streamingBlockCount > prev.blocks) {
      chatRef.current?.scrollToBottom();
    }
  }, [messageCount, streamingBlockCount]);

  const handleCancel = () => {
    streamActions.cancel();
  };

  const handleReset = async () => {
    streamActions.cancel();
    streamActions.clearLocalMessages();
    chatRef.current?.clear();
    try {
      await resetMessages.mutateAsync();
      await portalQuery.refetch();
    } catch {
      // Best-effort — local state is already cleared
    }
  };

  const handleSubmit = async (rawMessage: string) => {
    const message = rawMessage.trim();
    if (!message || streamState.isStreaming) return;

    chatRef.current?.clear();

    // Add optimistic user message to local state.
    const optimisticId = `optimistic-${Date.now()}`;
    streamActions.addLocalMessage({
      id: optimisticId,
      portalId,
      organizationId: "",
      role: "user",
      blocks: [{ type: "text", content: message }],
      created: Date.now(),
    });

    try {
      await sendMessage.mutateAsync({ message });
    } catch {
      // Remove the optimistic message if the send failed.
      streamActions.removeLocalMessage(optimisticId);
      return;
    }

    await streamActions.send(portalId);
  };

  return (
    <PortalSessionUI
      portalId={portalId}
      messages={allMessages}
      pinnedBlocks={pinnedBlocks}
      onPinChange={handlePinChange}
      streamingBlocks={streamState.streamingBlocks}
      streamError={streamState.streamError}
      chatRef={chatRef}
      onSubmit={handleSubmit}
      onReset={handleReset}
      onCancel={handleCancel}
      onExit={() => router.history.back()}
      isStreaming={streamState.isStreaming}
    />
  );
};
