import React from "react";

import type { ColumnDataType } from "@portalai/core/models";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";

import { Formatter } from "../utils/format.util";

// ── Types ────────────────────────────────────────────────────────────

export interface EntityRecordFieldValueProps {
  value: unknown;
  type: ColumnDataType;
}

// ── Component ────────────────────────────────────────────────────────

export const EntityRecordFieldValue: React.FC<EntityRecordFieldValueProps> = ({
  value,
  type,
}) => {
  const [copied, setCopied] = React.useState(false);

  if (value == null) {
    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }

  if (type === "json" || type === "array" || type === "reference-array") {
    let parsed = value;
    if (typeof value === "string") {
      try {
        parsed = JSON.parse(value);
      } catch {
        // leave as-is if not valid JSON
      }
    }
    const text = JSON.stringify(parsed, null, 2);

    const handleCopy = () => {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };

    return (
      <Box sx={{ position: "relative" }}>
        <Tooltip title={copied ? "Copied!" : "Copy"} placement="top">
          <IconButton
            size="small"
            onClick={handleCopy}
            sx={{ position: "absolute", top: 4, right: 4 }}
          >
            {copied ? (
              <CheckIcon fontSize="inherit" color="success" />
            ) : (
              <ContentCopyIcon fontSize="inherit" />
            )}
          </IconButton>
        </Tooltip>
        <Box
          component="pre"
          sx={{
            fontFamily: "monospace",
            fontSize: "0.8125rem",
            backgroundColor: "action.hover",
            borderRadius: 1,
            p: 1.5,
            pr: 4,
            m: 0,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {text}
        </Box>
      </Box>
    );
  }

  return (
    <Typography variant="body2">{Formatter.format(value, type)}</Typography>
  );
};
