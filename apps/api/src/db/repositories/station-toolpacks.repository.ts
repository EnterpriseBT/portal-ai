/**
 * Repository for the `station_toolpacks` join table.
 *
 * Each row links a station to a toolpack — either a built-in pack
 * (identified by `builtin_slug`) or a custom pack (identified by
 * `organization_toolpack_id`). XOR is enforced by the table CHECK
 * and by the `StationToolpackSchema` Zod refinement.
 *
 * Phase 1 only writes built-in rows. The custom column is created
 * but unused until phase 2.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { StationToolpackModelFactory } from "@portalai/core/models";

import { stationToolpacks } from "../schema/index.js";
import type {
  StationToolpackSelect,
  StationToolpackInsert,
} from "../schema/zod.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";

export interface ReplacePacksPayload {
  /** Built-in pack slugs to enable on the station. */
  builtinSlugs: string[];
  /** Custom toolpack IDs to enable. Phase 1 always passes []. */
  organizationToolpackIds?: string[];
}

export class StationToolpacksRepository extends Repository<
  typeof stationToolpacks,
  StationToolpackSelect,
  StationToolpackInsert
> {
  constructor() {
    super(stationToolpacks);
  }

  /**
   * All live (non-soft-deleted) join rows for a station.
   */
  async findByStationId(
    stationId: string,
    client: DbClient = db
  ): Promise<StationToolpackSelect[]> {
    return (await (client as typeof db)
      .select()
      .from(stationToolpacks)
      .where(
        and(
          eq(stationToolpacks.stationId, stationId),
          isNull(stationToolpacks.deleted)
        )
      )) as StationToolpackSelect[];
  }

  /**
   * Reconcile the set of pack rows for a station with the supplied
   * target. Soft-deletes rows whose ref is no longer in the target;
   * inserts rows for any new ref. No-op when the target already
   * matches the live set.
   *
   * Runs in a single transaction; if `client` is already a
   * transaction, re-uses it.
   */
  async replaceForStation(
    stationId: string,
    next: ReplacePacksPayload,
    actor: { userId: string },
    client: DbClient = db
  ): Promise<void> {
    const exec = async (tx: DbClient): Promise<void> => {
      const live = await this.findByStationId(stationId, tx);

      const liveSlugs = new Set(
        live.map((r) => r.builtinSlug).filter((s): s is string => s !== null)
      );
      const liveOrgIds = new Set(
        live
          .map((r) => r.organizationToolpackId)
          .filter((s): s is string => s !== null)
      );

      const nextSlugs = new Set(next.builtinSlugs);
      const nextOrgIds = new Set(next.organizationToolpackIds ?? []);

      // Rows to soft-delete: live rows whose ref is not in `next`.
      const toRemoveIds: string[] = [];
      for (const row of live) {
        if (row.builtinSlug !== null && !nextSlugs.has(row.builtinSlug)) {
          toRemoveIds.push(row.id);
        } else if (
          row.organizationToolpackId !== null &&
          !nextOrgIds.has(row.organizationToolpackId)
        ) {
          toRemoveIds.push(row.id);
        }
      }

      // Refs to insert: target refs that aren't already live.
      const toAddSlugs = [...nextSlugs].filter((s) => !liveSlugs.has(s));
      const toAddOrgIds = [...nextOrgIds].filter((id) => !liveOrgIds.has(id));

      if (
        toRemoveIds.length === 0 &&
        toAddSlugs.length === 0 &&
        toAddOrgIds.length === 0
      ) {
        return;
      }

      if (toRemoveIds.length > 0) {
        await this.softDeleteMany(toRemoveIds, actor.userId, tx);
      }

      const factory = new StationToolpackModelFactory();
      for (const slug of toAddSlugs) {
        const m = factory.create(actor.userId);
        m.update({
          stationId,
          builtinSlug: slug,
          organizationToolpackId: null,
        });
        await this.create(m.parse() as unknown as StationToolpackInsert, tx);
      }
      for (const orgId of toAddOrgIds) {
        const m = factory.create(actor.userId);
        m.update({
          stationId,
          builtinSlug: null,
          organizationToolpackId: orgId,
        });
        await this.create(m.parse() as unknown as StationToolpackInsert, tx);
      }
    };

    if (client !== db) {
      await exec(client);
      return;
    }
    await db.transaction(async (tx) => {
      await exec(tx);
    });
  }

  /**
   * Find live rows for any of the given station IDs (used by include payloads).
   */
  async findByStationIds(
    stationIds: string[],
    client: DbClient = db
  ): Promise<StationToolpackSelect[]> {
    if (stationIds.length === 0) return [];
    return (await (client as typeof db)
      .select()
      .from(stationToolpacks)
      .where(
        and(
          inArray(stationToolpacks.stationId, stationIds),
          isNull(stationToolpacks.deleted)
        )
      )) as StationToolpackSelect[];
  }
}

export const stationToolpacksRepo = new StationToolpacksRepository();
