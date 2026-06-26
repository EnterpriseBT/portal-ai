/**
 * Transform-fold registry (#159).
 *
 * A transform handle stores a serializable descriptor of "how to derive this
 * handle's rows from a source handle" instead of a SQL string. This registry
 * reconstructs the fold from the descriptor so `PortalSqlHandleService` can
 * re-execute it (production pass + cursor re-fold) without importing any
 * specific compute engine — the same way it re-runs `sql` for a query handle.
 *
 * Keep this layer generic: new transform kinds register a fold here; the
 * handle service stays agnostic.
 */

import {
  technicalIndicatorStream,
  type IndicatorName,
} from "./technical-indicator-stream.js";

/** Serializable "how to derive this handle" — stored in the handle meta. */
export type TransformDescriptor = {
  kind: "technical_indicator";
  /** The handle whose ordered rows feed the fold. */
  sourceHandle: string;
  /** The source column the fold orders by (and the output's date column). */
  dateColumn: string;
  valueColumn: string;
  indicator: IndicatorName;
  params?: Record<string, unknown>;
};

/**
 * Apply a transform descriptor to an ordered source stream, yielding output
 * row batches. Dispatches on `kind`; throws for an unknown kind (a forward-
 * compat guard — a handle produced by a newer build read by an older one).
 */
export function applyTransformFold(
  descriptor: TransformDescriptor,
  sourceBatches: AsyncIterable<Record<string, unknown>[]>
): AsyncGenerator<Record<string, unknown>[]> {
  switch (descriptor.kind) {
    case "technical_indicator":
      return technicalIndicatorStream(sourceBatches, {
        dateColumn: descriptor.dateColumn,
        valueColumn: descriptor.valueColumn,
        indicator: descriptor.indicator,
        params: descriptor.params,
      });
    default:
      throw new Error(
        `Unknown transform kind: ${(descriptor as { kind: string }).kind}`
      );
  }
}
