import type { z } from "zod";

import type {
  MapSpec,
  QueryHandleEnvelopeFieldsSchema,
} from "@portalai/core/contracts";
import type { VisualSummaryInput } from "@portalai/core/utils";

type QueryHandleEnvelopeFields = z.infer<
  typeof QueryHandleEnvelopeFieldsSchema
>;

/** The handle fields a summary reads: the column names and the counts. */
export type SummaryHandle = Pick<
  QueryHandleEnvelopeFields,
  "schema" | "rowCount" | "truncated" | "matchedCount" | "matchedCountExact"
>;

export interface SummaryData {
  kind: "chart" | "map";
  title?: string;
  /** Inline rows, when the widget has them. */
  rows?: Record<string, unknown>[] | null;
  /** The handle envelope, when the data is staged. */
  handle?: SummaryHandle | null;
  /** Maps only: the spec whose layers the summary names. */
  spec?: MapSpec;
}

/**
 * The input `visualSummary` needs (#796), from whatever data a widget holds.
 * With neither rows nor a handle (a pin before its first delivery, a tiled
 * pin) the count is unknown, so the derived summary names the visual only.
 */
export function toSummaryInput(data: SummaryData): VisualSummaryInput {
  const { handle, rows } = data;
  const input: VisualSummaryInput = {
    kind: data.kind,
    title: data.title,
    fields: handle
      ? handle.schema.map((c) => c.name)
      : Object.keys(rows?.[0] ?? {}),
    count: handle
      ? (handle.matchedCount ?? handle.rowCount)
      : rows
        ? rows.length
        : undefined,
    countExact: handle ? (handle.matchedCountExact ?? !handle.truncated) : true,
  };
  if (data.spec) {
    input.layers = data.spec.layers.map((layer) => ({
      kind: layer.kind,
      colorBy: layer.style?.colorBy?.column,
    }));
  }
  return input;
}
