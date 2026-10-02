/**
 * Scopes a curated view's definition to the caller before it's sent (#680).
 *
 * A view's `filter` names columns and literal values (`salary > 100000`), and
 * its projection lists field mappings, some of which a reader may not be able
 * to read. Sent to every reader, both leak what the projection and the
 * per-field-mapping grants hide: the value oracle `queryViewRowsByColumn`
 * refuses. So only a caller with `write` on the view (who edits the
 * definition) gets it. Every other reader gets `filter: null`, only the
 * projection ids they can read, and the two booleans the UI shows ("Filtered",
 * "N selected" / "All columns").
 */

import type { PermissionSet } from "./permission-set.js";
import type { CuratedViewSelect } from "../db/schema/zod.js";

export class CuratedViewPayloadService {
  /** Whether the caller may see this view's full definition. */
  static canSeeDefinition(
    set: PermissionSet,
    view: CuratedViewSelect
  ): boolean {
    return set.can("resource.write", {
      type: "curated_view",
      id: view.id,
      createdBy: view.createdBy,
    });
  }

  /** The view row as this caller may see it, plus `filtered` / `projected`. */
  static scopeRow<T extends CuratedViewSelect>(
    set: PermissionSet,
    view: T,
    projected: boolean
  ): T & { filtered: boolean; projected: boolean } {
    const filtered = view.filter != null;
    return CuratedViewPayloadService.canSeeDefinition(set, view)
      ? { ...view, filtered, projected }
      : { ...view, filter: null, filtered, projected };
  }

  /** The projection ids this caller may see: all of them for a caller with
   *  write, otherwise only the field mappings they can read (the same test as
   *  the records endpoint's columns). */
  static scopeFieldMappingIds(
    set: PermissionSet,
    view: CuratedViewSelect,
    fieldMappingIds: string[]
  ): string[] {
    if (CuratedViewPayloadService.canSeeDefinition(set, view)) {
      return fieldMappingIds;
    }
    return fieldMappingIds.filter((id) =>
      set.can("resource.read", { type: "field_mapping", id })
    );
  }
}
