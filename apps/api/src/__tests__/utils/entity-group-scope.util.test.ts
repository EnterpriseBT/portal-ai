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

// Each granted view can read the members' link column `k` by default — the
// #648 cases are about entity grants; the #651 cases below vary the columns.
function views(...ids: string[]) {
  return ids.map((id) => ({
    view: { connectorEntityId: id },
    columns: [{ normalizedKey: "k" }],
  }));
}

function viewWith(connectorEntityId: string, ...normalizedKeys: string[]) {
  return {
    view: { connectorEntityId },
    columns: normalizedKeys.map((normalizedKey) => ({ normalizedKey })),
  };
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

describe("scopeEntityGroupsToEntities — link-column scoping (#651)", () => {
  it("drops the group when a member's only view projects its link column out", () => {
    // ent-2's view can read `amount` but not the link column `k`.
    expect(
      scopeEntityGroupsToEntities(
        [GROUP],
        [viewWith("ent-1", "k"), viewWith("ent-2", "amount")]
      )
    ).toEqual([]);
  });

  it("keeps the group when any of several views over an entity reads the link column (union)", () => {
    const out = scopeEntityGroupsToEntities(
      [GROUP],
      [
        viewWith("ent-1", "k"),
        viewWith("ent-2", "amount"), // no link column…
        viewWith("ent-2", "k", "name"), // …but this view over ent-2 has it
      ]
    );
    expect(out).toEqual([GROUP]);
  });

  it("does not count a readable column that is not the member's link column", () => {
    expect(
      scopeEntityGroupsToEntities(
        [GROUP],
        [viewWith("ent-1", "k"), viewWith("ent-2", "name", "email")]
      )
    ).toEqual([]);
  });
});
