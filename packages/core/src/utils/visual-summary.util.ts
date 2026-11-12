/**
 * Text alternative for a chart or map (#796).
 *
 * The agent writes a `summary` on every new visualization block. Blocks and
 * pins that predate it, or a summary that came back blank, fall back to
 * `deriveVisualSummary`, which states only what we hold for certain: the
 * title, the counts, the field names and, for a map, its layers and what
 * colours them. It never invents a finding.
 */

import type { MapLayerKind } from "../contracts/map-spec.contract.js";

export interface VisualSummaryInput {
  kind: "chart" | "map";
  title?: string;
  /** Column names, in order (first row's keys, or the handle `schema`). */
  fields: string[];
  /** Displayed total: `matchedCount ?? rowCount ?? rows.length`. Undefined
   *  while the data hasn't arrived (a pin before its first delivery): the
   *  summary then names the visualization only. */
  count?: number;
  countExact: boolean;
  /** Maps only. */
  layers?: Array<{ kind: MapLayerKind; colorBy?: string }>;
}

/** Fields listed by name before the rest are counted. */
const MAX_LISTED_FIELDS = 6;

const formatCount = (n: number): string => n.toLocaleString("en-US");

const plural = (n: number, one: string, many: string): string =>
  n === 1 ? one : many;

export function deriveVisualSummary(input: VisualSummaryInput): string {
  const noun = input.kind === "chart" ? "Chart" : "Map";
  const title = input.title?.trim();
  const lead = title ? `${noun}: ${title}.` : `${noun}.`;

  if (input.count === undefined) return lead;
  if (input.count === 0) {
    return `${lead} ${input.kind === "chart" ? "No rows." : "No features."}`;
  }

  const count = `${formatCount(input.count)}${input.countExact ? "" : "+"}`;

  if (input.kind === "chart") {
    const rows = `${count} ${plural(input.count, "row", "rows")}`;
    if (input.fields.length === 0) return `${lead} ${rows}.`;
    const listed = input.fields.slice(0, MAX_LISTED_FIELDS).join(", ");
    const rest = input.fields.length - MAX_LISTED_FIELDS;
    const fields = rest > 0 ? `${listed} and ${rest} more` : listed;
    return `${lead} ${rows}; fields ${fields}.`;
  }

  const layers = input.layers ?? [];
  let text = `${lead} ${count} ${plural(input.count, "feature", "features")}`;
  if (layers.length > 0) {
    text += ` in ${layers.length} ${plural(layers.length, "layer", "layers")} (${layers.map((l) => l.kind).join(", ")})`;
  }
  const colours = [
    ...new Set(layers.map((l) => l.colorBy).filter((c): c is string => !!c)),
  ];
  if (colours.length > 0) text += `; coloured by ${colours.join(", ")}`;
  return `${text}.`;
}

/** The agent's summary when it has one, else the derived fallback. */
export function visualSummary(
  summary: string | undefined,
  input: VisualSummaryInput
): string {
  return summary?.trim() || deriveVisualSummary(input);
}
