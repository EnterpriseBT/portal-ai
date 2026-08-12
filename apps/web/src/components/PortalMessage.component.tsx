import React, { useState } from "react";
import { Box, Paper } from "@portalai/core/ui";
import { Typography, IconButton, Tooltip } from "@mui/material";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import { ContentBlockRenderer, hasBlockRenderer } from "@portalai/core";

import {
  BulkJobProgressBlock,
  type BulkJobProgressContent,
} from "./BulkJobProgressBlock.component";
import {
  BulkFailuresTableBlock,
  type BulkFailuresTableBlockContent,
} from "./BulkFailuresTableBlock.component";
import { MessageTimestamp } from "./MessageTimestamp.component";
import { PinResultDialog } from "./PinResultDialog.component";

/**
 * Render override for block types that the core ContentBlockRenderer
 * doesn't know about. Returns null when the block isn't one of the
 * web-specific types; the caller falls through to the core renderer.
 *
 * Exported so the streaming-blocks path in `PortalSession` can route
 * through the same logic — otherwise a queryHandle-carrying block
 * renders empty during the stream (no QRDB → no snapshot fetch) and
 * the persisted version renders filled, briefly showing both (#109).
 */
export function renderWebBlock(
  block: PortalMessageBlock
): React.ReactNode | null {
  if (block.type === "bulk-job-progress") {
    return (
      <BulkJobProgressBlock content={block.content as BulkJobProgressContent} />
    );
  }
  if (block.type === "bulk-failures-table") {
    return (
      <BulkFailuresTableBlock
        content={block.content as BulkFailuresTableBlockContent}
      />
    );
  }
  return null;
}
import type {
  PortalMessageResponse,
  PortalMessageBlock,
} from "@portalai/core/contracts";
import { PINNABLE_BLOCK_TYPES } from "@portalai/core/contracts";
import type { PortalResultType } from "@portalai/core/models";

import { useQueryClient } from "@tanstack/react-query";

import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { useToast } from "../utils/toast.context";
import type { ServerError } from "../utils/api.util";

function hasRenderableContent(block: PortalMessageBlock): boolean {
  if (block.content == null) return false;
  if (typeof block.content === "string") return block.content.trim().length > 0;
  if (typeof block.content === "object")
    return Object.keys(block.content as object).length > 0;
  return false;
}

function hasPinnableContent(block: PortalMessageBlock): boolean {
  if (!PINNABLE_BLOCK_TYPES.has(block.type as PortalResultType)) return false;
  return hasRenderableContent(block);
}

/**
 * Display and pinnability are separate properties (#268): a block shows
 * when a renderer is registered for its type and it has content —
 * `d3` widgets and mutation results display but never pin; `tool-call` /
 * `tool-result` have no renderer and stay hidden. Pinnability only
 * controls the pin affordance.
 */
function isDisplayableBlock(block: PortalMessageBlock): boolean {
  return hasBlockRenderer(block.type) && hasRenderableContent(block);
}

/** Block types that the web layer renders directly (bypass pin path). */
const WEB_BLOCK_TYPES = new Set<string>([
  "bulk-job-progress",
  "bulk-failures-table",
]);

/**
 * True when a block needs the web layer rather than the core
 * ContentBlockRenderer. Type alone decides it now: #349 removed the
 * queryHandle-carrying data-table branch, which diverted handle-backed tables
 * into `renderWebBlock` — a path that passed no render `ctx`, so a table never
 * saw its own `BlockRef` and could never refresh. Tables go through the
 * registry (TableWidget) like every other visualization.
 */
export function shouldRenderViaWeb(block: PortalMessageBlock): boolean {
  return WEB_BLOCK_TYPES.has(block.type as string);
}

// ── UI ────────────────────────────────────────────────────────────────

export interface PortalMessageUIProps {
  message: PortalMessageResponse;
  pinnedBlocks: Map<string, string>;
  /**
   * Resolves when the pin is saved and rejects when it fails (#285). The
   * outcome drives the dialog: it closes only on resolve, so a failure keeps
   * it open with the typed name and `pinServerError` on screen.
   */
  onPin: (messageId: string, blockIndex: number, name: string) => Promise<void>;
  onUnpin: (portalResultId: string) => void;
  isPinPending?: boolean;
  /** The last pin failure, rendered inside the dialog (#285). */
  pinServerError?: ServerError | null;
}

