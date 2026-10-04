import { z } from "zod";

/**
 * #688: the caller's capabilities on one object, carried by every GET and
 * list payload row of a per-object resource type. The server computes it with
 * the same `PermissionSet.can` its mutation routes `check`, so what the UI
 * offers and what the server allows can't disagree. A returned row is always
 * readable (#692), so `read` is true; it's computed, not assumed, and kept so
 * the shape is total.
 */
export const ObjectCapabilitiesSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  delete: z.boolean(),
});

/** Capabilities for a shareable type (station, pin, curated_view). `share`
 *  exists only there: it isn't a verb on the other types. */
export const ShareableObjectCapabilitiesSchema =
  ObjectCapabilitiesSchema.extend({
    share: z.boolean(),
  });

export type ObjectCapabilities = z.infer<typeof ObjectCapabilitiesSchema>;
export type ShareableObjectCapabilities = z.infer<
  typeof ShareableObjectCapabilitiesSchema
>;

/** A row schema plus its required `capabilities` (non-shareable types). */
export const withCapabilities = <T extends z.ZodRawShape>(
  row: z.ZodObject<T>
) => row.extend({ capabilities: ObjectCapabilitiesSchema });

/** A row schema plus its required `capabilities`, including `share`. */
export const withShareableCapabilities = <T extends z.ZodRawShape>(
  row: z.ZodObject<T>
) => row.extend({ capabilities: ShareableObjectCapabilitiesSchema });
