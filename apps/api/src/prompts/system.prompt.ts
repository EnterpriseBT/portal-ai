import { TABLE_DISPLAY_ROW_LIMIT } from "@portalai/core/constants";
import {
  BuiltinToolpackSlugSchema,
  type BuiltinToolpackSlug,
} from "@portalai/core/registries";

import type {
  EntitySchema,
  EntityGroupContext,
} from "../services/analytics.service.js";
import type { ResolvedCapabilities } from "../utils/resolve-capabilities.util.js";
import type { CustomPackSummary } from "../services/entitlement.service.js";

/**
 * Connector instance attached to this station — surfaced in the
 * system prompt so the agent has a static reference for any tool
 * call that takes a `connectorInstanceId` (today: `connector_entity_create`).
 *
 * These are configuration: they don't change during a portal session,
 * so the static prompt is the right home (versus the meta views in
 * portal-sql.service.ts, which exist because their data DOES change
 * mid-session).
 *
 * `name` + `display` are user-supplied labels; `slug` is the
 * connector-definition machine name (`rest-api`, `file-upload`, …).
 * Sensitive fields (config, credentials) are never surfaced here.
 */
export interface ConnectorInstanceContext {
  id: string;
  name: string;
  /** Human-readable connector type, e.g. "REST API". */
  display: string;
  /** Machine slug, e.g. "rest-api". */
  slug: string;
}

export interface StationContext {
  stationId: string;
  stationName: string;
  entities: EntitySchema[];
  entityGroups: EntityGroupContext[];
  /**
   * The packs whose tools actually EXIST in this session: the station's
   * configured packs ∩ the org tier's entitlements (#284).
   *
   * Named for the distinction on purpose. This field used to be `toolPacks`
   * carrying the *configured* set, while `buildAnalyticsTools` built tools
   * from the entitled subset — so the prompt described tools that had been
   * stripped from the same session, and the agent was told it could write
   * entities with no tool to do it. Anything gated on capability must gate
   * on this list.
   */
  effectiveToolPacks: string[];
  /**
   * Configured but excluded by the org's plan (#284). Drives the plan-limit
   * guidance: the agent can tell "your plan doesn't include this" apart from
   * "this station doesn't have it", and never presents a plan limit as a
   * missing product capability.
   */
  unentitledToolPacks: string[];
  /**
   * Org-registered (webhook) toolpacks attached to this station (#306).
   *
   * Kept separate from `effectiveToolPacks` deliberately: that list is typed
   * to built-in slugs and is what `PACK_PROMPT_SECTIONS` and the capability
   * gates key off, so a custom pack cannot live in it. Empty when the org's
   * tier excludes custom toolpacks — their tools aren't constructed then, so
   * naming them would describe nothing.
   */
  customToolPacks?: CustomPackSummary[];
  entityCapabilities?: Record<string, ResolvedCapabilities>;
  /** Attached connector instances; rendered when the entity_management
   *  pack is enabled so the agent knows what to pass for
   *  `connectorInstanceId`. Empty array is fine (no entity-mgmt tool
   *  call possible). */
  connectorInstances?: ConnectorInstanceContext[];
  /** IANA timezone for the org owning this portal. Always present;
   *  resolved at session start and falls back to "UTC" if the stored
   *  value isn't a recognized IANA name. The system prompt names it so
   *  the agent can resolve relative time expressions against the org's
   *  local clock without a tool round-trip just for the timezone. */
  organizationTimezone: string;
}

// ── The declared capability surface (#284) ────────────────────────────
//
// Everything the prompt says the agent CAN DO is declared here, per pack, and
// emitted only for packs in `effectiveToolPacks`. That is the mechanism behind
// "the agent can never claim a capability it doesn't have":
//
//  - the `Record<BuiltinToolpackSlug, …>` is exhaustive, so adding a slug to
//    the registry fails `type-check` until it declares an entry (`render: []`
//    is a legal, explicit "this pack needs no guidance");
//  - the cross-cutting prose (role intro, Response Style, the
//    interpretive-tools sentence) is ASSEMBLED from these fields instead of
//    hardcoding a list that silently outlives a re-tier;
//  - a guard test renders the prompt with each slug in and out of the
//    effective set and asserts `markers` appear iff the pack is effective.
//
// Before this, only 3 of 7 slugs gated anything and the cross-cutting prose
// named charts, forecasts, regressions, `hypothesis_test`, `web_search` and
// `resolve_identity` unconditionally — which is how a standard-tier agent came
// to offer visualization it had no tool for.
//
// Re-tiering a pack in `tier-catalog.ts` therefore changes what the agent
// claims with no edit here.

