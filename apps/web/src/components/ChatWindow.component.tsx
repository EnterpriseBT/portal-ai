import React from "react";
import {
  Box,
  Stack,
  Button,
  IconButton,
  IconName,
  Icon,
} from "@portalai/core/ui";
import { TextField, Tooltip } from "@mui/material";
import { useLayout } from "../utils/layout.util";

export interface ChatWindowUIProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onReset: () => void;
  onCancel: () => void;
  onExit: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}

export const ChatWindowUI: React.FC<ChatWindowUIProps> = ({
  value,
  onChange,
  onSubmit,
  onReset,
  onCancel,
  onExit,
  disabled,
  children,
}) => {
  const { isMobile } = useLayout();

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Box sx={{ flex: 1, overflow: "auto", minHeight: 0, minWidth: 0, p: 4 }}>{children}</Box>
      <Box sx={{ flexShrink: 0, p: 2, borderTop: 1, borderColor: "divider" }}>
        <TextField
          autoFocus
          multiline
          minRows={2}
          maxRows={6}
          fullWidth
          placeholder="Type a message..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          sx={{ mb: 1 }}
        />
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          {isMobile ? (
            <>
              <Tooltip title="Exit">
                <IconButton
                  icon={IconName.ArrowBack}
                  onClick={onExit}
                  aria-label="Exit"
                />
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Cancel">
                <span>
                  <IconButton
                    icon={IconName.Close}
                    color="secondary"
                    onClick={onCancel}
                    disabled={!disabled}
                    aria-label="Cancel"
                  />
                </span>
              </Tooltip>
              <Tooltip title="Reset">
                <IconButton icon={IconName.Refresh} onClick={onReset} aria-label="Reset" />
              </Tooltip>
              <Tooltip title="Submit">
                <span>
                  <IconButton
                    icon={IconName.Send}
                    color="primary"
                    onClick={onSubmit}
                    disabled={disabled || !value.trim()}
                    aria-label="Submit"
                  />
                </span>
              </Tooltip>
            </>
          ) : (
            <>
              <Button
                variant="outlined"
                onClick={onExit}
                startIcon={<Icon name={IconName.ArrowBack} />}
              >
                Exit
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button
                variant="outlined"
                color="secondary"
                onClick={onCancel}
                disabled={!disabled}
                startIcon={<Icon name={IconName.Close} />}
              >
                Cancel
              </Button>
              <Button variant="outlined" onClick={onReset}>
                Reset
              </Button>
              <Button
                variant="contained"
                onClick={onSubmit}
                disabled={disabled || !value.trim()}
                startIcon={<Icon name={IconName.Send} />}
              >
                Submit
              </Button>
            </>
          )}
        </Stack>
      </Box>
    </Box>
  );
};
