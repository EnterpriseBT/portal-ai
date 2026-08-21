import { z } from "zod";

/**
 * Generic pagination query parameters for list endpoints.
 */
export const PaginationRequestQuerySchema = z.object({
  search: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .default(20)
    .transform((v) => Math.min(v, 100)),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sortBy: z.string().optional().default("created"),
  sortOrder: z.enum(["asc", "desc"]).optional().default("asc"),
  /**
   * Opaque keyset cursor (#433). When present and valid it takes precedence
   * over `offset`. Additive: `offset` stays valid everywhere, so a list that
   * has not adopted cursors is unaffected.
   */
  cursor: z.string().optional(),
});

export type PaginationRequestQuery = z.infer<
  typeof PaginationRequestQuerySchema
>;

/**
 * Generic pagination metadata included in list responses.
 */
export const PaginatedResponsePayloadSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  /**
   * Cursor for the following page (#433), or `null` at the end of the result
   * set. Optional so lists that have not adopted cursors keep their shape.
   */
  nextCursor: z.string().nullable().optional(),
});

export type PaginatedResponsePayload = z.infer<
  typeof PaginatedResponsePayloadSchema
>;

// ── Keyset cursors (#433) ───────────────────────────────────────────

/**
 * The decoded shape of a keyset cursor. Opaque to clients — pinned here so
 * both sides of the round-trip agree, not so anyone reads it off the wire.
 *
 * `value` is the sort key's value at the anchor row and `id` is the unique
 * tiebreaker; together they name a position in the ordering exactly. `null`
 * is a real value here: it means the anchor sits in the NULL region of a
 * nullable sort column, which the seek predicate has to treat differently
 * from an ordinary value.
 *
 * `sortBy` / `sortOrder` are carried so a cursor minted under one ordering
 * can be recognised as meaningless under another.
 */
export const KeysetCursorSchema = z.object({
  sortBy: z.string(),
  sortOrder: z.enum(["asc", "desc"]),
  value: z.union([z.string(), z.number(), z.null()]),
  id: z.string(),
});

export type KeysetCursor = z.infer<typeof KeysetCursorSchema>;

/**
 * Base64url helpers. `Buffer` is deliberately not used — this module is
 * imported by the browser bundle as well as the API.
 */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(token: string): string | null {
  try {
    const base64 = token.replace(/-/g, "+").replace(/_/g, "/");
    // `atob` rejects an unpadded length, and we strip padding when encoding.
    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      "="
    );
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Encode a cursor as an opaque, URL-safe token. */
export function encodeCursor(cursor: KeysetCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

/**
 * Decode a cursor, or return `null` if it is unusable for any reason —
 * malformed base64, not JSON, or not matching the schema.
 *
 * **Never throws.** A cursor arrives from a URL a user can edit, a stale
 * bookmark, or a client built against an older shape; every one of those
 * degrades to "serve the first page" rather than erroring. Callers must
 * also reject a cursor whose `sortBy`/`sortOrder` differ from the request's
 * — structurally valid, but meaningless under a different ordering.
 */
export function decodeCursor(token: string): KeysetCursor | null {
  if (!token) return null;
  const json = fromBase64Url(token);
  if (json === null) return null;
  try {
    const parsed = KeysetCursorSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
