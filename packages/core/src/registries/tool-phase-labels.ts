/**
 * Per-tool phase labels (#279).
 *
 * The user-facing answer to "what is happening right now" while a portal turn
 * runs a tool. Consumed by the frontend's activity indicator, which resolves a
 * label from the `tool_call` event's `toolName`.
 *
 * **Why this is its own registry rather than a field on `ToolCapability`:** a
 * capability row describes *enforcement* semantics (purity, reads/writes, cost
 * class, locks) and is validated by interlocking `superRefine` rules that a
 * display string has nothing to satisfy. More decisively, custom/webhook tools
 * have **no capability row at all** (`tools.service.ts` passes
 * `capability = undefined`), so a capability field could never label them — a
 * resolver with a fallback is required either way, and `toolPhaseLabel` is it.
 *
 * Built-in tools get curated copy, pinned key-for-key against
 * `ALL_TOOL_CAPABILITIES`. Custom tools get a label derived from their
 * `name` — deliberately **not** their `description`, which is unbounded
 * org-authored prose and is mutated server-side with a cost note.
 */

/** Ceiling for a derived label, and the cap curated copy is held to. */
export const MAX_DERIVED_LABEL_LEN = 48;

/** Shown when a tool name carries no usable words at all. */
const GENERIC_PHASE_LABEL = "Running a tool";

/**
 * Present-tense phase for every built-in + system tool. The key set is pinned
 * equal to `ALL_TOOL_CAPABILITIES` by test, so adding a tool forces a label
 * here rather than silently falling through to `deriveToolPhaseLabel`.
 */
export const TOOL_PHASE_LABELS: Record<string, string> = {
  // System tools — always attached, usually instant.
  current_time: "Checking the time",
  station_context: "Reading station context",
  platform_help: "Looking up help",

  // data_query
  sql_query: "Querying your data",
  display_entity_records: "Fetching records",
  resolve_identity: "Matching records",

  // visualize — the long tail this feature exists for (Opus codegen + retries).
  visualize_d3: "Building the chart",

  // gis (#314)
  visualize_map: "Drawing the map",
  // gis geocoding (#315)
  geocode: "Looking up coordinates",
  reverse_geocode: "Looking up the address",
  bulk_geocode_records: "Geocoding addresses",

  // statistics
  cluster: "Clustering records",
  hypothesis_test: "Running the test",

  // regression — the variants share copy; the user cares about the phase,
  // not which estimator was picked.
  regression: "Fitting the model",
  logistic_regression: "Fitting the model",
  forecast: "Forecasting",

  // financial
  tvm: "Calculating time value",
  npv: "Calculating NPV",
  xnpv: "Calculating NPV",
  irr: "Calculating IRR",
  xirr: "Calculating IRR",
  depreciation: "Calculating depreciation",
  amortize: "Building the schedule",
  var_cvar: "Calculating risk",
  portfolio_metrics: "Analyzing the portfolio",
  bond_math: "Running bond math",
  technical_indicator: "Computing indicators",

  // web_search
  web_search: "Searching the web",

  // entity_management
  entity_record_create: "Creating records",
  entity_record_update: "Updating records",
  entity_record_delete: "Deleting records",
  connector_entity_create: "Creating the entity",
  connector_entity_update: "Updating the entity",
  connector_entity_delete: "Deleting the entity",
  field_mapping_create: "Creating the field mapping",
  field_mapping_update: "Updating the field mapping",
  field_mapping_delete: "Deleting the field mapping",
  transform_entity_records: "Transforming records",
};

/** Truncate to the ceiling, marking the cut so it doesn't read as the name. */
function truncate(label: string): string {
  if (label.length <= MAX_DERIVED_LABEL_LEN) return label;
  return `${label.slice(0, MAX_DERIVED_LABEL_LEN - 1)}…`;
}

/**
 * Fallback label for a tool with no curated copy — i.e. a custom/webhook tool.
 * Reads the tool's `name` only: snake_case (or hyphenated) slug → spaced,
 * lowercased words behind "Running". `refresh_crm` → `"Running refresh crm"`.
 */
export function deriveToolPhaseLabel(toolName: string): string {
  const words = toolName
    .replace(/[\s_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (!words) return GENERIC_PHASE_LABEL;
  return truncate(`Running ${words}`);
}

/**
 * The phase label to display for a running tool: curated copy when the tool is
 * built-in, a name-derived label otherwise. Never throws and never returns an
 * empty string — a missing label must never blank the indicator, since a blank
 * indicator is the "is it stuck?" state this feature removes.
 */
export function toolPhaseLabel(toolName: string): string {
  return TOOL_PHASE_LABELS[toolName] ?? deriveToolPhaseLabel(toolName);
}
