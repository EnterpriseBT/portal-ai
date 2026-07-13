/**
 * JSONata transform editor — the textarea + a one-line help caption.
 *
 * Live preview (raw response on the left, transformed records on the
 * right, plus inline parse / runtime / empty-result warnings) is now
 * owned by `PreviewPaneUI` rendered just below this component in the
 * Add-endpoint form. Earlier versions duplicated those panes here;
 * they were removed once the Preview button + pane covered the same
 * UX with richer feedback.
 *
 * Pure UI by Component File Policy: receives `value` + `onChange` and
 * an optional `serverError` for surfacing prior server-side
 * transform-failed degradations from the post-commit probe path. The
 * `lastProbeResponse` prop stays in the signature for backward
 * compatibility with the workflow's existing wiring; it isn't read.
 */

import React from "react";

import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import TextField from "@mui/material/TextField";
import { Stack, Typography } from "@portalai/core/ui";

const EXAMPLE_TRANSFORM = `data.items.{ "id": id, "user_name": user.name }`;

export interface TransformEditorUIProps {
  value: string;
  onChange: (value: string) => void;
  /**
   * Kept on the prop type for backward compatibility with the workflow's
   * existing wiring; the live preview now lives in `PreviewPaneUI` and
   * this component ignores the field.
   */
  lastProbeResponse?: unknown | null;
  /** Server-side transform-failed details from the last probe (decision 5/15). */
  serverError?: { kind: "parse" | "runtime"; message: string } | null;
}

export const TransformEditorUI: React.FC<TransformEditorUIProps> = ({
  value,
  onChange,
  serverError,
}) => {
  return (
    <Stack spacing={1.5} data-testid="transform-editor">
      <Typography variant="caption" color="text.secondary">
        JSONata expression — evaluates against the raw HTTP response and must
        return an array of flat records. Use the Preview button below to see the
        transformed output as you type.{" "}
        <Link
          href="https://docs.jsonata.org/"
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
          data-testid="jsonata-docs-link"
        >
          JSONata documentation →
        </Link>
      </Typography>

      <TextField
        label="Transform expression"
        value={value}
        placeholder={EXAMPLE_TRANSFORM}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange(e.target.value)
        }
        multiline
        minRows={4}
        fullWidth
        slotProps={{
          htmlInput: {
            "aria-label": "Transform expression",
            spellCheck: false,
            style: { fontFamily: "monospace", fontSize: 13 },
          },
          inputLabel: { shrink: true },
        }}
      />

      {serverError ? (
        <Alert severity="warning">
          Last probe: transform {serverError.kind} error — {serverError.message}
        </Alert>
      ) : null}
    </Stack>
  );
};
