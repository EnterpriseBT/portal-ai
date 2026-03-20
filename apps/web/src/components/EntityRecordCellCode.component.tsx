import React from "react";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

// ── Types ────────────────────────────────────────────────────────────

export interface EntityRecordCellCodeProps {
  value: unknown;
  type: "json" | "array";
  maxLength?: number;
}

// ── Component ────────────────────────────────────────────────────────

export const EntityRecordCellCode: React.FC<EntityRecordCellCodeProps> = ({
  value,
  type,
  maxLength = 80,
}) => {
  if (value == null) {
    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }

  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      // leave as-is
    }
  }

  const serialized =
    type === "json" ? JSON.stringify(parsed, null, 0) : JSON.stringify(parsed);

  const safe = serialized ?? "";
  const truncated = safe.length > maxLength;
  const display = truncated ? safe.slice(0, maxLength) + "…" : safe;

  const cell = (
    <Box
      component="code"
      sx={{
        fontFamily: "monospace",
        fontSize: "0.8125rem",
        backgroundColor: "action.hover",
        borderRadius: 0.5,
        px: 0.5,
        py: 0.25,
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: 320,
        display: "inline-block",
      }}
    >
      {display}
    </Box>
  );

  if (!truncated) return cell;

  return (
    <Tooltip title={safe} placement="top">
      {cell}
    </Tooltip>
  );
};
