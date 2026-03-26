import React, { useState } from "react";
import { Box, Paper } from "@portalai/core/ui";
import { Typography, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from "@mui/material";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import { ContentBlockRenderer } from "@portalai/core";
import type { PortalMessageResponse, PortalMessageBlock } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";

// ── UI ────────────────────────────────────────────────────────────────

export interface PortalMessageUIProps {
  message: PortalMessageResponse;
  onPin: (blockIndex: number, name: string) => void;
  isPinPending?: boolean;
}

export const PortalMessageUI: React.FC<PortalMessageUIProps> = ({
  message,
  onPin,
  isPinPending,
}) => {
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinBlockIndex, setPinBlockIndex] = useState<number | null>(null);
  const [pinName, setPinName] = useState("");

  const handlePinClick = (blockIndex: number) => {
    setPinBlockIndex(blockIndex);
    setPinName("");
    setPinDialogOpen(true);
  };

  const handleConfirm = () => {
    if (pinBlockIndex !== null && pinName.trim()) {
      onPin(pinBlockIndex, pinName.trim());
      setPinDialogOpen(false);
    }
  };

  if (message.role === "user") {
    return (
      <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
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
    <Box sx={{ mb: 2 }}>
      {message.blocks.map((block: PortalMessageBlock, i: number) => (
        <Box key={i} sx={{ position: "relative", mb: 1 }}>
          <ContentBlockRenderer block={block} />
          <IconButton
            size="small"
            aria-label="Pin result"
            onClick={() => handlePinClick(i)}
            sx={{ position: "absolute", top: 0, right: 0 }}
          >
            <PushPinOutlinedIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}

      <Dialog open={pinDialogOpen} onClose={() => setPinDialogOpen(false)}>
        <DialogTitle>Name this result</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={pinName}
            onChange={(e) => setPinName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
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
}

export const PortalMessage: React.FC<PortalMessageProps> = ({
  message,
  portalId,
}) => {
  const pin = sdk.portalResults.pin();

  const handlePin = (blockIndex: number, name: string) => {
    pin.mutate({ portalId, blockIndex, name });
  };

  return (
    <PortalMessageUI
      message={message}
      onPin={handlePin}
      isPinPending={pin.isPending}
    />
  );
};
