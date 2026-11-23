import { z } from "zod";

import { EntityTagSchema } from "../models/entity-tag.model.js";

/**
 * #1070: what a taggable object's list adds. `tagIds` filters to objects
 * carrying any of the (comma-separated) tags; `include=tags` attaches each
 * row's tags, only those the caller may read.
 */
export const TagListQueryFields = {
  tagIds: z.string().optional(),
};

export const TaggedRowFields = {
  tags: z.array(EntityTagSchema).optional(),
};
