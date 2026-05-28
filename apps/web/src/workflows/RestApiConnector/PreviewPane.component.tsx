/**
 * Add-endpoint preview pane. Renders the raw upstream response side
 * by side with a derived "what would be extracted" pane that updates
 * live as the user types a records-path or a JSONata transform.
 *
 * Pure UI — the parent fires the preview SDK call and feeds:
 *   - `response`        — the cached raw HTTP body, or null while not yet fetched
 *   - `truncated`       — server-side body-size cap was hit
 *   - `loading`         — preview request in flight
 *   - `error`           — preview request failed
 *   - `extractionMode`  — driven by the records-source radio
 *   - `recordsPath` / `transform` — the live edit values to apply
 *
 * Derives:
 *   - The extracted subtree (records-path mode) or transformed result
 *     (transform mode).
 *   - A warning Alert when the path doesn't resolve, the transform
 *     errors, or either produces an empty result.
 */

import React, { useEffect, useMemo, useState } from "react";

import jsonata from "jsonata";
import Alert from "@mui/material/Alert";
import { Box, Stack, Typography } from "@portalai/core/ui";

import { HighlightedCode } from "../../components/HighlightedCode.component";
import type { ExtractionMode } from "./ApiEndpointForm.component";

export interface PreviewPaneUIProps {
  response: unknown | null;
  truncated: boolean;
  loading: boolean;
  error: string | null;
  extractionMode: ExtractionMode;
  recordsPath: string;
  transform: string;
}

type DerivedResult =
  | { kind: "idle" }
  | { kind: "empty" }
  | { kind: "extracted"; value: unknown; count: number }
  | {
      /**
       * Extractor resolved to a non-array, non-null value (e.g. a single
       * object or a primitive). Sync coerces this into a one-element
       * records array — usually wrong when the user expected many
       * records, so we render the value AND a warning Alert.
       */
      kind: "not-array";
      value: unknown;
      valueType: string;
    }
  | { kind: "missing"; message: string }
  | { kind: "parse"; message: string }
  | { kind: "runtime"; message: string };

function describeNonArrayType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// Both panes maintain identical width + height regardless of state
// (idle / loading / error / loaded) so the layout doesn't reflow as the
// user types. Stacked on xs, side-by-side from sm up. `minHeight` ==
// `maxHeight` so placeholder text and dense JSON occupy the same box.
const PREVIEW_PANE_HEIGHT = 320;

const PREVIEW_PLACEHOLDER_SX = {
  margin: 0,
  padding: 1.5,
  border: 1,
  borderColor: "divider",
  borderRadius: 0.5,
  fontSize: 12,
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  height: PREVIEW_PANE_HEIGHT,
  overflow: "auto",
  backgroundColor: "action.hover",
  color: "text.secondary",
} as const;

const PATH_MISSING = Symbol("path-missing");

