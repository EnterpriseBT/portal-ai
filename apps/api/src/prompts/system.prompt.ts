import type {
  EntitySchema,
  EntityGroupContext,
} from "../services/analytics.service.js";
import type { ResolvedCapabilities } from "../utils/resolve-capabilities.util.js";

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
  toolPacks: string[];
  entityCapabilities?: Record<string, ResolvedCapabilities>;
  /** Attached connector instances; rendered when the entity_management
   *  pack is enabled so the agent knows what to pass for
   *  `connectorInstanceId`. Empty array is fine (no entity-mgmt tool
   *  call possible). */
  connectorInstances?: ConnectorInstanceContext[];
}

/**
 * Build the Claude system prompt from station name, entity schemas, and
 * entity group relationship metadata.
 */
export function buildSystemPrompt(stationContext: StationContext): string {
  const lines: string[] = [
    `You are an analytics assistant for the "${stationContext.stationName}" station.`,
    "",
    "## Available Data",
    "",
  ];

  for (const entity of stationContext.entities) {
    let heading = `### ${entity.label} (\`${entity.key}\`)`;
    if (stationContext.toolPacks.includes("entity_management")) {
      heading += ` [connectorEntityId: ${entity.id}]`;
    }
    if (stationContext.entityCapabilities) {
      const caps = stationContext.entityCapabilities[entity.id];
      if (caps) {
        const flags = caps.write ? "[read, write]" : "[read]";
        heading += ` ${flags}`;
      }
    }
    lines.push(heading);
    lines.push("Columns:");
    const hasEntityMgmt =
      stationContext.toolPacks.includes("entity_management");
    for (const col of entity.columns) {
      let line = `  - \`${col.key}\` (${col.type}): ${col.label}`;
      if (hasEntityMgmt) {
        line += ` [columnDefinitionId: ${col.columnDefinitionId}, fieldMappingId: ${col.fieldMappingId}, sourceField: "${col.sourceField}"]`;
      }
      lines.push(line);
    }
    lines.push("");
  }

  if (stationContext.entityGroups.length > 0) {
    lines.push("## Cross-Entity Relationships");
    lines.push("");
    lines.push(
      "Use the specified link columns when joining across member entities. " +
        "Prefer data from the primary entity when displaying a unified view."
    );
    lines.push("");

    for (const group of stationContext.entityGroups) {
      lines.push(`### ${group.name}`);
      lines.push("Members:");
      for (const member of group.members) {
        const primaryFlag = member.isPrimary ? " [primary]" : "";
        lines.push(
          `  - \`${member.entityKey}\` — link column: \`${member.linkColumnKey}\` (${member.linkColumnLabel})${primaryFlag}`
        );
      }
      lines.push("");
    }
  }

  if (stationContext.toolPacks.includes("entity_management")) {
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
  }

  // SQL guidance — applies whenever the LLM can reach `sql_query` /
  // `visualize` / `visualize_tree`. The new session-view surface is
  // PostgreSQL-compatible, has a 500-row response cap, and uses
  // double-quoted identifiers (not AlaSQL's `[…]`).
  if (stationContext.toolPacks.includes("data_query")) {
    lines.push("## SQL Guidance");
    lines.push("");
    lines.push("This is PostgreSQL-compatible SQL. Specifically:");
    lines.push(
      "- Always include a LIMIT clause when scanning rows for exploratory work."
    );
    lines.push(
      '- Avoid `SELECT *` on entity tables — project only the columns you need.'
    );
    lines.push(
      "- Prefer aggregations (COUNT, AVG, MAX, SUM) over scanning rows when the " +
        "user is asking summary questions."
    );
    lines.push(
      "- Responses cap at 500 rows. If you see `truncated: true` in the response, " +
        "narrow your filter or aggregate instead of paging."
    );
    lines.push(
      '- Quote identifiers with double quotes (`"name"`), not brackets.'
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
      '- `_meta_entities` — every entity available to query in this station. ' +
        "Columns: `id`, `key`, `label`. The `key` is the table name to use " +
        "in your SELECT (e.g. `SELECT … FROM _meta_entities` returns the " +
        "list; then `SELECT … FROM <key>` queries that entity)."
    );
    lines.push(
      '- `_meta_columns` — joined column catalog across every readable entity. ' +
        "Columns: `entity_key`, `column_key`, `normalized_key`, " +
        "`wide_column_name`, `label`, `type`, `description`, " +
        "`ref_entity_key`, `ref_normalized_key`. Use `wide_column_name` " +
        "when writing SELECT lists (it's the physical column name on the " +
        "entity table, e.g. `c_email`)."
    );
    lines.push(
      '- `_meta_column_catalog` — the organization\'s curated column-definition ' +
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

    if (stationContext.toolPacks.includes("entity_management")) {
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
  }

  // ## Available Connector Instances — listed once at session start
  // because connector-instance configuration is static for the
  // lifetime of a portal session. The agent uses this for any tool
  // call that takes a `connectorInstanceId` (today: connector_entity_create).
  //
  // Skipped when entity_management isn't enabled — no tool would
  // accept the id, no reason to enumerate.
  if (
    stationContext.toolPacks.includes("entity_management") &&
    stationContext.connectorInstances &&
    stationContext.connectorInstances.length > 0
  ) {
    lines.push("## Available Connector Instances");
    lines.push("");
    lines.push(
      "Pass one of the `id` values below when a tool asks for a " +
        "`connectorInstanceId`. These are the only valid choices for this " +
        "station — do not invent one, do not pass an `entityId` here. The " +
        "list is static for this session."
    );
    lines.push("");
    for (const inst of stationContext.connectorInstances) {
      lines.push(
        `- \`${inst.id}\` — ${inst.name} (${inst.display}, slug: ${inst.slug})`
      );
    }
    lines.push("");
  }

  lines.push("## Response Style");
  lines.push("");
  lines.push(
    "You are speaking inside a portal session. The user sees a feed of " +
      "rendered blocks — data tables, charts, and mutation results — alongside " +
      "your prose. Be brief."
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
  lines.push(
    "- Prefer plain sentences over bulleted lists for short answers."
  );
  lines.push("");
  lines.push(
    "Some tools do need interpretation on top of their output: " +
      "`describe_column`, `web_search`, and `resolve_identity` return " +
      "information the user cannot read off the block alone. For these, a " +
      "short interpretive sentence or two is appropriate."
  );
  lines.push("");
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
