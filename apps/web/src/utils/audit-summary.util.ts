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
    if (field === "defaultStationId")
      return defaultStationSummary(entry.metadata ?? {});
  }
  return null;
}

const isStationId = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

/** #935: the stations are named as they were when the change was recorded;
 *  an entry without a name says "a deleted station". */
function defaultStationSummary(
  metadata: Record<string, unknown>
): string | null {
  const { from, to, fromName, toName } = metadata;
  if (!isStationId(from) || !isStationId(to) || from === to) return null;
  const named = (name: unknown) =>
    typeof name === "string" ? `"${name}"` : "a deleted station";
  if (from === null) return `Default station set to ${named(toName)}`;
  if (to === null) return `Default station cleared (was ${named(fromName)})`;
  return `Default station changed from ${named(fromName)} to ${named(toName)}`;
}
