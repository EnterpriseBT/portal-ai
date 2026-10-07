/**
 * #726: what the model reads of a tool result.
 *
 * A tool's `execute` return goes to SSE, persistence and the widget in full.
 * Without a projection it also went to the model verbatim, and an inline
 * result is bounded by row count, not bytes: `visualize_map`'s inline branch
 * returns up to 100 full GeoJSON polygons (contours ran to 2.78M tokens), and
 * that payload is re-sent on every later step of the turn.
 *
 * `toModelView` keeps a result under {@link MODEL_OUTPUT_MAX_BYTES}:
 *   - at or under the cap → unchanged (every tool that fits today is byte-identical);
 *   - over, with a `rows` array → `rowCount` + a capped `samplePeek` (the
 *     #704 sample cap) in place of the rows, other fields kept with long
 *     values truncated, and a note that the user sees the full result;
 *   - otherwise → a truncated JSON preview.
 *
 * Applied to every built tool by {@link wrapWithModelOutputCap} (live calls)
 * and to replayed tool results in `reconstructModelMessages`.
 */

import { applyCellCap, capSamplePeek } from "./portal-sql-response.util.js";

/** The model-facing budget per tool result: the SQL path's `payloadCap`. */
export const MODEL_OUTPUT_MAX_BYTES = 100_000;
/** A non-row field (spec, pipeline, schema) is kept unless it exceeds this. */
const FIELD_CAP = 10_000;
/** The sample's own budget, leaving room for the kept fields. */
const SAMPLE_PAYLOAD_CAP = 50_000;
const PREVIEW_CHARS = 2_000;

function serialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function bytesOf(json: string): number {
  return Buffer.byteLength(json, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toModelView(output: unknown): unknown {
  const json = serialize(output);
  if (json === undefined) return output;
  const bytes = bytesOf(json);
  if (bytes <= MODEL_OUTPUT_MAX_BYTES) return output;

  if (isRecord(output) && Array.isArray(output.rows)) {
    const { rows, ...rest } = output as Record<string, unknown> & {
      rows: unknown[];
    };
    const records = rows.filter(isRecord);
    const view = {
      ...applyCellCap([rest], FIELD_CAP)[0],
      rowCount: rows.length,
      samplePeek: capSamplePeek(records, { payloadCap: SAMPLE_PAYLOAD_CAP }),
      note:
        `The ${rows.length} rows (${bytes} bytes) are omitted here to fit the ` +
        `model's context; the user sees the full result. samplePeek holds the ` +
        `first rows with long values truncated.`,
    };
    const viewJson = serialize(view);
    if (viewJson !== undefined && bytesOf(viewJson) <= MODEL_OUTPUT_MAX_BYTES)
      return view;
  }

  return {
    truncated: true,
    originalBytes: bytes,
    preview: json.slice(0, PREVIEW_CHARS),
    note:
      `This result (${bytes} bytes) is too large for the model's context; ` +
      `the user sees it in full. preview is its first ${PREVIEW_CHARS} characters.`,
  };
}

/** The slice of the AI SDK tool shape this wrap touches. */
export interface ModelOutputTool {
  toModelOutput?: (options: { output: unknown }) => unknown;
}

/**
 * #726: give every built tool a `toModelOutput` that sends the model
 * {@link toModelView} of its result. Next to the cost-gate wrap in
 * `buildAnalyticsTools`, so no tool (built-in or custom) can skip it.
 */
export function wrapWithModelOutputCap(
  tools: Record<string, ModelOutputTool>
): void {
  for (const tool of Object.values(tools)) {
    tool.toModelOutput = ({ output }) => {
      const value = toModelView(output);
      // Within budget, match the SDK's own default exactly: a string as
      // text, anything else as JSON (undefined → null).
      if (value === output && typeof output === "string")
        return { type: "text", value: output };
      return { type: "json", value: value === undefined ? null : value };
    };
  }
}
