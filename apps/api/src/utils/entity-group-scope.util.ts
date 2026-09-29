import type { EntityGroupContext } from "../services/analytics.service.js";

/** The granted-views shape both context surfaces resolve
 *  (`PortalSqlService.resolveGrantedViewColumns(...).views`). */
interface GrantedViewRef {
  view: { connectorEntityId: string };
}

/**
 * #648: restrict a station's entity-group metadata to the caller's granted
 * entities. A group is kept **only when every one of its members' entities is
 * granted** — a partially-granted group is unusable for a join (the member
 * can't query the other side) and would otherwise leak the ungranted entity's
 * participation (its `entityKey` / link-column names, or the anchoring role of
 * a dropped primary member). So the group is emitted intact or not at all.
 *
 * Pure + fail-closed (empty granted set → no groups), and the single source
 * both `buildStationContext` and the `station_context` tool share so the two
 * can't drift (the same discipline #599 used for `entities`).
 *
 * NOTE (#651): scoping is entity-level. A shown group still carries every
 * member's link-column `key`/`label`/`normalizedKey`, even a column outside the
 * member's view projection — column-level link-metadata scoping is a follow-up.
 */
export function scopeEntityGroupsToEntities(
  entityGroups: EntityGroupContext[],
  grantedViews: readonly GrantedViewRef[]
): EntityGroupContext[] {
  const grantedEntityIds = new Set(
    grantedViews.map((g) => g.view.connectorEntityId)
  );
  return entityGroups.filter(
    (group) =>
      group.members.length > 0 &&
      group.members.every((m) => grantedEntityIds.has(m.connectorEntityId))
  );
}
