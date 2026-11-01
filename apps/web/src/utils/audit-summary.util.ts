import type { AuditLogEntry } from "@portalai/core/models";

/**
 * A one-line, human summary of an audit entry's metadata, shown under its
 * action in Settings → Activity (#907). Only actions whose metadata reads well
 * as a sentence get one; every other entry returns `null` and shows the action
 * alone, so metadata never reaches the screen unvetted.
 */
export function auditActionSummary(
  entry: Pick<AuditLogEntry, "action" | "metadata">
): string | null {
  if (entry.action === "org.update") {
    const { field, from, to } = entry.metadata ?? {};
    if (field === "name" && typeof from === "string" && typeof to === "string")
      return `Renamed from "${from}" to "${to}"`;
  }
  return null;
}
