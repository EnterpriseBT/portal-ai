import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useRouter } from "@tanstack/react-router";
import { Box, Icon, IconName, StatusMessage } from "@portalai/core/ui";
import { ContentBlockRenderer } from "@portalai/core";
import {
  toolPhaseLabel,
  type BuiltinToolpackSlug,
} from "@portalai/core/registries";
import Typography from "@mui/material/Typography";
import MuiLink from "@mui/material/Link";
import type {
  PortalMessageResponse,
  PortalMessageBlock,
} from "@portalai/core/contracts";

import { FAQCategory } from "@portalai/core/content";

import { sdk, queryKeys } from "../api/sdk";
import { HelpTab } from "../utils/routes.util";
import { usePortalStream } from "../utils/portal-stream.util";
import {
  forgetPendingFirstTurn,
  hasPendingFirstTurn,
  readPendingInitialMessage,
  readRefusedInitialMessage,
} from "../utils/portal-initial-message.util";
import type { PortalStreamTurn } from "../utils/portal-stream.util";
import { changedStationAttachments } from "../utils/station-attachment-tools.util";
import { changedTags } from "../utils/tag-tools.util";
import { tagCatalogChangeKeys } from "../utils/tag-invalidation.util";
import { toServerError, type ApiError } from "../utils/api.util";
import { ChatWindowUI, type ChatWindowHandle } from "./ChatWindow.component";
import { usePortalChatLock } from "../utils/portal-chat-lock.util";
import {
  portalReadOnlyLock,
  portalStationLock,
  usePortalStation,
} from "../utils/portal-station.util";
import { serverErrorMessage } from "../utils/permission-denied.util";
import { useToast } from "../utils/toast.context";
import { useElapsed } from "../utils/use-elapsed.util";
import {
  PortalMessage,
  renderWebBlock,
  shouldRenderViaWeb,
} from "./PortalMessage.component";
import { TypingIndicator } from "./TypingIndicator.component";
import { TurnLimitNoticeUI } from "./TurnLimitNotice.component";
import { ToolActivityStrip } from "./ToolActivityStrip.component";
import { MessageTimestamp } from "./MessageTimestamp.component";

// ── Message List (memoized to avoid re-renders on input changes) ─────

/** #1044: typed against the registry, so renaming the pack fails the build
 *  here instead of silently dropping the empty state's Help line. */
const HELP_PACK_SLUG = "help" satisfies BuiltinToolpackSlug;

interface MessageListProps {
  portalId: string;
  messages: PortalMessageResponse[];
  /** #1038: ids of turns still shown from their local copy (see
   *  `PortalMessageUIProps.local`). */
  localMessageIds?: ReadonlySet<string>;
  pinnedBlocks: Map<string, string>;
  onPinChange: () => void;
  streamingBlocks: PortalMessageBlock[] | null;
  streamError: string | null;
  /** #498: an AGENT_TURN_LIMITED send denial to surface inline. */
  turnLimitNotice?: { message: string; showUpgrade: boolean } | null;
  isStreaming: boolean;
  /** Send time of the in-flight turn (epoch ms), or null when idle — stamps
   *  the streaming assistant message (#180). */
  streamStartedAt?: number | null;
  /** Phase of the tool running right now, or null when none is (#279). */
  activeToolLabel?: string | null;
  /** Whole seconds on that tool's step (#279). */
  activeToolElapsedSeconds?: number;
  /** #1044: the station has the Help pack, so the empty state offers it. */
  helpAvailable?: boolean;
}