export const PortalMessageUI: React.FC<PortalMessageUIProps> = ({
  message,
  pinnedBlocks,
  onPin,
  onUnpin,
  isPinPending,
  pinServerError = null,
}) => {
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinBlockIndex, setPinBlockIndex] = useState<number | null>(null);

  const handlePinClick = (blockIndex: number) => {
    setPinBlockIndex(blockIndex);
    setPinDialogOpen(true);
  };

  /**
   * Hand the validated name up and leave the dialog open (#285): the
   * container closes it from the mutation's `onSuccess`, so a failure keeps
   * the dialog — and the typed name — in place with the error visible.
   */
  const handleConfirm = (name: string) => {
    if (pinBlockIndex === null) return;
    // Close only on success. The rejection is already surfaced through
    // `pinServerError`, so it is swallowed here rather than left unhandled.
    void onPin(message.id, pinBlockIndex, name).then(
      () => setPinDialogOpen(false),
      () => undefined
    );
  };

  if (message.role === "user") {
    return (
      <Box
        data-message-id={message.id}
        sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}
      >
        <Box sx={{ maxWidth: "80%" }}>
          <Paper
            elevation={1}
            sx={{
              p: 1.5,
              bgcolor: "primary.main",
              color: "primary.contrastText",
            }}
          >
            {message.blocks.map((block: PortalMessageBlock, i: number) => (
              <Typography key={i} variant="body2">
                {String(block.content ?? "")}
              </Typography>
            ))}
          </Paper>
          <MessageTimestamp created={message.created} align="right" />
        </Box>
      </Box>
    );
  }

  return (
    <Box
      data-message-id={message.id}
      sx={{ mb: 2, minWidth: 0, maxWidth: "100%" }}
    >
      {message.blocks.map((block: PortalMessageBlock, i: number) => {
        // #312: the render path no longer decides pinnability — web-layer
        // blocks (handle-backed tables) get the same pin affordance as core
        // blocks when their type is pinnable. Transient kinds
        // (bulk-job-progress, bulk-failures-table) stay unpinnable (#92).
        const viaWeb = shouldRenderViaWeb(block);
        if (!viaWeb && !isDisplayableBlock(block)) return null;
        const pinnable = hasPinnableContent(block);
        const pinKey = `${message.id}:${i}`;
        const portalResultId = pinnedBlocks.get(pinKey);
        const isPinned = portalResultId != null;
        return (
          <Box
            key={i}
            sx={{
              p: 1,
              display: "flex",
              alignItems: "flex-start",
              mb: 1,
              borderRadius: 1,
              transition: "background-color 0.15s",
              "&:hover": {
                bgcolor: "action.hover",
              },
              ...(!isPinned && {
                "&:hover .pin-button": {
                  opacity: 1,
                },
              }),
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
              {viaWeb ? (
                renderWebBlock(block)
              ) : (
                <ContentBlockRenderer
                  block={block}
                  blockRef={{
                    kind: "message",
                    messageId: message.id,
                    blockIndex: i,
                  }}
                  dataUpdatedAt={message.created}
                />
              )}
            </Box>
            {!pinnable ? null : isPinned ? (
              <Tooltip title="Unpin result">
                <IconButton
                  size="small"
                  aria-label="Unpin result"
                  onClick={() => onUnpin(portalResultId)}
                  sx={{ flexShrink: 0, ml: 1 }}
                >
                  <PushPinIcon fontSize="small" color="primary" />
                </IconButton>
              </Tooltip>
            ) : (
              <Tooltip title="Pin result">
                <IconButton
                  size="small"
                  className="pin-button"
                  aria-label="Pin result"
                  onClick={() => handlePinClick(i)}
                  sx={{
                    flexShrink: 0,
                    ml: 1,
                    opacity: 0,
                    transition: "opacity 0.15s",
                  }}
                >
                  <PushPinOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        );
      })}

      <MessageTimestamp created={message.created} align="left" />

      <PinResultDialog
        open={pinDialogOpen}
        onClose={() => setPinDialogOpen(false)}
        onSubmit={handleConfirm}
        isPending={!!isPinPending}
        serverError={pinServerError}
      />
    </Box>
  );
};

// ── Container ─────────────────────────────────────────────────────────

interface PortalMessageProps {
  message: PortalMessageResponse;
  portalId: string;
  pinnedBlocks: Map<string, string>;
  onPinChange: () => void;
}

export const PortalMessage: React.FC<PortalMessageProps> = ({
  message,
  portalId,
  pinnedBlocks,
  onPinChange,
}) => {
  const queryClient = useQueryClient();
  const pin = sdk.portalResults.pin();
  const unpin = sdk.portalResults.remove();
  const toast = useToast();

  /**
   * `mutateAsync` rather than `mutate` (#285): the dialog closes on the
   * resolved promise and stays open on rejection, so a failed pin surfaces
   * instead of closing as though it had worked. The rejection is re-thrown
   * for the dialog to see; `pin.error` renders it as the in-dialog alert.
   */
  const handlePin = async (
    messageId: string,
    blockIndex: number,
    name: string
  ): Promise<void> => {
    await pin.mutateAsync({ portalId, messageId, blockIndex, name });
    queryClient.invalidateQueries({
      queryKey: queryKeys.portalResults.root,
    });
    onPinChange();
  };

  const handleUnpin = async (portalResultId: string) => {
    try {
      await unpin.mutateAsync({ id: portalResultId });
      queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
      onPinChange();
    } catch {
      // No dialog to attach a FormAlert to, so the failure raises a toast
      // (CLAUDE.md → Toast Pattern). Error toasts persist until dismissed,
      // so an unpin that silently failed can no longer scroll past unseen.
      toast.error("Could not unpin this result. Please try again.", {
        action: {
          label: "Retry",
          onClick: () => void handleUnpin(portalResultId),
        },
      });
    }
  };

  return (
    <PortalMessageUI
      message={message}
      pinnedBlocks={pinnedBlocks}
      onPin={handlePin}
      onUnpin={handleUnpin}
      isPinPending={pin.isPending}
      pinServerError={toServerError(pin.error)}
    />
  );
};