function walkRecordsPath(
  body: unknown,
  path: string
): unknown | typeof PATH_MISSING {
  if (!path || path.trim() === "") return body;
  const segments = path.split(".");
  let current: unknown = body;
  for (const seg of segments) {
    if (current == null || typeof current !== "object") return PATH_MISSING;
    const next = (current as Record<string, unknown>)[seg];
    if (next === undefined && !(seg in (current as object))) return PATH_MISSING;
    current = next;
  }
  return current;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const PreviewPaneUI: React.FC<PreviewPaneUIProps> = ({
  response,
  truncated,
  loading,
  error,
  extractionMode,
  recordsPath,
  transform,
}) => {
  // ── Records-path derivation (synchronous) ────────────────────────
  const pathResult = useMemo<DerivedResult>(() => {
    if (response == null) return { kind: "idle" };
    if (extractionMode !== "recordsPath") return { kind: "idle" };
    const value = walkRecordsPath(response, recordsPath);
    if (value === PATH_MISSING) {
      return {
        kind: "missing",
        message: `No data at path "${recordsPath || "(empty)"}".`,
      };
    }
    if (Array.isArray(value)) {
      return value.length === 0
        ? { kind: "empty" }
        : { kind: "extracted", value, count: value.length };
    }
    if (value === null || value === undefined) return { kind: "empty" };
    return {
      kind: "not-array",
      value,
      valueType: describeNonArrayType(value),
    };
  }, [response, extractionMode, recordsPath]);

  // ── Transform derivation (async; runs jsonata) ───────────────────
  const [transformResult, setTransformResult] = useState<DerivedResult>({
    kind: "idle",
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      if (extractionMode !== "transform") {
        setTransformResult({ kind: "idle" });
        return;
      }
      if (!transform || transform.trim() === "") {
        setTransformResult({ kind: "idle" });
        return;
      }
      if (response == null) {
        setTransformResult({ kind: "idle" });
        return;
      }
      let compiled: ReturnType<typeof jsonata>;
      try {
        compiled = jsonata(transform);
      } catch (err) {
        if (cancelled) return;
        setTransformResult({
          kind: "parse",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }
      try {
        const evaluated = await compiled.evaluate(response);
        if (cancelled) return;
        if (evaluated === null || evaluated === undefined) {
          setTransformResult({ kind: "empty" });
          return;
        }
        if (Array.isArray(evaluated)) {
          setTransformResult(
            evaluated.length === 0
              ? { kind: "empty" }
              : {
                  kind: "extracted",
                  value: evaluated,
                  count: evaluated.length,
                }
          );
          return;
        }
        setTransformResult({
          kind: "not-array",
          value: evaluated,
          valueType: describeNonArrayType(evaluated),
        });
      } catch (err) {
        if (cancelled) return;
        setTransformResult({
          kind: "runtime",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [response, extractionMode, transform]);

  const derived =
    extractionMode === "recordsPath" ? pathResult : transformResult;

  return (
    <Stack spacing={1} data-testid="preview-pane">
      {error ? <Alert severity="error">{error}</Alert> : null}
      {truncated ? (
        <Alert severity="info">
          Preview truncated to ~256 KB. The sync still consumes the full
          upstream response.
        </Alert>
      ) : null}
      {derived.kind === "missing" ? (
        <Alert severity="warning">{derived.message}</Alert>
      ) : null}
      {derived.kind === "parse" ? (
        <Alert severity="warning">
          Transform parse error: {derived.message}
        </Alert>
      ) : null}
      {derived.kind === "runtime" ? (
        <Alert severity="warning">
          Transform runtime error: {derived.message}
        </Alert>
      ) : null}
      {derived.kind === "empty" ? (
        <Alert severity="warning">
          {extractionMode === "recordsPath"
            ? "Records path resolved to an empty value — sync would import zero records."
            : "Transform produced an empty result — sync would import zero records."}
        </Alert>
      ) : null}
      {derived.kind === "not-array" ? (
        <Alert severity="warning">
          {extractionMode === "recordsPath"
            ? `Records path resolved to a ${derived.valueType}, not an array. Sync expects an array of records — the import would treat this as a single record.`
            : `Transform returned a ${derived.valueType}, not an array. Sync expects an array of records — the import would treat this as a single record. Most JSONata expressions should end with an array constructor like \`[...]\` or a list comprehension like \`data.{ ... }\`.`}
        </Alert>
      ) : null}

      <Box
        sx={{
          display: "grid",
          // xs: stack vertically. sm+: equal-width columns so the
          // panes don't reflow as the user types or as the data
          // changes shape between states.
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: 1,
          alignItems: "start",
        }}
      >
        <Stack spacing={0.5} sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            Raw response (page 1)
          </Typography>
          {response == null || loading ? (
            <Box
              component="pre"
              sx={PREVIEW_PLACEHOLDER_SX}
              data-testid="preview-raw"
            >
              {loading
                ? "Loading…"
                : "Click Preview to fetch the first page of the endpoint."}
            </Box>
          ) : (
            <Box sx={{ "& pre": { height: PREVIEW_PANE_HEIGHT } }}>
              <HighlightedCode
                code={safeStringify(response)}
                language="json"
                maxHeight={PREVIEW_PANE_HEIGHT}
                data-testid="preview-raw"
              />
            </Box>
          )}
        </Stack>
        <Stack spacing={0.5} sx={{ minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary">
            {extractionMode === "recordsPath"
              ? `Extracted via "${recordsPath || "(empty)"}"`
              : "Transformed output"}
            {derived.kind === "extracted"
              ? ` — ${derived.count} record${derived.count === 1 ? "" : "s"}`
              : ""}
          </Typography>
          {derived.kind === "extracted" || derived.kind === "not-array" ? (
            <Box sx={{ "& pre": { height: PREVIEW_PANE_HEIGHT } }}>
              <HighlightedCode
                code={safeStringify(
                  derived.kind === "extracted" &&
                    Array.isArray(derived.value)
                    ? derived.value.slice(0, 10)
                    : derived.value
                )}
                language="json"
                maxHeight={PREVIEW_PANE_HEIGHT}
                data-testid="preview-extracted"
              />
            </Box>
          ) : (
            <Box
              component="pre"
              sx={PREVIEW_PLACEHOLDER_SX}
              data-testid="preview-extracted"
            >
              {derived.kind === "idle"
                ? response == null
                  ? "Preview the response first."
                  : extractionMode === "transform"
                    ? "Enter a JSONata expression to see the transformed result."
                    : ""
                : ""}
            </Box>
          )}
        </Stack>
      </Box>
    </Stack>
  );
};