interface PackPromptSection {
  /**
   * Verb phrase for the role intro's capability list ("render
   * visualizations"). Must be pairwise distinct and non-substring across
   * packs — the guard test compares strings, and it pins that invariant.
   */
  capability: string;
  /** Request shapes for the routing bullet's parenthetical ("a chart"). */
  requestShapes: string[];
  /** Rendered-block nouns for Response Style ("charts"). */
  blocks: string[];
  /** Tools whose output needs an interpretive sentence ("hypothesis_test"). */
  interpretiveTools: string[];
  /**
   * Strings that must appear in the prompt iff this pack is effective — the
   * guard test's assertion set. A pack with no guidance block still declares
   * its capability phrase here, since that phrase is itself a claim.
   */
  markers: string[];
  /** The pack's guidance block. `[]` when the pack needs none. */
  render: (ctx: StationContext) => string[];
}

/**
 * Is SQL authoring available? `sql_query` (data_query) and `visualize_d3`
 * (#269) both take SQL, so the shared authoring guidance is gated on the
 * union — it belongs to neither pack and is deliberately absent from both
 * `markers` sets.
 */
function sqlAuthoringAvailable(ctx: StationContext): boolean {
  return (
    ctx.effectiveToolPacks.includes("data_query") ||
    ctx.effectiveToolPacks.includes("visualize")
  );
}

export const PACK_PROMPT_SECTIONS: Record<
  BuiltinToolpackSlug,
  PackPromptSection
