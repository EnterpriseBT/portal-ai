/**
 * #1036: reading stations for a caller — the one definition of "the stations
 * this caller can see", shared by `GET /api/stations` and the agent's
 * `station_list` tool so the two can't drift.
 */

import { and, eq, ilike, type SQL } from "drizzle-orm";

import type {
  ObjectCapabilities,
  ShareableObjectCapabilities,
} from "@portalai/core/contracts";

import { DbService } from "./db.service.js";
import { PermissionService } from "./permission.service.js";
import type { PermissionContext } from "./permission.service.js";
import { ObjectCapabilitiesService } from "./object-capabilities.service.js";
import type { PermissionSet } from "./permission-set.js";
import { stations } from "../db/schema/index.js";
import type { StationSelect } from "../db/schema/zod.js";

export interface StationListOptions {
  search?: string;
  limit: number;
  offset: number;
  sortBy: "name" | "created";
  sortOrder: "asc" | "desc";
}

export type StationListRow = StationSelect & {
  /** Built-in slugs, and custom packs as `org:<organizationToolpackId>`. */
  enabledToolpacks: string[];
  capabilities: ObjectCapabilities | ShareableObjectCapabilities;
};

export class StationQueryService {
  /**
   * The org's stations the caller can read (#621: the set's visibility
   * predicate), name-searched, ordered and paged, each with its enabled
   * toolpacks (one grouped read) and the caller's capabilities on it (#688).
   * Returns the loaded set so a caller can reuse it.
   */
  static async listForCaller(
    ctx: PermissionContext,
    opts: StationListOptions
  ): Promise<{
    set: PermissionSet;
    stations: StationListRow[];
    total: number;
  }> {
    const { limit, offset, sortBy, sortOrder, search } = opts;
    const filters: SQL[] = [eq(stations.organizationId, ctx.organizationId)];
    if (search) {
      filters.push(ilike(stations.name, `%${search}%`));
    }
    // #621: object-level visibility — AND the caller's read predicate (own +
    // system + shared) into the list. `undefined` = see-all (owner/admin).
    const set = await PermissionService.loadSet(ctx);
    const visibility = set.visibilityPredicate("station", {
      createdByCol: stations.createdBy,
      idCol: stations.id,
    });
    if (visibility) filters.push(visibility);
    const where = and(...filters);

    const column = sortBy === "name" ? stations.name : stations.created;
    const listOpts = {
      limit,
      offset,
      orderBy: { column, direction: sortOrder },
    };

    const [data, total] = await Promise.all([
      DbService.repository.stations.findMany(where, listOpts),
      DbService.repository.stations.count(where),
    ]);

    // Hydrate enabledToolpacks for each station via a single grouped lookup.
    const toolpackRows =
      await DbService.repository.stationToolpacks.findByStationIds(
        data.map((s) => s.id)
      );
    const toolpacksByStationId = new Map<string, string[]>();
    for (const row of toolpackRows) {
      const ref =
        row.builtinSlug !== null
          ? row.builtinSlug
          : row.organizationToolpackId !== null
            ? `org:${row.organizationToolpackId}`
            : null;
      if (ref === null) continue;
      const arr = toolpacksByStationId.get(row.stationId) ?? [];
      arr.push(ref);
      toolpacksByStationId.set(row.stationId, arr);
    }

    return {
      set,
      // #688: each row with the caller's capabilities on it.
      stations: ObjectCapabilitiesService.attach(
        set,
        "station",
        data.map((s) => ({
          ...s,
          enabledToolpacks: toolpacksByStationId.get(s.id) ?? [],
        }))
      ),
      total,
    };
  }
}
