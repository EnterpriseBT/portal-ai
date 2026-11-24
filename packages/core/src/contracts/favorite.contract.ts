import { z } from "zod";

import { FavoriteTargetSchema } from "../models/favorite.model.js";

/**
 * #1072: `PUT` / `DELETE /api/favorites/:type/:id`. Both answer the caller's
 * resulting state, whether or not anything changed.
 */
export const FavoriteParamsSchema = FavoriteTargetSchema.strict();
export type FavoriteParams = z.infer<typeof FavoriteParamsSchema>;

export const FavoriteResponsePayloadSchema = z.object({
  isFavorite: z.boolean(),
});
export type FavoriteResponsePayload = z.infer<
  typeof FavoriteResponsePayloadSchema
>;

/**
 * What a favoritable object's list adds. `favorite=true` narrows to the
 * caller's own favorites; `false` is refused, since "everything I haven't
 * starred" was never a filter.
 */
export const FavoriteListQueryFields = {
  favorite: z.literal("true").optional(),
};

/**
 * Whether the caller favorited the row. The four favoritable types' routes
 * always set it; it's optional because their row schemas are shared with
 * paths that don't.
 */
export const FavoriteRowFields = {
  isFavorite: z.boolean().optional(),
};
