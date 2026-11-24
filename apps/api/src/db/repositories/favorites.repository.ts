/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatch for drizzle's insert typing over a computed target column; values are validated upstream. */
/**
 * Repository for the `favorites` table (#1072).
 *
 * A favorite targets one of four object types, each in its own FK column.
 * Every method takes the target type and resolves that column through
 * {@link favoriteColumn}, so a caller never names a column. Rows are always
 * hard-deleted: a favorite has nothing to restore.
 */

import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  FAVORITE_TARGET_COLUMNS,
  type FavoriteTarget,
  type FavoriteTargetType,
} from "@portalai/core/models";

import {
  connectorInstances,
  curatedViews,
  favorites,
  portalResults,
  stations,
} from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { FavoriteInsert, FavoriteSelect } from "../schema/zod.js";

/** The favorite column holding each target type's id. */
const FAVORITE_COLUMNS = {
  station: favorites.stationId,
  pin: favorites.portalResultId,
  curated_view: favorites.curatedViewId,
  connector_instance: favorites.connectorInstanceId,
} as const satisfies Record<FavoriteTargetType, AnyPgColumn>;

export function favoriteColumn(type: FavoriteTargetType) {
  return FAVORITE_COLUMNS[type];
}

/** The table each target type's objects live in. */
const FAVORITE_TARGET_TABLES = {
  station: stations,
  pin: portalResults,
  curated_view: curatedViews,
  connector_instance: connectorInstances,
} as const;

export class FavoritesRepository extends Repository<
  typeof favorites,
  FavoriteSelect,
  FavoriteInsert
> {
  constructor() {
    super(favorites);
  }

  /**
   * Star an object for a user unless it's already starred. Race-safe: the
   * insert yields to the target's unique index, so two concurrent calls make
   * one row.
   */
  async insertIfAbsent(
    row: {
      id: string;
      organizationId: string;
      userId: string;
      created: number;
    },
    target: FavoriteTarget,
    client: DbClient = db
  ): Promise<{ created: boolean }> {
    const values = {
      ...row,
      createdBy: row.userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      stationId: null,
      portalResultId: null,
      curatedViewId: null,
      connectorInstanceId: null,
      [FAVORITE_TARGET_COLUMNS[target.type]]: target.id,
    };
    const inserted = await (client as typeof db)
      .insert(favorites)
      .values(values as any)
      .onConflictDoNothing({
        target: [favoriteColumn(target.type), favorites.userId],
      })
      .returning({ id: favorites.id });
    return { created: inserted.length > 0 };
  }

  /** Unstar: remove the user's favorite of the object. Returns the count. */
  async deleteFor(
    userId: string,
    target: FavoriteTarget,
    client: DbClient = db
  ): Promise<number> {
    const removed = await (client as typeof db)
      .delete(favorites)
      .where(
        and(
          eq(favoriteColumn(target.type), target.id),
          eq(favorites.userId, userId)
        )
      )
      .returning({ id: favorites.id });
    return removed.length;
  }

  /** Every user's favorites of these objects (their delete's sweep). */
  async hardDeleteByTargets(
    type: FavoriteTargetType,
    ids: string[],
    client: DbClient = db
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const removed = await (client as typeof db)
      .delete(favorites)
      .where(inArray(favoriteColumn(type), ids))
      .returning({ id: favorites.id });
    return removed.length;
  }

  /** One member's favorites in one org (their removal's sweep). */
  async hardDeleteByUser(
    organizationId: string,
    userId: string,
    client: DbClient = db
  ): Promise<number> {
    const removed = await (client as typeof db)
      .delete(favorites)
      .where(
        and(
          eq(favorites.organizationId, organizationId),
          eq(favorites.userId, userId)
        )
      )
      .returning({ id: favorites.id });
    return removed.length;
  }

  /** Every favorite in an org (org delete and reset). */
  async hardDeleteByOrganization(
    organizationId: string,
    client: DbClient = db
  ): Promise<number> {
    const removed = await (client as typeof db)
      .delete(favorites)
      .where(eq(favorites.organizationId, organizationId))
      .returning({ id: favorites.id });
    return removed.length;
  }

  /** Which of these objects the user favorited, in one query. */
  async favoritedIds(
    organizationId: string,
    userId: string,
    type: FavoriteTargetType,
    ids: string[],
    client: DbClient = db
  ): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const column = favoriteColumn(type);
    const rows = await (client as typeof db)
      .select({ id: column })
      .from(favorites)
      .where(
        and(
          inArray(column, ids),
          eq(favorites.userId, userId),
          eq(favorites.organizationId, organizationId)
        )
      );
    return new Set(rows.map((r) => r.id as string));
  }

  /**
   * A list-query predicate: the object (`idCol`) is one of the user's
   * favorites in the org.
   */
  favoritedBy(
    organizationId: string,
    userId: string,
    type: FavoriteTargetType,
    idCol: AnyPgColumn
  ): SQL {
    const column = favoriteColumn(type);
    return inArray(
      idCol,
      db
        .select({ id: column })
        .from(favorites)
        .where(
          and(
            eq(favorites.userId, userId),
            eq(favorites.organizationId, organizationId),
            sql`${column} IS NOT NULL`
          )
        )
    );
  }

  /**
   * Share-lock the object's row while it's live, for the length of the
   * caller's transaction, so a star can't land after its delete's sweep.
   * Returns false when the object is deleted or missing.
   */
  async lockLiveTarget(
    target: FavoriteTarget,
    client: DbClient
  ): Promise<boolean> {
    const table = FAVORITE_TARGET_TABLES[target.type];
    const [row] = await (client as typeof db)
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, target.id), isNull(table.deleted)))
      .for("share");
    return !!row;
  }
}

/** Singleton instance. */
export const favoritesRepo = new FavoritesRepository();
