import React, { useRef, useState } from "react";
import { Box, Paper } from "@portalai/core/ui";
import { Typography, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from "@mui/material";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import { ContentBlockRenderer } from "@portalai/core";
import type { PortalMessageResponse, PortalMessageBlock } from "@portalai/core/contracts";
import { PINNABLE_BLOCK_TYPES } from "@portalai/core/contracts";
import type { PortalResultType } from "@portalai/core/models";

import { useQueryClient } from "@tanstack/react-query";

import { sdk, queryKeys } from "../api/sdk";
import { useAuthFetch } from "../utils/api.util";

function hasPinnableContent(block: PortalMessageBlock): boolean {
  if (!PINNABLE_BLOCK_TYPES.has(block.type as PortalResultType)) return false;
  if (block.content == null) return false;
  if (typeof block.content === "string") return block.content.trim().length > 0;
  if (typeof block.content === "object") return Object.keys(block.content as object).length > 0;
  return false;
}

// ── UI ────────────────────────────────────────────────────────────────

export interface PortalMessageUIProps {
  message: PortalMessageResponse;
  pinnedBlocks: Map<string, string>;
  onPin: (messageId: string, blockIndex: number, name: string) => void;
  onUnpin: (portalResultId: string) => void;
  isPinPending?: boolean;
}

export const PortalMessageUI: React.FC<PortalMessageUIProps> = ({
  message,
  pinnedBlocks,
  onPin,
  onUnpin,
  isPinPending,
}) => {
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinBlockIndex, setPinBlockIndex] = useState<number | null>(null);
  const [pinName, setPinName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handlePinClick = (blockIndex: number) => {
    setPinBlockIndex(blockIndex);
    setPinName("");
    setPinDialogOpen(true);
  };

  const handleConfirm = () => {
    if (pinBlockIndex !== null && pinName.trim()) {
      onPin(message.id, pinBlockIndex, pinName.trim());
      setPinDialogOpen(false);
    }
  };

  if (message.role === "user") {
    return (
      <Box
        data-message-id={message.id}
        sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}
      >
        <Paper
          elevation={1}
          sx={{ p: 1.5, maxWidth: "80%", bgcolor: "primary.main", color: "primary.contrastText" }}
        >
          {message.blocks.map((block: PortalMessageBlock, i: number) => (
            <Typography key={i} variant="body2">
              {String(block.content ?? "")}
            </Typography>
          ))}
        </Paper>
      </Box>
    );
  }

  return (
    <Box data-message-id={message.id} sx={{ mb: 2, minWidth: 0, maxWidth: "100%" }}>
      {message.blocks.map((block: PortalMessageBlock, i: number) => {
        const pinnable = hasPinnableContent(block);
        if (!pinnable) return null;
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
              <ContentBlockRenderer block={block} />
            </Box>
            {isPinned ? (
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
                  sx={{ flexShrink: 0, ml: 1, opacity: 0, transition: "opacity 0.15s" }}
                >
                  <PushPinOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        );
      })}

      <Dialog
        open={pinDialogOpen}
        onClose={() => setPinDialogOpen(false)}
        TransitionProps={{
          onEntered: () => inputRef.current?.focus(),
        }}
      >
        <DialogTitle>Name this result</DialogTitle>
        <DialogContent>
          <TextField
            inputRef={inputRef}
            fullWidth
            label="Name"
            value={pinName}
            onChange={(e) => setPinName(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPinDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleConfirm}
            disabled={!pinName.trim() || isPinPending}
          >
            Pin
          </Button>
        </DialogActions>
      </Dialog>
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
  const { fetchWithAuth } = useAuthFetch();

  const handlePin = (messageId: string, blockIndex: number, name: string) => {
    pin.mutate(
      { portalId, messageId, blockIndex, name },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
          onPinChange();
        },
      },
    );
  };

  const handleUnpin = async (portalResultId: string) => {
    await fetchWithAuth(
      `/api/portal-results/${encodeURIComponent(portalResultId)}`,
      { method: "DELETE" },
    );
    queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root });
    onPinChange();
  };

  return (
    <PortalMessageUI
      message={message}
      pinnedBlocks={pinnedBlocks}
      onPin={handlePin}
      onUnpin={handleUnpin}
      isPinPending={pin.isPending}
    />
  );
};