const MessageList = React.memo<MessageListProps>(
  ({
    portalId,
    messages,
    localMessageIds,
    pinnedBlocks,
    onPinChange,
    streamingBlocks,
    streamError,
    turnLimitNotice = null,
    isStreaming,
    streamStartedAt = null,
    activeToolLabel = null,
    activeToolElapsedSeconds,
    helpAvailable = false,
  }) => {
    const hasStreamingContent =
      streamingBlocks !== null && streamingBlocks.length > 0;
    const isEmpty =
      messages.length === 0 &&
      !hasStreamingContent &&
      !streamError &&
      // #498: a turn-limit denial on the very first send must still surface.
      !turnLimitNotice;
    // Between user-send and the first delta the indicator is the only sign of
    // life. It also stays up for as long as a tool is running (#279): a tool
    // turn's first delta is usually a one-line preamble, after which the feed
    // would otherwise sit frozen until the finished block lands.
    const showTypingIndicator =
      isStreaming && (!hasStreamingContent || activeToolLabel !== null);

    if (isEmpty) {
      return <PortalSessionEmptyState helpAvailable={helpAvailable} />;
    }

    return (
      <>
        {messages.map((msg) => (
          <PortalMessage
            key={msg.id}
            message={msg}
            local={localMessageIds?.has(msg.id) ?? false}
            portalId={portalId}
            pinnedBlocks={pinnedBlocks}
            onPinChange={onPinChange}
          />
        ))}

        {hasStreamingContent && (
          <Box sx={{ mb: 2, minWidth: 0, maxWidth: "100%" }}>
            {streamingBlocks!.map((block, i) => (
              <Box key={i} sx={{ overflow: "auto" }}>
                {/* Route through the same web/core dispatch
                 *  `PortalMessage` uses for persisted blocks — without
                 *  this, a queryHandle-carrying chart block renders
                 *  axes-only during the stream (no QRDB → no snapshot
                 *  fetch) and then renders filled once the message
                 *  persists, briefly showing both (#109). */}
                {shouldRenderViaWeb(block) ? (
                  renderWebBlock(block)
                ) : (
                  <ContentBlockRenderer block={block} />
                )}
              </Box>
            ))}
            {/* In-flight assistant message: a sensible "just now" rather than
             *  a blank until the message persists (#180). */}
            {streamStartedAt !== null && (
              <MessageTimestamp created={streamStartedAt} align="left" />
            )}
          </Box>
        )}

        {showTypingIndicator && (
          <TypingIndicator
            label={activeToolLabel ?? undefined}
            elapsedSeconds={activeToolElapsedSeconds}
          />
        )}

        {streamError && <StatusMessage variant="error" message={streamError} />}
        {turnLimitNotice && (
          <TurnLimitNoticeUI
            message={turnLimitNotice.message}
            showUpgrade={turnLimitNotice.showUpgrade}
          />
        )}
      </>
    );
  }
);

// ── Empty State ──────────────────────────────────────────────────────

const PortalSessionEmptyState: React.FC<{ helpAvailable: boolean }> = ({
  helpAvailable,
}) => (
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
    {/* Styled like a heading, but not one: the portal's h1 is the page's
        (#797 heading order). */}
    <Typography
      variant="h6"
      component="p"
      sx={{ mb: 1, color: "text.primary" }}
    >
      Ready when you are
    </Typography>
    {/* #1044: data first, then questions about the organization, and both
        depend on the station's tool packs (Administrate, for one, has no
        data). */}
    <Typography variant="body2" sx={{ maxWidth: 520, mb: 1.5 }}>
      Ask questions, explore your data, chart it and change it through
      conversation. Depending on this station&apos;s tool packs, the assistant
      can also answer questions about your organization, from its stations and
      views to who has access.
    </Typography>
    {/* #1044: only where the Help pack is attached, since only there can the
        assistant answer how Portals works. The sentence invites asking the
        assistant; the link is for reading instead. */}
    {helpAvailable && (
      <>
        <Typography
          variant="body2"
          sx={{ maxWidth: 520, mb: 1 }}
          data-testid="portal-session-empty-help"
        >
          Not sure where to start? Ask how anything in Portals works.
        </Typography>
        <Link
          to="/help"
          search={{ tab: HelpTab.Faq, category: FAQCategory.GettingStarted }}
          style={{ textDecoration: "none" }}
          data-testid="portal-session-empty-getting-started-link"
        >
          <MuiLink
            component="span"
            variant="body2"
            sx={{ cursor: "pointer", display: "inline-block", mb: 1 }}
          >
            Getting started with Portals →
          </MuiLink>
        </Link>
      </>
    )}
    {/* Deep-linked to the portal FAQ (#365): this link promises portal
        material, so landing on the Getting Started checklist is a dead end.
        The router `Link` is the anchor and `MuiLink component="span"` supplies
        only the styling — `MuiLink component={Link}` erases TanStack's generic
        and collapses `search` to `never`. `to` is the literal "/help", not
        `ApplicationRoute.Help`, for the same reason. Both constraints are
        recorded on `UpgradeLink.component.tsx`. */}
    <Link
      to="/help"
      search={{ tab: HelpTab.Faq, category: FAQCategory.Analytics }}
      style={{ textDecoration: "none" }}
      data-testid="portal-session-empty-help-link"
    >
      <MuiLink component="span" variant="body2" sx={{ cursor: "pointer" }}>
        Learn what portal sessions can do →
      </MuiLink>
    </Link>
  </Box>
);

// ── UI ────────────────────────────────────────────────────────────────

