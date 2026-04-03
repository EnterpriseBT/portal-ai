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
    if (stationContext.entityCapabilities) {
      const caps = stationContext.entityCapabilities[entity.id];
      if (caps) {
        const flags = caps.write ? "[read, write]" : "[read]";
        heading += ` ${flags}`;
      }
    }
    lines.push(heading);
    lines.push("Columns:");
    for (const col of entity.columns) {
      lines.push(`  - \`${col.key}\` (${col.type}): ${col.label}`);
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
  }

  return lines.join("\n");
}
