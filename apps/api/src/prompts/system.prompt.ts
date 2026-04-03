import type {
  EntitySchema,
  EntityGroupContext,
} from "../services/analytics.service.js";
import type { ResolvedCapabilities } from "../utils/resolve-capabilities.util.js";

export interface StationContext {
  stationId: string;
  stationName: string;
  entities: EntitySchema[];
  entityGroups: EntityGroupContext[];
  toolPacks: string[];
  entityCapabilities?: Record<string, ResolvedCapabilities>;
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
    const hasEntityMgmt = stationContext.toolPacks.includes("entity_management");
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
      "Metadata tables are available via sql_query: " +
      "`_connector_instances` (id, name, status, connector_definition_id), " +
      "`_connector_entities` (id, key, label, connector_instance_id), " +
      "`_column_definitions` (id, key, label, type, required, description), " +
      "`_field_mappings` (id, connector_entity_id, column_definition_id, source_field, is_primary_key). " +
      "Use these to look up IDs before calling write tools. " +
      "To add a new field mapping, either find an existing column definition " +
      "from `_column_definitions` or create one with column_definition_create, " +
      "then call field_mapping_create."
    );
    lines.push("");
  }

  return lines.join("\n");
}