export interface PortalSessionUIProps {
  portalId: string;
  messages: PortalMessageResponse[];
  /** #1038: ids of turns still shown from their local copy. */
  localMessageIds?: ReadonlySet<string>;
  pinnedBlocks: Map<string, string>;
  onPinChange: () => void;
  streamingBlocks: PortalMessageBlock[] | null;
  streamError: string | null;
  /** #498: an AGENT_TURN_LIMITED send denial to surface inline. */
  turnLimitNotice?: { message: string; showUpgrade: boolean } | null;
  chatRef: React.Ref<ChatWindowHandle>;
  onSubmit: (message: string) => void;
  onReset: () => void;
  onCancel: () => void;
  onExit: () => void;
  isStreaming: boolean;
  /** Send time of the in-flight turn (epoch ms), or null when idle (#180). */
  streamStartedAt?: number | null;
  /** Locked when a non-terminal bulk job is bound to this portal (#85). */
  chatLocked?: boolean;
  /** #690: why the chat is locked (the running jobs), shown in the composer. */
  chatLockReason?: string | null;
  /** Phase of the tool running right now, or null when none is (#279). */
  activeToolLabel?: string | null;
  /** Whole seconds on that tool's step (#279). */
  activeToolElapsedSeconds?: number;
  /** #1044: the portal's station has the Help pack attached. */
  helpAvailable?: boolean;
  /** #1127: false for a caller who may read this portal but not write it;
   *  hides Reset (the composer's lock carries the reason). */
  canWrite?: boolean;
}