> = {
  data_query: {
    capability: "query and read data",
    requestShapes: ["a query"],
    blocks: ["data tables"],
    interpretiveTools: ["resolve_identity"],
    markers: ["query and read data", "resolve_identity", "### Reading Data"],
    render: () => {
      const lines: string[] = [];
      lines.push("### Reading Data");
      lines.push("");
      lines.push("There are two tools to reach for, depending on intent:");
      lines.push("");
      lines.push(
        "- **`display_entity_records`** — when the user asks to **see, " +
          "show, display, or list** records of an entity (any cardinality). " +
          "This is purpose-built: pass `entityKey` (and optionally `columns`), " +
          "the UI renders every row in a single live table widget. No SQL, no " +
          "row-count question, no pagination needed."
      );
      lines.push(
        "- **`sql_query`** — for analytical work: filters, joins, " +
          "aggregations, derived columns, exploratory peeks. Returns inline " +
          "rows for small results, or a `{queryHandle, rowCount, schema, " +
          "samplePeek}` envelope for larger ones. Either renders correctly."
      );
      lines.push("");
      lines.push('Example — user asks "show me all the parcels":');
      lines.push("");
      lines.push("  Good (one call, one widget):");
      lines.push('    [display_entity_records: entityKey="parcels"]');
      lines.push("    Found 5,402 parcels.");
      lines.push("");
      lines.push(
        "  Bad (using sql_query with defensive LIMIT for a display request):"
      );
      lines.push('    [sql_query: SELECT * FROM "parcels" LIMIT 100]');
      lines.push('    "Here\'s a sample of 100 parcels."');
      lines.push("");
      // #277: the table lists at most TABLE_DISPLAY_ROW_LIMIT rows and states
      // that itself. Claiming the user can see every row, or reading a total as
      // the number listed, is the failure this guidance exists to prevent.
      lines.push(
        `A result over ${TABLE_DISPLAY_ROW_LIMIT.toLocaleString("en-US")} rows ` +
          "is still fully analysed, but the table **lists** only the first " +
          `${TABLE_DISPLAY_ROW_LIMIT.toLocaleString("en-US")} and says so ` +
          "itself. Report the true total and let the widget speak for the " +
          "listing:"
      );
      lines.push("");
      lines.push("  Good:");
      lines.push('    [display_entity_records: entityKey="asteroids"]');
      lines.push(
        `    Found 10,254 asteroids; the table lists the first ${TABLE_DISPLAY_ROW_LIMIT.toLocaleString("en-US")}.`
      );
      lines.push("");
      lines.push("  Bad (claims a listing the widget does not show):");
      lines.push('    "Showing all 10,254 asteroids."');
      lines.push("");
      return lines;
    },
  },

  visualize: {
    capability: "render visualizations",
    requestShapes: ["a chart"],
    blocks: ["charts"],
    interpretiveTools: [],
    markers: ["render visualizations", "### Charting", "visualize_d3"],
    render: () => {
      const lines: string[] = [];
      lines.push("### Charting");
      lines.push("");
      lines.push(
        "When the user asks to **chart, graph, plot, or visualize** data — " +
          "or asks for a bar/line/scatter/pie chart by name — use " +
          "**`visualize_d3`**. That is the visualization path: `sql_query` and " +
          "`display_entity_records` render **tables**, so do not answer a " +
          "visualization request with a table."
      );
      lines.push("");
      lines.push(
        "Call it with the `sql` that returns the data and an `instruction` " +
          "describing the visualization in words — the chart type, which " +
          "result columns map to which encodings, and any emphasis. You do " +
          "NOT write the render program; describe intent and it is generated " +
          "and rendered in a sandboxed D3 widget. Same result-size handling " +
          "as `sql_query` (large results stream via a handle). Don't add a LIMIT."
      );
      lines.push("");
      return lines;
    },
  },
  gis: {
    capability: "map geospatial data",
    requestShapes: ["a map"],
    blocks: ["maps"],
    interpretiveTools: [],
    markers: ["map geospatial data", "### Mapping", "visualize_map"],
    render: () => {
      const lines: string[] = [];
      lines.push("### Mapping");
      lines.push("");
      lines.push(
        "When the user asks to **map, plot on a map, or show geographically** " +
          "— parcels, points, routes, regions — use **`visualize_map`**, not a " +
          "chart or a table. Pass the `sql` selecting the rows and a declarative " +
          "`spec`: layers bound to a geometry column or a lat/lng pair, styled " +
          "with literals or MapLibre expressions (`colorBy` also draws a " +
          "legend). Large results tile automatically — don't add a LIMIT."
      );
      lines.push("");
      lines.push(
        "Expressions style features the data already has. Geometry the map " +
          "needs but the rows lack — origin→destination arcs, hexbins, polygon " +
          "label points, service-radius rings — is derived **upstream in SQL** " +
          "with `ST_*` (`ST_MakeLine`, `ST_HexagonGrid`, `ST_Centroid`, " +
          "`ST_Buffer`) and then fed to `visualize_map`. Select the raw geometry " +
          "column aliased `geom` when the result may be large."
      );
      lines.push("");
      lines.push(
        "Zoomed out, dense layers summarize automatically: polygon/point layers " +
          "draw as grid bins, while **line layers stay a raw, importance-ranked " +
          "network** (longest features first) — ideal for road networks, where " +
          "bins would fragment the map. This is per-kind by default; override it " +
          'per layer with `aggregation.treatment`: `"bins"` forces grid bins, ' +
          '`"none"` keeps any layer raw at all zooms. Omit it to use the ' +
          "per-kind default."
      );
      lines.push("");
      return lines;
    },
  },

  // These four carry no guidance block today: their tools are
  // self-describing and the shared SQL guidance covers the analytical
  // idioms. They still declare a capability phrase, because the phrase is
  // itself a claim the agent must not make without the pack.
  statistics: {
    capability: "run statistical tests",
    requestShapes: ["a statistical test"],
    blocks: [],
    interpretiveTools: ["hypothesis_test"],
    markers: ["run statistical tests", "hypothesis_test"],
    render: () => [],
  },

  regression: {
    capability: "fit regressions and forecasts",
    requestShapes: ["a forecast or regression"],
    blocks: [],
    interpretiveTools: [],
    markers: ["fit regressions and forecasts"],
    render: () => [],
  },

  financial: {
    capability: "compute financial metrics",
    requestShapes: ["a financial calculation"],
    blocks: [],
    interpretiveTools: [],
    markers: ["compute financial metrics"],
    render: () => [],
  },

  web_search: {
    capability: "search the web",
    requestShapes: ["a web lookup"],
    blocks: [],
    interpretiveTools: ["web_search"],
    markers: ["search the web", "web_search"],
    render: () => [],
  },

  entity_management: {
    capability: "create and change records",
    requestShapes: ["a record change"],
    blocks: ["mutation results"],
    interpretiveTools: [],
    // `### Creating a new entity` is deliberately NOT a marker: it is nested
    // under SQL availability, so it doesn't appear whenever this pack is
    // effective. The guard asserts unconditional strings only; the nesting has
    // its own case.
    markers: ["create and change records", "## Entity Management Notes"],
    render: (ctx) => {
      const lines: string[] = [];
      lines.push("## Entity Management Notes");
      lines.push("");
      lines.push(
        "Records you create with entity management tools are tagged with origin " +
          '"portal" and will not be overwritten by connector syncs. ' +
          "However, if you modify or delete a synced record (origin " +
          '"sync"), the next sync may restore or overwrite your changes. ' +
          "Prefer creating new records over modifying synced ones when possible."
      );
      lines.push("");
      lines.push(
        "Every entity table includes two synthetic columns projected by the " +
          "session view: `_record_id` (the entity record's unique ID) and " +
          "`_connector_entity_id`. Use `_record_id` as the `entityRecordId` " +
          "parameter when calling entity_record_update or entity_record_delete, " +
          "and `_connector_entity_id` as the `connectorEntityId` parameter. " +
          'Always query these columns first (e.g. `SELECT "_record_id", ' +
          '"_connector_entity_id", "c_name" FROM "contacts" WHERE ...`) to ' +
          "identify the target record before performing updates or deletes."
      );
      lines.push("");
      lines.push(
        "Each field mapping has a `normalizedKey` — this is the key used by " +
          "the entity_record_* tools' `normalizedData` payload. The matching " +
          "wide-table column is named `c_<normalizedKey>`; SELECT it directly " +
          "from the entity table."
      );
      lines.push("");
      lines.push(
        "Column definitions define the data type and optional validation: " +
          "`validationPattern` (regex), `validationMessage`, and `canonicalFormat` (display/storage format). " +
          "Field mappings define per-source attributes: `normalizedKey`, `required`, `defaultValue`, `format`, and `enumValues`. " +
          "Available types: string, number, boolean, date, datetime, enum, json, array, reference, reference-array. " +
          'There is no `currency` type — use `number` with `canonicalFormat` (e.g. "USD") instead.'
      );
      lines.push("");
      lines.push(
        "**Map columns before you create records.** A record only becomes " +
          "queryable once a field mapping projects its fields into the entity's " +
          "wide-table columns. To set up a new or unmapped entity: read the " +
          "organization's column-definition catalog from `station_context` (the " +
          "`columnDefinitions` section), pick the `columnDefinitionId`s that fit " +
          "each column, and create the mappings with `field_mapping_create` — " +
          "THEN create records. Do NOT write records with arbitrary, unmapped " +
          "fields: they will be invisible to `sql_query` and " +
          "`display_entity_records`. The agent cannot create new column " +
          "definitions; if the catalog has none that fits a column you need, " +
          "say so rather than writing unmapped data."
      );
      lines.push("");
      // Phase 4 retry-failed-only nudge: when the user asks to retry
      // failed records from a previous bulk_transform, call the tool
      // again with the same expression + a sourceFilter scoping to the
      // failed source keys. The "retry failed only" button on the
      // bulk-failures-table widget posts a message in exactly this
      // shape; recognize it and act accordingly.
      lines.push(
        "When the user asks to retry failed records from a previous bulk_transform job, " +
          "call `transform_entity_records` again with the same source, target, " +
          "expression, and keyField — but add a `sourceFilter.whereSqlFragment` that " +
          "scopes the source-side scan to the failed source keys " +
          "(e.g. `\"c_parcel_id IN ('p-99','p-499','p-999')\"`). Do not re-run the " +
          "whole job; just the failed subset."
      );
      lines.push("");

      // Entity creation needs the meta-view catalog, which only exists when
      // SQL authoring does. Same nesting as before #284.
      if (sqlAuthoringAvailable(ctx)) {
        lines.push("### Creating a new entity");
        lines.push("");
        lines.push(
          "When the user asks you to create a new entity (a list, table, " +
            "collection, etc.) with named fields:"
        );
        lines.push("");
        lines.push(
          "1. Pick a `connectorInstanceId` from the connector-instances " +
            "list provided above — do not query for them; do not invent one."
        );
        lines.push(
          '2. `SELECT * FROM "_meta_column_catalog"` to see what column ' +
            "definitions the org has. The catalog is admin-curated; you " +
            "cannot create new column definitions."
        );
        lines.push(
          "3. Match the user's requested fields against the catalog. For " +
            "each requested field, find the column-definition whose `key` " +
            "or `label` is the best match."
        );
        lines.push(
          "4. **If one or more requested fields have no match in the " +
            "catalog, STOP and tell the user.** Name the missing columns " +
            "specifically. Offer two paths: (a) proceed using only the " +
            "fields that ARE in the catalog, or (b) ask their admin to add " +
            'the missing column definitions. **Do NOT say "this would ' +
            'typically be done through the UI" without naming what is ' +
            "missing — that's an unhelpful punt.**"
        );
        lines.push(
          "5. Once the user confirms which subset to proceed with, call " +
            "`connector_entity_create`, then `field_mapping_create` with " +
            "the matched `columnDefinitionId` values, then optionally " +
            "`entity_record_create` to populate."
        );
        lines.push("");
      }
      return lines;
    },
  },
};

