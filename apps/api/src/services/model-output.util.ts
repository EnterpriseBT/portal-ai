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
/** Kept fields (spec, pipeline, program) are cut back only past this, and
 *  only when the view would otherwise exceed the budget. */
const FIELD_CAP = 10_000;
/** The sample's own budget, leaving room for the kept fields. */
const SAMPLE_PAYLOAD_CAP = 50_000;
/** Rows considered for the sample; capping reads no further. */
const SAMPLE_ROWS = 20;
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

function fits(value: unknown): boolean {
  const json = serialize(value);
  return json !== undefined && bytesOf(json) <= MODEL_OUTPUT_MAX_BYTES;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The first rows as objects (a tuple row becomes `{ value }`), cell- and
 *  payload-capped. */
function sampleOf(rows: unknown[]): Record<string, unknown>[] {
  return capSamplePeek(
    rows.slice(0, SAMPLE_ROWS).map((r) => (isRecord(r) ? r : { value: r })),
    { payloadCap: SAMPLE_PAYLOAD_CAP }
  );
}

export function toModelView(output: unknown): unknown {
  if (output === undefined) return output;
  const json = serialize(output);
  // #726 (review): an output that can't be measured fails closed.
  if (json === undefined)
    return {
      truncated: true,
      note: "This result could not be serialized for the model; the user sees it in full.",
    };
  const bytes = bytesOf(json);
  if (bytes <= MODEL_OUTPUT_MAX_BYTES) return output;

  const rows = Array.isArray(output)
    ? output
    : isRecord(output) && Array.isArray(output.rows)
      ? output.rows
      : null;
  if (rows) {
    const rest: Record<string, unknown> = Array.isArray(output)
      ? {}
      : (({ rows: _rows, ...others }) => others)(
          output as Record<string, unknown>
        );
    const projected = (fields: Record<string, unknown>) => ({
      ...fields,
      rowCount: rows.length,
      samplePeek: sampleOf(rows),
      note:
        `The ${rows.length} rows (${bytes} bytes) are omitted here to fit the ` +
        `model's context; the user sees the full result. samplePeek holds the ` +
        `first rows with long values truncated.`,
    });
    // Keep the other fields (spec, pipeline, program) whole when they fit.
    const whole = projected(rest);
    if (fits(whole)) return whole;
    const capped = projected(applyCellCap([rest], FIELD_CAP)[0]);
    if (fits(capped)) return capped;
  }

  return {
    truncated: true,
    originalBytes: bytes,
    ...(isRecord(output) ? { fields: Object.keys(output) } : {}),
    preview: json.slice(0, PREVIEW_CHARS),
    note:
      `This result (${bytes} bytes) is too large for the model's context; ` +
      `the user sees it in full. preview is its first ${PREVIEW_CHARS} characters.`,
  };
}

/** The slice of the AI SDK tool shape this wrap touches. */
export interface ModelOutputTool {
  toModelOutput?: (options: {
    toolCallId: string;
    input: unknown;
    output: unknown;
  }) => unknown;
}

/** The SDK's default model output for a result (string → text, else JSON). */
function defaultModelOutput(value: unknown, original: unknown) {
  if (value === original && typeof original === "string")
    return { type: "text", value: original };
  return { type: "json", value: value === undefined ? null : value };
}

/**
 * #726: give every built tool a `toModelOutput` that sends the model
 * {@link toModelView} of its result. Next to the cost-gate wrap in
 * `buildAnalyticsTools`, so no tool (built-in or custom) can skip it. A tool's
 * own `toModelOutput` still runs first; a JSON result from it is capped too.
 */
export function wrapWithModelOutputCap(
  tools: Record<string, ModelOutputTool>
): void {
  for (const tool of Object.values(tools)) {
    const own = tool.toModelOutput;
    tool.toModelOutput = async (options) => {
      if (own) {
        const shaped = (await own(options)) as {
          type?: string;
          value?: unknown;
        };
        return shaped?.type === "json"
          ? { ...shaped, value: toModelView(shaped.value) ?? null }
          : shaped;
      }
      return defaultModelOutput(toModelView(options.output), options.output);
    };
  }
}
