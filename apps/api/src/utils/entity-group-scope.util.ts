import type { EntityGroupContext } from "../services/analytics.service.js";

/** The granted-views shape both context surfaces resolve
 *  (`PortalSqlService.resolveGrantedViewColumns(...).views`). */
interface GrantedViewRef {
  view: { connectorEntityId: string };
  /** The columns the caller may read through this view. */
  columns: ReadonlyArray<{ normalizedKey: string }>;
}

/**
 * #648: restrict a station's entity-group metadata to the caller's granted
 * entities. A group is kept **only when every one of its members' entities is
 * granted** — a partially-granted group is unusable for a join (the member
 * can't query the other side) and would otherwise leak the ungranted entity's
 * participation (its `entityKey` / link-column names, or the anchoring role of
 * a dropped primary member). So the group is emitted intact or not at all.
 *
 * #651: each member's **link column** must also be readable through some
 * granted view over its entity (views over one entity are unioned). A join
 * needs every member's link column, and emitting the group would disclose that
 * column's key/label/normalizedKey past the view projection — the same
 * column-metadata scoping #599 applies to `entities`. `resolve_identity` (#658)
 * relies on the same rule: filtering on a column the caller can't read would
 * be an oracle for its values.
 *
 * Pure + fail-closed (empty granted set → no groups), and the single source
 * `buildStationContext`, the `station_context` tool and `resolve_identity`
 * share so they can't drift (the same discipline #599 used for `entities`).
 */
export function scopeEntityGroupsToEntities(
  entityGroups: EntityGroupContext[],
  grantedViews: readonly GrantedViewRef[]
): EntityGroupContext[] {
  const readableKeysByEntity = new Map<string, Set<string>>();
  for (const { view, columns } of grantedViews) {
    const keys =
      readableKeysByEntity.get(view.connectorEntityId) ?? new Set<string>();
    for (const c of columns) keys.add(c.normalizedKey);
    readableKeysByEntity.set(view.connectorEntityId, keys);
  }
  return entityGroups.filter(
    (group) =>
      group.members.length > 0 &&
      group.members.every(
        (m) =>
          readableKeysByEntity
            .get(m.connectorEntityId)
            ?.has(m.linkNormalizedKey) ?? false
      )
  );
}