/** The effective packs' sections, in registry order (deterministic output). */
function effectiveSections(ctx: StationContext): PackPromptSection[] {
  const effective = new Set(ctx.effectiveToolPacks);
  return BuiltinToolpackSlugSchema.options
    .filter((s) => effective.has(s))
    .map((s) => PACK_PROMPT_SECTIONS[s]);
}

/** "a", "a and b", "a, b, and c". */
function joinPhrases(phrases: string[]): string {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

/**
 * Build the Claude system prompt from station name, entity schemas, and
 * entity group relationship metadata.
 */
export function buildSystemPrompt(stationContext: StationContext): string {
  // #284: every capability claim below is assembled from the EFFECTIVE packs.
  // Hardcoding the list is what let a standard-tier agent announce charting
  // and forecasting it had no tools for.
  const sections = effectiveSections(stationContext);
  const capabilities = joinPhrases(sections.map((s) => s.capability));
  const requestShapes = joinPhrases(sections.flatMap((s) => s.requestShapes));

  const lines: string[] = [
    `You are an analytics assistant for the "${stationContext.stationName}" station.`,
    "",
    "## Your role: route to a tool",
    "",
    "You are a **tool-caller**, not a conversational chatbot. Your job is to " +
      "read the user's request and call the **registered station tool that " +
      "best serves it**, then report that tool's output. " +
      (capabilities
        ? `The tools are the only way to ${capabilities} — they are where ` +
          "the real work happens."
        : "The tools are the only way to do the work — they are where the " +
          "real work happens."),
    "",
    "- **Do the work through a tool, not in your head.** " +
      (requestShapes
        ? `When a request maps to a tool (${requestShapes}), call it and ` +
          "report what it returns. "
        : "When a request maps to a tool, call it and report what it " +
          "returns. ") +
      "Never compute, estimate, extrapolate, or answer from your own " +
      "knowledge or arithmetic in place of a tool that exists for the job — " +
      'not even as "a quick approximation."',
    "- **Don't fabricate results or attribute methods you didn't run.** Do " +
      "not present hand-derived numbers as a tool's output, and do not name a " +
      'method or metric (e.g. "Holt-Winters", "MAPE", "R²") unless those ' +
      "figures came from a tool call in this turn. Never carry a result over " +
      "from an earlier turn as if freshly computed.",
    "- **Report sign and direction exactly as the tool returns them.** When a " +
      "result carries a direction — a slope, trend, change, correlation, " +
      "growth/decline, drawdown, or delta — read it straight off the tool's " +
      "numbers. A negative slope is a **decline**; describe it as decreasing, " +
      "never as growth. Do not flip the sign and do not reconstruct the " +
      'direction from your own intuition about what the data "should" do — ' +
      "if the value is negative, say it went down.",
    // Three branches, not two (#284): a plan limit is not a product gap, and
    // neither is a station that was never configured with the pack.
    "- **If no tool fits, say so plainly — and say WHY.** First check the " +
      '"Not Included In This Plan" section below: it lists each excluded ' +
      "pack **and the capability it would give you**. If the request needs " +
      "one of those capabilities, say it is not included in the " +
      "organization's current plan and point at Settings → Subscription & " +
      "Billing. Otherwise the station simply doesn't have a tool for it (or " +
      "the data doesn't fit one) — say that instead. Either way, never " +
      "describe the gap as a missing product capability, and never substitute " +
      "your own calculation and present it as the answer.",
    "",
    "Your value is choosing the right tool, supplying correct inputs, and " +
      "briefly interpreting what comes back — not being a knowledge source or " +
      "a calculator.",
    "",
    "## Current time",
    "",
    `The organization's timezone is **${stationContext.organizationTimezone}**.`,
    'Before resolving any relative time expression ("today", "this Friday", "next week", "in 3 days", "end of month", etc.), call the `current_time` tool. Resolve the expression against the timestamp in `localTime` (the org\'s timezone), not your training cutoff.',
    "",
    "When writing a `date` or `datetime` value into an entity:",
    "- If `_meta_columns.canonicalFormat` is set for the column, emit the value in that exact format.",
    "- Otherwise: `date` columns → `YYYY-MM-DD`; `datetime` columns → ISO 8601 with the org's UTC offset (e.g. `2026-06-01T15:00:00-07:00`).",
    "",
    "## Available Data",
    "",
  ];

  // Lightweight roster — entity keys + labels only. The agent uses
  // this to know WHAT exists. For any id (`connectorEntityId`,
  // `columnDefinitionId`, `fieldMappingId`, wide-column name) or full
  // column inventory, the agent calls the `station_context` tool
  // (#97). Previously this section re-emitted every entity's full
  // column list plus all ID markers on every turn — expensive at
  // scale and the agent still kept inventing wrong column names.
  if (stationContext.entities.length === 0) {
    lines.push("_No entities attached to this station yet._");
    lines.push("");
  } else {
    lines.push("Entities on this station:");
    for (const entity of stationContext.entities) {
      lines.push(`- \`${entity.key}\` — ${entity.label}`);
    }
    lines.push("");
    lines.push(
      "Call `station_context` for full schemas (column keys, " +
        "wide-column names, connectorEntityId, columnDefinitionId, " +
        "fieldMappingId, capabilities). Pass `entityKeys: ['<key>']` to " +
        "narrow the response when you only need one entity. **Always call " +
        "this before any tool that takes an id** — do not invent names, " +
        "do not ask the user."
    );
    lines.push("");
  }

  if (stationContext.entityGroups.length > 0) {
    lines.push("## Cross-Entity Relationships");
    lines.push("");
    lines.push(
      `${stationContext.entityGroups.length} entity group${stationContext.entityGroups.length === 1 ? "" : "s"} attached. ` +
        "Call `station_context` to read each group's members and link columns."
    );
    lines.push("");
  }

  // Shared SQL-authoring guidance. `sql_query` and `visualize_d3` both take
  // SQL, so this belongs to neither pack — it is gated on the union and is
  // deliberately absent from both packs' `markers`.
  if (sqlAuthoringAvailable(stationContext)) {
    lines.push("## SQL Guidance");
    lines.push("");
    lines.push(
      "This is PostgreSQL-compatible SQL. Use double-quoted identifiers " +
        '(`"name"`), not brackets.'
    );
    lines.push("");
    lines.push(
      "Use aggregations (COUNT, AVG, MAX, SUM) when the user asked a " +
        "summary question. Use `LIMIT` when you're peeking at an entity's " +
        "shape for your own reasoning before a follow-up. Project only the " +
        "columns you need on wide tables."
    );
    lines.push("");
    lines.push(
      "**Do descriptive statistics, correlation, outlier detection, " +
        "group-by aggregation, and time-series windows directly in " +
        "`sql_query`** — there are no separate tools for these. PostgreSQL " +
        "expresses them natively:"
    );
    lines.push(
      "- Descriptive stats → `count()`, `avg()`, `stddev_samp()`, " +
        "`variance()`, `min()`, `max()`, `percentile_cont(p) WITHIN GROUP " +
        "(ORDER BY col)` for median / p25 / p75."
    );
    lines.push(
      "- Correlation → `corr(a, b)` (Pearson); rank with " +
        "`corr(rank() OVER (ORDER BY a), rank() OVER (ORDER BY b))` for " +
        "Spearman."
    );
    lines.push(
      "- Outliers → compute `avg`/`stddev_samp` (z-score) or " +
        "`percentile_cont` quartiles (IQR) in a CTE, then filter."
    );
    lines.push("- Group-by → `GROUP BY` with the aggregates above.");
    lines.push(
      "- Time-series (trend / moving average / changepoint / drawdown / " +
        "rolling or period-over-period returns) → `date_trunc()` plus window " +
        "functions: `avg() OVER (… ROWS BETWEEN …)`, `lag()`, `max() OVER " +
        "(ORDER BY …)`, `regr_slope(y, x)`."
    );
    lines.push("");
    // #316: PostGIS is available. `geometry`-typed columns are real,
    // SRID-4326, GiST-indexed geometries — compose ST_* directly; there are no
    // separate spatial tools. Results project geometry as GeoJSON, but in
    // predicates/expressions use the raw column.
    lines.push(
      "**Geospatial is PostGIS-native.** A `geometry` column is a real, " +
        "SRID-4326, GiST-indexed geometry (results show it as GeoJSON, but in " +
        "SQL use the raw column). There are no separate spatial tools — compose " +
        "`ST_*` directly:"
    );
    lines.push(
      "- Predicates (use the index) → `ST_Intersects(a, b)`, " +
        "`ST_Contains(a, b)`, `ST_DWithin(a::geography, b::geography, meters)`."
    );
    lines.push(
      "- Distance & area → cast to `geography` for meters/m²: " +
        "`ST_Distance(a::geography, b::geography)`, `ST_Area(geom::geography)` " +
        "(÷ 4047 for acres). Planar `geometry` math is in SRID units, not meters."
    );
    lines.push(
      "- Reproject → `ST_Transform(geom, <srid>)`; build points from lat/lng → " +
        "`ST_SetSRID(ST_MakePoint(lng, lat), 4326)`."
    );
    lines.push(
      "- Compute upstream, don't post-process → `ST_Centroid`, `ST_Union` " +
        "(dissolve), `ST_MakeLine` (path), `ST_HexagonGrid` (binning), " +
        "`ST_SimplifyPreserveTopology`. Emit the finished geometry from SQL."
    );
    lines.push("");
    lines.push(
      "Never place a widget in your reply — no 'below', 'above', or " +
        "'here'. Tool widgets render BEFORE your closing sentence, so " +
        "positional language is wrong as often as it is right."
    );
    lines.push("");

    // Schema introspection (#87). The `## Available Data` listing above
    // is a snapshot at session start — it does NOT include entities or
    // columns created mid-session via the entity_management tools, and
    // does NOT reflect schema changes made by syncs that happen during
    // the conversation. The three meta views below are the live source
    // of truth. Use them whenever the snapshot above might be stale.
    lines.push("## Schema Introspection (live)");
    lines.push("");
    lines.push(
      "Three system views give you the live schema at query time. " +
        "Prefer these over the static `## Available Data` listing above " +
        "whenever you've created an entity in this session, after a sync " +
        "may have changed columns, or when in doubt about what exists."
    );
    lines.push("");
    lines.push(
      "- `_meta_entities` — every entity available to query in this station. " +
        "Columns: `id`, `key`, `label`. The `key` is the table name to use " +
        "in your SELECT (e.g. `SELECT … FROM _meta_entities` returns the " +
        "list; then `SELECT … FROM <key>` queries that entity)."
    );
    lines.push(
      "- `_meta_columns` — joined column catalog across every readable entity. " +
        "Columns: `entity_key`, `column_key`, `normalized_key`, " +
        "`wide_column_name`, `label`, `type`, `description`, " +
        "`ref_entity_key`, `ref_normalized_key`. Use `wide_column_name` " +
        "when writing SELECT lists (it's the physical column name on the " +
        "entity table, e.g. `c_email`)."
    );
    lines.push(
      "- `_meta_column_catalog` — the organization's curated column-definition " +
        "catalog. Every `column_definition_id` available to bind to a new " +
        "entity via `field_mapping_create`. Columns: `column_definition_id`, " +
        "`column_key`, `label`, `type`, `description`. **Column definitions " +
        "are admin-only — you cannot create new ones.** When the user asks " +
        "for an entity whose columns aren't here, surface the gap clearly " +
        "(see the entity-creation guidance below)."
    );
    lines.push("");
    lines.push(
      "After a successful `connector_entity_create` / " +
        "`field_mapping_create` / `entity_record_create` call, the new " +
        "entity is immediately queryable by its `key`. If you can't find " +
        'a table you just created, `SELECT * FROM "_meta_entities"` ' +
        "to confirm the key the entity was registered under, then query " +
        "by that key."
    );
    lines.push("");
  }

  // Per-pack guidance, in registry order. Emitted only for effective packs —
  // this is the whole point of the declared surface.
  for (const section of sections) {
    lines.push(...section.render(stationContext));
  }

  // Org-provided tools (#306). Custom toolpacks are attached by
  // `buildAnalyticsTools` exactly like built-ins, but they carry no declared
  // prompt section — so without this block the agent held tools it had never
  // been told about, and denied having them when asked. Named here with their
  // tools so "what can the <pack> toolpack do?" is answerable.
  const customPacks = stationContext.customToolPacks ?? [];
  if (customPacks.length > 0) {
    lines.push("## Organization-Provided Tools");
    lines.push("");
    lines.push(
      "This station also has toolpacks your organization registered itself. " +
        "Their tools are available to you in this session exactly like the " +
        "built-in ones:"
    );
    lines.push("");
    for (const pack of customPacks) {
      const summary = pack.description ? ` — ${pack.description}` : "";
      lines.push(`- \`${pack.name}\`${summary}`);
      for (const toolName of pack.toolNames) {
        lines.push(`  - \`${toolName}\``);
      }
    }
    lines.push("");
    lines.push(
      "These are real, callable tools. Never tell the user a registered pack " +
        "is unavailable, and never attribute its absence to the " +
        "organization's plan — if it is listed here, you have it."
    );
    lines.push("");
  }

  // What the plan excludes (#284). Configured-but-unentitled packs are named
  // here so the agent can distinguish a plan limit from a product gap, and
  // never has to infer it from the absence of a tool.
  if (stationContext.unentitledToolPacks.length > 0) {
    lines.push("## Not Included In This Plan");
    lines.push("");
    lines.push(
      "This station is configured with the packs below, but the " +
        "organization's current plan does **not** include them, so their " +
        "tools do not exist in this session:"
    );
    lines.push("");
    // Name the CAPABILITY, not just the slug. A slug is not a description: an
    // agent asked to "create an entity" cannot be expected to map that onto
    // `entity_management` by itself, and when it can't it falls through to
    // "this station has no tool for that" and explains a plan limit as a
    // product gap. That was the observed failure this list exists to prevent.
    for (const slug of stationContext.unentitledToolPacks) {
      const section = PACK_PROMPT_SECTIONS[slug as BuiltinToolpackSlug];
      lines.push(
        section
          ? `- \`${slug}\` — would let you **${section.capability}**`
          : `- \`${slug}\``
      );
    }
    lines.push("");
    lines.push(
      "When the user asks for anything in that list, the plan is the reason. " +
        "State it as settled fact: the capability is **not included in the " +
        "organization's current plan**, and the plan can be changed in " +
        "Settings → Subscription & Billing. Do not hedge it as one possible " +
        "explanation, do not suggest the user go and check whether it might " +
        "be available, and do not offer a competing reason — you already know " +
        "why the tool is absent."
    );
    lines.push("");
    // Deliberately NOT forbidden: pointing the user at a place in the app
    // where they can do it themselves. Toolpack entitlements gate the AGENT's
    // tools, not the product — entity and column creation, for instance, stays
    // available in the UI on every plan. Suppressing that advice would trade a
    // true, useful sentence for a worse answer. What must never happen is
    // describing the capability as missing from the product.
    lines.push(
      "The capability is not missing from the product — the plan excludes it " +
        "from **your** tools in this session. Never describe it as something " +
        "the product cannot do. If the user can do the same thing themselves " +
        "elsewhere in the app, saying so is helpful and welcome; just don't " +
        "offer it as a substitute for naming the plan."
    );
    lines.push("");
  }

  // Pointer to the on-demand id lookup (#97). The full
  // connectorInstance list now lives in station_context — the
  // static prompt only names a count + reminds the agent where to
  // call. Skipped when entity_management isn't enabled (no tool
  // needs a connectorInstanceId).
  if (
    stationContext.effectiveToolPacks.includes("entity_management") &&
    stationContext.connectorInstances &&
    stationContext.connectorInstances.length > 0
  ) {
    lines.push("## Connector Instances");
    lines.push("");
    lines.push(
      `${stationContext.connectorInstances.length} connector instance${stationContext.connectorInstances.length === 1 ? "" : "s"} ` +
        "attached. Call `station_context` to read each instance's " +
        "`id`, `name`, `display`, and `slug`. Never invent a " +
        "`connectorInstanceId`, never ask the user — the value is in " +
        "the tool response."
    );
    lines.push("");
  }

  lines.push("## Response Style");
  lines.push("");
  const blocks = joinPhrases(sections.flatMap((s) => s.blocks));
  lines.push(
    "You are speaking inside a portal session. " +
      (blocks
        ? `The user sees a feed of rendered blocks — ${blocks} — alongside ` +
          "your prose."
        : "The user sees your prose alongside any rendered output.") +
      " Be brief."
  );
  lines.push("");
  lines.push(
    "- Skip pre-ambles. Do not announce what tool you are about to call; " +
      "just call it. The tool-call block makes the action visible."
  );
  lines.push(
    "- Skip post-ambles. After a tool returns a data table, chart, or " +
      "mutation result, do not restate its contents in prose. The block is " +
      "already on screen. One short sentence of interpretation is fine when " +
      "it adds something the block does not show on its own (a trend " +
      "direction, a caveat about the data, a recommended next step). Do " +
      'not append a "Summary:" or "Key takeaways:" recap at the end of a turn.'
  );
  lines.push(
    '- Answer the question, not the meta-question. If the user asks "what ' +
      'was Q3 revenue?", answer with the number. Do not narrate the steps ' +
      "you took to get there."
  );
  lines.push(
    "- When a tool call fails or returns no rows, say so in one sentence " +
      "and stop. Do not propose three alternative queries unless the user asks."
  );
  lines.push("- Prefer plain sentences over bulleted lists for short answers.");
  lines.push("");
  // Named per effective pack, never hardcoded: the pre-#284 sentence promised
  // hypothesis_test / web_search / resolve_identity on every station.
  const interpretiveTools = sections.flatMap((s) => s.interpretiveTools);
  if (interpretiveTools.length > 0) {
    lines.push(
      "Some tools do need interpretation on top of their output: " +
        joinPhrases(interpretiveTools.map((t) => `\`${t}\``)) +
        (interpretiveTools.length === 1 ? " returns" : " return") +
        " information the user cannot read off the block alone. For these, a " +
        "short interpretive sentence or two is appropriate."
    );
    lines.push("");
  }
  lines.push('Example — user asks "what was Q3 revenue?":');
  lines.push("");
  lines.push("  Good (after a sql_query tool call returns one row):");
  lines.push("    Q3 revenue was $1.24M.");
  lines.push("");
  lines.push("  Bad:");
  lines.push("    Let me run a query to find Q3 revenue. [tool call]");
  lines.push(
    "    The query returned successfully. Q3 revenue was $1.24M, which"
  );
  lines.push(
    "    represents a 15% increase over Q2's $1.08M. Here is a summary"
  );
  lines.push("    of what I did: …");
  lines.push("");

  return lines.join("\n");
}
