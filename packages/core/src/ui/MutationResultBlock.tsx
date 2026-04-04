import React from "react";

import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";

import type { MutationResultContentBlock } from "../contracts/portal.contract.js";

const OPERATION_LABELS: Record<string, { label: string; severity: "success" | "info" | "warning" }> = {
  created: { label: "Created", severity: "success" },
  updated: { label: "Updated", severity: "info" },
  deleted: { label: "Deleted", severity: "warning" },
};

function formatSummary(summary: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (value == null || key === "cascaded") continue;
    if (Array.isArray(value)) {
      parts.push(`${key}: ${value.join(", ")}`);
    } else if (typeof value === "boolean") {
      if (value) parts.push(key);
    } else {
      parts.push(`${key}: ${String(value)}`);
    }
  }
  return parts.join(" · ");
}

export interface MutationResultBlockProps {
  content: MutationResultContentBlock;
}

export const MutationResultBlock: React.FC<MutationResultBlockProps> = ({ content }) => {
  const config = OPERATION_LABELS[content.operation] ?? { label: content.operation, severity: "info" as const };
  const summaryText = content.summary ? formatSummary(content.summary) : "";

  return (
    <Alert
      severity={config.severity}
      variant="outlined"
      sx={{ py: 0.5, my: 0.5, "& .MuiAlert-message": { py: 0.25 } }}
    >
      <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
        {config.label}
      </Typography>
      {" "}
      <Typography variant="body2" component="span">
        {content.entity}
      </Typography>
      {summaryText && (
        <Typography variant="body2" component="span" sx={{ color: "text.secondary", ml: 1 }}>
          ({summaryText})
        </Typography>
      )}
    </Alert>
  );
};
