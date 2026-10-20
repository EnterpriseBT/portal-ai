/**
 * Scopes a curated view's definition to the caller before it's sent (#680).
 *
 * A view's `filter` names columns and literal values (`salary > 100000`).
 * Sent to every reader, it leaks the rows the filter hides: the value oracle
 * `queryViewRowsByColumn` refuses. So only a caller with `write` on the view
 * (who edits the definition) gets it. Every other reader gets `filter: null`
 * and the two booleans the UI shows ("Filtered", "N selected" / "All
 * columns"). #829: the projection itself is what reading the view conveys,
 * so every reader gets its ids.
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
}
