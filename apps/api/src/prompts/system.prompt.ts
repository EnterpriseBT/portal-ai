import type {
  EntitySchema,
  EntityGroupContext,
} from "../services/analytics.service.js";

export interface StationContext {
  stationId: string;
  stationName: string;
  entities: EntitySchema[];
  entityGroups: EntityGroupContext[];
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
    lines.push(`### ${entity.label} (\`${entity.key}\`)`);
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

  return lines.join("\n");
}
