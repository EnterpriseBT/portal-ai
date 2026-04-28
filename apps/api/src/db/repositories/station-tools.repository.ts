/**
 * Repository for the `station_tools` join table.
 *
 * Assigns organization-level tools to stations. Returns joined
 * organization tool definitions for list queries.
 */

import { eq } from "drizzle-orm";

import { stationTools, organizationTools } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  StationToolSelect,
  StationToolInsert,
  OrganizationToolSelect,
} from "../schema/zod.js";

/** A station tool assignment with the full organization tool definition attached. */
export interface StationToolWithDefinition extends StationToolSelect {
  organizationTool: OrganizationToolSelect;
}

export class StationToolsRepository extends Repository<
  typeof stationTools,
  StationToolSelect,
  StationToolInsert
> {
  constructor() {
    super(stationTools);
  }

  /**
   * Return all tool assignments for a station, with the full
   * organization tool definition joined.
   */
  async findByStationId(
    stationId: string,
    client: DbClient = db
  ): Promise<StationToolWithDefinition[]> {
    const rows = await (client as typeof db)
      .select()
      .from(stationTools)
      .innerJoin(
        organizationTools,
        eq(stationTools.organizationToolId, organizationTools.id)
      )
      .where(eq(stationTools.stationId, stationId));

    return rows.map((r) => ({
      ...(r.station_tools as StationToolSelect),
      organizationTool: r.organization_tools as OrganizationToolSelect,
    }));
  }
}

/** Singleton instance. */
export const stationToolsRepo = new StationToolsRepository();