export const PortalSessionUI: React.FC<PortalSessionUIProps> = ({
  portalId,
  messages,
  localMessageIds,
  pinnedBlocks,
  onPinChange,
  streamingBlocks,
  streamError,
  turnLimitNotice = null,
  chatRef,
  onSubmit,
  onReset,
  onCancel,
  onExit,
  isStreaming,
  streamStartedAt,
  chatLocked,
  chatLockReason = null,
  activeToolLabel = null,
  activeToolElapsedSeconds,
  helpAvailable = false,
  canWrite = true,
}) => (
  <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
    <ChatWindowUI
      ref={chatRef}
      onSubmit={onSubmit}
      onReset={onReset}
      onCancel={onCancel}
      onExit={onExit}
      disabled={isStreaming || chatLocked}
      isStreaming={isStreaming}
      lockedReason={chatLocked ? chatLockReason : null}
      canReset={canWrite}
      statusStrip={
        activeToolLabel ? (
          <ToolActivityStrip
            label={activeToolLabel}
            elapsedSeconds={activeToolElapsedSeconds ?? 0}
          />
        ) : undefined
      }
    >
      <MessageList
        portalId={portalId}
        messages={messages}
        localMessageIds={localMessageIds}
        pinnedBlocks={pinnedBlocks}
        onPinChange={onPinChange}
        streamingBlocks={streamingBlocks}
        streamError={streamError}
        turnLimitNotice={turnLimitNotice}
        isStreaming={isStreaming}
        streamStartedAt={streamStartedAt}
        activeToolLabel={activeToolLabel}
        activeToolElapsedSeconds={activeToolElapsedSeconds}
        helpAvailable={helpAvailable}
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
    [location.hash]
  );

  // Server messages come directly from the query (no local copy).
  const portalQuery = sdk.portals.get(portalId, { include: "pinnedResults" });
  const serverMessages = useMemo(
    () => portalQuery.data?.messages ?? [],
    [portalQuery.data?.messages]
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

  const queryClient = useQueryClient();

  // #180: send time of the in-flight turn, captured in the submit event
  // handler (rule-safe: Date.now() outside render) and cleared when the stream
  // completes — stamps the streaming assistant message.
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);

  // Refetch so server-stored blocks (which include tool-call/tool-result
  // metadata) replace the display-only local copies. This ensures pin
  // operations send correct block indices. The hook stores onDone in a ref
  // internally, so this callback can safely close over portalQuery.
  //
  // A turn may have made billable tool calls (the #169 cost gate charges the
  // org's usage mid-stream), so invalidate the usage balance too — that keeps
  // the always-visible usage strip in the session header live without polling.
  const handleStreamDone = useCallback(
    (clear: () => void) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.usage(),
      });
      setStreamStartedAt(null);
      portalQuery.refetch().then(() => {
        clear();
      });
    },
    [portalQuery, queryClient]
  );

  // #1036: a turn that attached or detached a view changed a station, so the
  // header's view list (and any station page) refreshes — however the turn
  // ended, since the attach committed when its result arrived.
  const handleTurnEnd = useCallback(
    (turn: PortalStreamTurn) => {
      if (changedStationAttachments(turn.toolNames)) {
        queryClient.invalidateQueries({ queryKey: queryKeys.stations.root });
      }
      // #1071: a turn that changed tags refreshes the Tags page, every
      // object's tags and every taggable list, as a rename in the UI does.
      if (changedTags(turn.toolNames)) {
        for (const queryKey of tagCatalogChangeKeys()) {
          queryClient.invalidateQueries({ queryKey });
        }
      }
    },
    [queryClient]
  );

  const [streamState, streamActions] = usePortalStream(
    handleStreamDone,
    handleTurnEnd
  );

  const chatRef = useRef<ChatWindowHandle>(null);
  const sendMessage = sdk.portals.sendMessage(portalId);

  // #1079: a portal the start box created arrives with its first question's
  // outcome in history state (admitted, or refused by the turn ceiling). Read
  // once, at mount: the effect below clears it. An admitted question whose
  // portal never opened (Back pressed mid-start) is found by its session
  // mark instead, on the next visit (#1137 adversarial walk).
  const [refusedDraft] = useState(() =>
    readRefusedInitialMessage(location.state)
  );
  const [pendingFirstTurn] = useState(
    () =>
      readPendingInitialMessage(location.state) || hasPendingFirstTurn(portalId)
  );

  // #498: an AGENT_TURN_LIMITED send denial surfaces inline (never the
  // generic error banner); cleared by the next successful send. The usage
  // query is deduped with Portal.view's identical one — no extra fetch. The
  // upgrade CTA is read at render, so a notice raised before usage loaded
  // (#1079's refused draft, at mount) still settles on the right answer.
  const [turnLimitMessage, setTurnLimitMessage] = useState<string | null>(
    () => refusedDraft?.message ?? null
  );
  const { data: usageData } = sdk.organizations.usage();
  const tierSlug = usageData?.tier.tier;
  const showUpgrade = tierSlug !== "pro" && tierSlug !== "enterprise";
  const turnLimitNotice =
    turnLimitMessage === null
      ? null
      : { message: turnLimitMessage, showUpgrade };
  const resetMessages = sdk.portals.resetMessages(portalId);
  const toast = useToast();

  // #1079: put a refused question back in the composer (the notice was
  // seeded above), then replace the history entry without either outcome, so
  // Back and Forward don't act on it again.
  useEffect(() => {
    if (!refusedDraft && !pendingFirstTurn) return;
    if (refusedDraft) chatRef.current?.setDraft(refusedDraft.prompt);
    // Read once: a later visit never resumes it again.
    forgetPendingFirstTurn(portalId);
    const {
      refusedInitialMessage: _refused,
      pendingInitialMessage: _pending,
      ...state
    } = router.history.location.state;
    router.history.replace(router.history.location.href, state);
  }, [refusedDraft, pendingFirstTurn, router, portalId]);

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
  const { allMessages, localMessageIds } = useMemo(() => {
    const serverIds = new Set(serverMessages.map((m) => m.id));
    const local = streamState.localMessages.filter((m) => !serverIds.has(m.id));
    return {
      allMessages: [...serverMessages, ...local],
      // #1038: still shown from the local copy, whose block indexes aren't
      // the stored message's (see PortalMessageUIProps.local).
      localMessageIds: new Set(local.map((m) => m.id)) as ReadonlySet<string>,
    };
  }, [serverMessages, streamState.localMessages]);

  // Auto-scroll to bottom whenever new content is appended — a new message
  // arrives, or a streaming block lands. Skips the very first observation so
  // it doesn't fight the initial-scroll effect (which may be scrolling to a
  // specific pinned message instead of the bottom). Reset on portal change.
  const messageCount = allMessages.length;
  const streamingBlockCount = streamState.streamingBlocks?.length ?? 0;
  const prevCountsRef = useRef<{ messages: number; blocks: number } | null>(
    null
  );
  useEffect(() => {
    prevCountsRef.current = null;
  }, [portalId]);
  useEffect(() => {
    const prev = prevCountsRef.current;
    prevCountsRef.current = {
      messages: messageCount,
      blocks: streamingBlockCount,
    };
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
    setStreamStartedAt(Date.now());

    try {
      await sendMessage.mutateAsync({ message });
      setTurnLimitMessage(null);
    } catch (err) {
      // Remove the optimistic message if the send failed, and put its text
      // back (#1137 code review): the composer was cleared on submit, so a
      // refusal (the turn limit, a message over the limit) would lose it.
      streamActions.removeLocalMessage(optimisticId);
      chatRef.current?.setDraft(message);
      // #498: the turn-ceiling denial gets its own friendly surface.
      const serverError = toServerError(err as ApiError);
      if (serverError?.code === "AGENT_TURN_LIMITED") {
        setTurnLimitMessage(serverError.message);
      } else {
        // #1127: any other refusal says so; the typed message was cleared,
        // so a silent rollback lost it with no explanation.
        toast.error(serverErrorMessage(err, "Couldn't send your message."));
      }
      return;
    }

    await streamActions.send(portalId);
  };

  // A running import job locks the composer (#85); so does a station the
  // caller can no longer read (#699), since the server would refuse the send.
  // The job lock wins when both apply: it's the more transient state.
  const jobLock = usePortalChatLock(portalId);
  // One read of the portal's station (the same query key as the header) feeds
  // both the composer lock (#699) and the empty state's Help line (#1044).
  // Loading, unreadable or failed reads as no Help pack.
  const portalStation = usePortalStation(portalQuery.data?.portal.stationId);
  const stationLock = portalStationLock(portalStation.unavailable);
  const helpAvailable =
    portalStation.station?.enabledToolpacks?.includes(HELP_PACK_SLUG) ?? false;
  // #1127: a caller granted read, not write, on someone else's portal can't
  // send at all. It's the most durable reason, so it wins over both.
  const canWrite = portalQuery.data?.portal.capabilities.write ?? true;
  const readOnlyLock = portalReadOnlyLock(canWrite);

  // #1079: a portal the start box just created with an admitted first
  // question opens the stream that answers it. Only that turn: a portal
  // whose newest user row is an older turn that failed (no reply stored)
  // isn't re-run on every visit, since the stream route doesn't re-admit a
  // turn against the ceiling (#1137 code review). On the first load, the
  // newest row must still be the caller's question and they must be able to
  // write. Checked once per portal, so a refetch never opens another; the
  // server replays a turn that's already answered (#504).
  const portalLoaded = portalQuery.data !== undefined;
  const newestRole = serverMessages[serverMessages.length - 1]?.role;
  const resumeCheckedRef = useRef<string | null>(null);
  const { isStreaming } = streamState;
  const { send: sendStream } = streamActions;
  useEffect(() => {
    if (!portalLoaded || resumeCheckedRef.current === portalId) return;
    resumeCheckedRef.current = portalId;
    if (!pendingFirstTurn || newestRole !== "user" || !canWrite || isStreaming)
      return;
    // Stamped from the send's promise, not the effect body: `send` resolves
    // once the stream is open, before any of its events.
    const startedAt = Date.now();
    void sendStream(portalId).then(() => setStreamStartedAt(startedAt));
  }, [
    portalLoaded,
    portalId,
    pendingFirstTurn,
    newestRole,
    canWrite,
    isStreaming,
    sendStream,
  ]);
  const chatLock = readOnlyLock.locked
    ? readOnlyLock
    : jobLock.locked
      ? jobLock
      : stationLock;

  // #279 — the newest open tool step is the one the user is shown; when it
  // closes, the one before it becomes current again. Indexed rather than
  // `.at(-1)`: apps/web targets ES2020, where Array.prototype.at is not in lib.
  const { toolSteps } = streamState;
  const activeStep = toolSteps[toolSteps.length - 1] ?? null;
  // One interval for the whole turn, owned here — both surfaces receive a
  // plain number and stay pure.
  const activeToolElapsedSeconds = useElapsed(activeStep?.startedAt ?? null);

  return (
    <PortalSessionUI
      portalId={portalId}
      messages={allMessages}
      localMessageIds={localMessageIds}
      pinnedBlocks={pinnedBlocks}
      onPinChange={handlePinChange}
      streamingBlocks={streamState.streamingBlocks}
      streamError={streamState.streamError}
      turnLimitNotice={turnLimitNotice}
      chatRef={chatRef}
      onSubmit={handleSubmit}
      onReset={handleReset}
      onCancel={handleCancel}
      onExit={() => router.history.back()}
      isStreaming={streamState.isStreaming}
      streamStartedAt={streamStartedAt}
      chatLocked={chatLock.locked}
      chatLockReason={chatLock.reason}
      activeToolLabel={activeStep ? toolPhaseLabel(activeStep.toolName) : null}
      activeToolElapsedSeconds={activeToolElapsedSeconds}
      helpAvailable={helpAvailable}
      canWrite={canWrite}
    />
  );
};
