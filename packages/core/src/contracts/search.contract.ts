import { z } from "zod";

/**
 * #1076: `GET /api/search`, the command palette's one read-scoped search.
 * It takes at most one of `q` (by name), `tag` (by tag name prefix) or
 * `refs` (hydrate known ids); with none it answers the caller's favorites.
 * Every result is something the caller can read in their active org.
 */

/** The object types the palette searches, in the order results come back. */
export const SEARCH_RESULT_TYPES = [
  "station",
  "pin",
  "curated_view",
  "connector_instance",
  "entity",
  "portal",
] as const;
export const SearchResultTypeSchema = z.enum(SEARCH_RESULT_TYPES);
export type SearchResultType = z.infer<typeof SearchResultTypeSchema>;

/** Results per type for `q` and `tag`. */
export const SEARCH_PER_TYPE_LIMIT = 5;
/** Favorites per type when no mode is given. */
export const SEARCH_FAVORITES_PER_TYPE_LIMIT = 10;
/** The most `type:id` pairs `refs` takes (Recent's cap). */
export const SEARCH_MAX_REFS = 20;
/** The most tags a `tag` prefix matches. */
export const SEARCH_MAX_TAGS = 5;

const SEARCH_TEXT_MAX = 120;

export interface SearchRef {
  type: SearchResultType;
  id: string;
}

/**
 * `refs` as typed pairs, or `null` when any entry is malformed, names an
 * unknown type, or there are more than {@link SEARCH_MAX_REFS}.
 */
export function parseSearchRefs(raw: string): SearchRef[] | null {
  const entries = raw.split(",");
  if (entries.length === 0 || entries.length > SEARCH_MAX_REFS) return null;
  const refs: SearchRef[] = [];
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator <= 0) return null;
    const type = SearchResultTypeSchema.safeParse(entry.slice(0, separator));
    const id = entry.slice(separator + 1).trim();
    if (!type.success || !id) return null;
    refs.push({ type: type.data, id });
  }
  return refs;
}

export const SearchRequestQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(SEARCH_TEXT_MAX).optional(),
    tag: z.string().trim().min(1).max(SEARCH_TEXT_MAX).optional(),
    /** Comma-separated `type:id`, at most {@link SEARCH_MAX_REFS}. */
    refs: z
      .string()
      .refine((raw) => parseSearchRefs(raw) !== null, {
        message: `refs must be up to ${SEARCH_MAX_REFS} comma-separated type:id pairs`,
      })
      .optional(),
  })
  .strict()
  .refine(
    (query) =>
      [query.q, query.tag, query.refs].filter((v) => v !== undefined).length <=
      1,
    { message: "Pass at most one of q, tag or refs" }
  );
export type SearchRequestQuery = z.infer<typeof SearchRequestQuerySchema>;

export const SearchResultTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
});

export const SearchResultSchema = z.object({
  type: SearchResultTypeSchema,
  id: z.string(),
  name: z.string(),
  /** Readable tags only; `[]` for portals, which aren't taggable. */
  tags: z.array(SearchResultTagSchema),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponsePayloadSchema = z.object({
  results: z.array(SearchResultSchema),
  /** `tag` mode: the readable tags that matched, for the group label. */
  matchedTags: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .optional(),
});
export type SearchResponsePayload = z.infer<typeof SearchResponsePayloadSchema>;
