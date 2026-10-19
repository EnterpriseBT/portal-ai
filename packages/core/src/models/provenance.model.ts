import { z } from "zod";

/**
 * #641: the portal whose agent session created a row, or null. Written once at
 * creation and **provenance only**: ownership is `createdBy` (the prompting
 * user), and no permission check, visibility predicate or capability reads
 * this. Defaults to null, so a creation path that never heard of it (REST,
 * import, seeds) stays valid.
 */
export const SourcePortalIdSchema = z.string().nullable().default(null);

/**
 * #641: whether an object was produced in a portal (agent) session. A record
 * the agent created before #641 has no `sourcePortalId` but carries
 * `origin: "portal"`, so it still counts.
 */
export function isSessionGenerated(row: {
  sourcePortalId?: string | null;
  origin?: string;
}): boolean {
  return Boolean(row.sourcePortalId) || row.origin === "portal";
}
