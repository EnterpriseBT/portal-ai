/**
 * Favorites (#1072): one user's star on a station, pinned result, curated
 * view or connector instance.
 *
 * A favorite is the caller's own data, not the object's, so starring and
 * unstarring need only **read** on the object (else its own 404, the same for
 * both verbs, so an unreadable id reveals nothing). The user always comes
 * from the request context. Nothing here takes a job lock: no job reads or
 * writes favorites. A star share-locks the object's row and the caller's
 * membership, so it can't outlive either's removal.
 */

import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import {
  FavoriteModelFactory,
  type FavoriteTarget,
  type FavoriteTargetType,
} from "@portalai/core/models";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ObjectTargetService } from "./object-target.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";

/** Wrap an unexpected failure, passing an `ApiError` through. */
function failed(error: unknown): never {
  if (error instanceof ApiError) throw error;
  throw new ApiError(
    500,
    ApiCode.FAVORITE_UPDATE_FAILED,
    error instanceof Error ? error.message : "Failed to update favorite"
  );
}

export class FavoriteService {
  /**
   * Star the object for the caller. Idempotent: an existing star stays. The
   * object row is share-locked while the star is written, so it can't land
   * after the object's delete has swept its favorites.
   */
  static async set(
    ctx: PermissionContext,
    target: FavoriteTarget
  ): Promise<{ isFavorite: true }> {
    try {
      const set = await PermissionService.loadSet(ctx);
      await ObjectTargetService.loadReadable(set, ctx, target);
      await DbService.transaction(async (tx) => {
        const notFound = ObjectTargetService.descriptor(target.type).notFound;
        // The caller's membership too (code review): a removal sweeps the
        // member's favorites, so a star must not commit after it. Either the
        // removal waits for this and sweeps the star, or it ran first and
        // the caller, no longer a member, can read nothing here.
        const member =
          await DbService.repository.organizationUsers.lockLiveMembership(
            ctx.organizationId,
            ctx.userId,
            tx
          );
        if (!member) throw notFound();
        const live = await DbService.repository.favorites.lockLiveTarget(
          target,
          tx
        );
        if (!live) throw notFound();
        // The factory stamps the id and created time; the repository sets
        // the target column.
        const base = new FavoriteModelFactory().create(ctx.userId).toJSON();
        await DbService.repository.favorites.insertIfAbsent(
          {
            id: base.id!,
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            created: base.created!,
          },
          target,
          tx
        );
      });
      return { isFavorite: true };
    } catch (error) {
      return failed(error);
    }
  }

  /** Unstar the object for the caller. Idempotent: no star is fine. */
  static async unset(
    ctx: PermissionContext,
    target: FavoriteTarget
  ): Promise<{ isFavorite: false }> {
    try {
      const set = await PermissionService.loadSet(ctx);
      await ObjectTargetService.loadReadable(set, ctx, target);
      await DbService.repository.favorites.deleteFor(ctx.userId, target);
      return { isFavorite: false };
    } catch (error) {
      return failed(error);
    }
  }

  /** Which of a page's objects the caller starred, in one query. */
  static favoritedIds(
    ctx: PermissionContext,
    type: FavoriteTargetType,
    ids: string[]
  ): Promise<Set<string>> {
    return DbService.repository.favorites.favoritedIds(
      ctx.organizationId,
      ctx.userId,
      type,
      ids
    );
  }

  /**
   * The rows with the caller's `isFavorite` on each, from one lookup. Rows
   * keep their order: favorites never reorder a list.
   */
  static async attach<T extends { id: string }>(
    ctx: PermissionContext,
    type: FavoriteTargetType,
    rows: T[]
  ): Promise<(T & { isFavorite: boolean })[]> {
    const starred = await FavoriteService.favoritedIds(
      ctx,
      type,
      rows.map((r) => r.id)
    );
    return rows.map((r) => ({ ...r, isFavorite: starred.has(r.id) }));
  }

  /** Whether the caller favorited one object. */
  static async isFavorite(
    ctx: PermissionContext,
    type: FavoriteTargetType,
    id: string
  ): Promise<boolean> {
    return (await FavoriteService.favoritedIds(ctx, type, [id])).has(id);
  }

  /** A list predicate: the object is one of the caller's favorites. */
  static onlyFavorites(
    ctx: PermissionContext,
    type: FavoriteTargetType,
    idCol: AnyPgColumn
  ): SQL {
    return DbService.repository.favorites.favoritedBy(
      ctx.organizationId,
      ctx.userId,
      type,
      idCol
    );
  }
}
