/**
 * Rewrite a Vega-Lite spec for compatibility with `vega.changeset()`
 * incremental rendering (#85 Phase 3 slice 3).
 *
 * The agent emits specs against `data: { values: [...] }` (or
 * `data: { values: [] }` when waiting for rows). The renderer applies
 * `vega.changeset` against a *named* dataset only, so we swap
 * `data: { values }` → `data: { name: "primary" }` before returning
 * the spec to the UI. Multi-source (`datasets: {...}`) and already-
 * named specs pass through unchanged.
 *
 * Pure function; no I/O. Used by visualize + visualize_tree.
 */

export function rewriteForNamedDataset(
  spec: Record<string, unknown>,
  datasetName = "primary"
): Record<string, unknown> {
  // Multi-source — pass through; the renderer falls back to its
  // inline-rows path and accumulates batches client-side before
  // rendering.
  if (
    spec.datasets &&
    typeof spec.datasets === "object" &&
    Object.keys(spec.datasets as object).length > 0
  ) {
    return spec;
  }

  const data = spec.data;
  if (
    data &&
    typeof data === "object" &&
    "values" in (data as Record<string, unknown>)
  ) {
    return { ...spec, data: { name: datasetName } };
  }
  // No `data` field at all — common shape when the agent expects the
  // runtime to provide the data. The handle path needs a
  // named-dataset anchor on the spec so react-vega's `data` prop can
  // bind the fetched rows; without it, the rows arrive with nowhere
  // to land and the chart renders axes-only (#109).
  if (data === undefined || data === null) {
    return { ...spec, data: { name: datasetName } };
  }
  // Already-named (`data: { name }`) or external (`data: { url }`) —
  // pass through.
  return spec;
}
