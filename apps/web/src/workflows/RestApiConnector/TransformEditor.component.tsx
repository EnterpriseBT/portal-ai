/**
 * Slice 8 — JSONata transform editor + live preview.
 *
 * Renders inside the "Advanced — transform" collapsible section of
 * `ApiEndpointForm`. Wraps:
 *
 *   - a `<textarea>` for the expression (Monaco is a follow-up);
 *   - two side-by-side JSON previews — the raw probe response on the
 *     left, the transformed records on the right;
 *   - an inline status line (parse / runtime error or record count).
 *
 * Pure UI by Component File Policy: receives `value` + `onChange` +
 * the cached `lastProbeResponse` from the workflow container, plus
 * an optional `serverError` for surfacing prior server-side
 * transform-failed degradations.
 *
 * The live preview runs the same `jsonata` library the server uses,
 * so what the user sees in the preview pane is what the server will
 * see at probe / sync time. Errors are classified into parse vs
 * runtime in lockstep with `applyTransform` on the API side.
 */

import React, { useEffect, useState } from "react";

import jsonata from "jsonata";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import { Stack, Typography } from "@portalai/core/ui";

export interface TransformEditorUIProps {
  value: string;
  onChange: (value: string) => void;
  /** Last raw HTTP probe response, when one is cached on the workflow. */
  lastProbeResponse: unknown | null;
  /** Server-side transform-failed details from the last probe (decision 5/15). */
  serverError?: { kind: "parse" | "runtime"; message: string } | null;
}

type LocalResult =
  | { kind: "empty" }
  | { kind: "no-response" }
  | { kind: "ok"; records: unknown[] }
  | { kind: "parse"; message: string }
  | { kind: "runtime"; message: string };

export const TransformEditorUI: React.FC<TransformEditorUIProps> = ({
  value,
  onChange,
  lastProbeResponse,
  serverError,
}) => {
  const [local, setLocal] = useState<LocalResult>({ kind: "empty" });

  useEffect(() => {
    let cancelled = false;
    if (!value || value.trim() === "") {
      setLocal({ kind: "empty" });
      return;
    }
    if (lastProbeResponse === null || lastProbeResponse === undefined) {
      setLocal({ kind: "no-response" });
      return;
    }
    let compiled: ReturnType<typeof jsonata>;
    try {
      compiled = jsonata(value);
    } catch (err) {
      setLocal({
        kind: "parse",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    (async () => {
      try {
        const evaluated = await compiled.evaluate(lastProbeResponse);
        if (cancelled) return;
        setLocal({ kind: "ok", records: coerceRecords(evaluated) });
      } catch (err) {
        if (cancelled) return;
        setLocal({
          kind: "runtime",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, lastProbeResponse]);

  return (
    <Stack spacing={1.5} data-testid="transform-editor">
      <Typography variant="caption" color="text.secondary">
        JSONata expression — evaluates against the raw HTTP response and
        must return an array of flat records. Mutually exclusive with
        Records path.
      </Typography>

      <TextField
        label="Transform expression"
        value={value}
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
        }}
      />

      {serverError ? (
        <Alert severity="warning">
          Last probe: transform {serverError.kind} error — {serverError.message}
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1} alignItems="stretch">
        <Stack flexGrow={1} spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Last probe response
          </Typography>
          <pre
            data-testid="transform-preview-raw"
            style={{
              margin: 0,
              padding: 8,
              border: "1px solid",
              borderColor: "rgba(0,0,0,0.12)",
              borderRadius: 4,
              fontSize: 12,
              maxHeight: 200,
              overflow: "auto",
              backgroundColor: "rgba(0,0,0,0.02)",
            }}
          >
            {lastProbeResponse == null
              ? "Probe an endpoint first to see a live preview."
              : safeStringify(lastProbeResponse)}
          </pre>
        </Stack>
        <Stack flexGrow={1} spacing={0.5}>
          <Typography variant="caption" color="text.secondary">
            Transformed
          </Typography>
          <pre
            data-testid="transform-preview-out"
            style={{
              margin: 0,
              padding: 8,
              border: "1px solid",
              borderColor: "rgba(0,0,0,0.12)",
              borderRadius: 4,
              fontSize: 12,
              maxHeight: 200,
              overflow: "auto",
              backgroundColor: "rgba(0,0,0,0.02)",
            }}
          >
            {local.kind === "ok"
              ? safeStringify(local.records.slice(0, 10))
              : ""}
          </pre>
        </Stack>
      </Stack>

      <Typography
        variant="caption"
        color={
          local.kind === "parse" || local.kind === "runtime"
            ? "error.main"
            : "text.secondary"
        }
        data-testid="transform-status"
      >
        {statusLine(local)}
      </Typography>
    </Stack>
  );
};

function statusLine(result: LocalResult): string {
  switch (result.kind) {
    case "empty":
      return "Enter an expression to preview the transformed records.";
    case "no-response":
      return "Probe an endpoint first to see a live preview.";
    case "ok":
      return result.records.length === 1
        ? "✓ 1 record"
        : `✓ ${result.records.length} records`;
    case "parse":
      return `✗ Parse error: ${result.message}`;
    case "runtime":
      return `✗ Runtime error: ${result.message}`;
  }
}

function coerceRecords(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return [...value];
  if (typeof value === "object") return [value];
  return [{ value }];
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
