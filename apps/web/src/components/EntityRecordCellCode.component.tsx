import React from "react";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";

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
  const serialized =
    type === "json"
      ? JSON.stringify(value, null, 0)
      : JSON.stringify(value);

  const truncated = serialized.length > maxLength;
  const display = truncated ? serialized.slice(0, maxLength) + "…" : serialized;

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
        whiteSpace: "nowrap",
        maxWidth: 320,
        display: "inline-block",
      }}
    >
      {display}
    </Box>
  );

  if (!truncated) return cell;

  return (
    <Tooltip title={serialized} placement="top">
      {cell}
    </Tooltip>
  );
};
