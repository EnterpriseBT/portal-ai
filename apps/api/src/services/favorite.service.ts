/**
 * Favorites (#1072): one user's star on a station, pinned result, curated
 * view or connector instance.
 *
 * A favorite is the caller's own data, not the object's, so starring and
 * unstarring need only **read** on the object (else its own 404, the same for
 * both verbs, so an unreadable id reveals nothing). The user always comes
 * from the request context. Nothing here takes a job lock: no job reads or
 * writes favorites.
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
        const live = await DbService.repository.favorites.lockLiveTarget(
          target,
          tx
        );
        if (!live) throw ObjectTargetService.descriptor(target.type).notFound();
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
