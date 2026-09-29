import { describe, it, expect } from "@jest/globals";

import { scopeEntityGroupsToEntities } from "../../utils/entity-group-scope.util.js";
import type { EntityGroupContext } from "../../services/analytics.service.js";

function member(connectorEntityId: string, isPrimary = false) {
  return {
    entityKey: connectorEntityId,
    connectorEntityId,
    linkNormalizedKey: "k",
    linkColumnKey: "k",
    linkColumnLabel: "K",
    isPrimary,
  };
}

const GROUP: EntityGroupContext = {
  id: "g-1",
  name: "Customer Orders",
  members: [member("ent-1", true), member("ent-2", false)],
};

function views(...ids: string[]) {
  return ids.map((id) => ({ view: { connectorEntityId: id } }));
}

describe("scopeEntityGroupsToEntities (#648)", () => {
  it("keeps a group intact when every member entity is granted", () => {
    const out = scopeEntityGroupsToEntities([GROUP], views("ent-1", "ent-2"));
    expect(out).toEqual([GROUP]);
    // The primary member (the join anchor) is preserved.
    expect(out[0].members.some((m) => m.isPrimary)).toBe(true);
  });

  it("drops the whole group when any member entity is ungranted", () => {
    // Only the non-primary member's entity is granted → the primary is
    // ungranted, so the group (which would be anchorless) is absent entirely.
    expect(scopeEntityGroupsToEntities([GROUP], views("ent-2"))).toEqual([]);
    // And when the primary is granted but a sibling is not.
    expect(scopeEntityGroupsToEntities([GROUP], views("ent-1"))).toEqual([]);
  });

  it("is fail-closed: no granted views → no groups", () => {
    expect(scopeEntityGroupsToEntities([GROUP], views())).toEqual([]);
  });

  it("returns other fully-granted groups independently", () => {
    const solo: EntityGroupContext = {
      id: "g-2",
      name: "Solo",
      members: [member("ent-3", true)],
    };
    const out = scopeEntityGroupsToEntities(
      [GROUP, solo],
      views("ent-1", "ent-3")
    );
    expect(out.map((g) => g.id)).toEqual(["g-2"]);
  });
});
