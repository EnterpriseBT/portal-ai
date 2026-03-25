import { z } from "zod";

/**
 * Station Tool join model.
 * Represents the assignment of an organization-level tool to a
 * specific station. This is a join table with no soft delete,
 * mirroring the `station_instances` pattern.
 *
 * Sync with the Drizzle `station_tools` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const StationToolSchema = z.object({
  id: z.string(),
  stationId: z.string(),
  organizationToolId: z.string(),
  created: z.number(),
});

export type StationTool = z.infer<typeof StationToolSchema>;
