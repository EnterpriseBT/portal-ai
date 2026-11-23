import { TAG_WRITE_TOOLS, changedTags } from "../utils/tag-tools.util";

// #1071: a portal turn that changed tags leaves the Tags page and every
// taggable list stale, so they refresh when the turn ends.
describe("changedTags (#1071)", () => {
  it("names the five tools that change tags", () => {
    expect([...TAG_WRITE_TOOLS]).toEqual([
      "tag_create",
      "tag_update",
      "tag_delete",
      "tag_assign",
      "tag_unassign",
    ]);
  });

  it.each([
    "tag_create",
    "tag_update",
    "tag_delete",
    "tag_assign",
    "tag_unassign",
  ])("is true for a turn that ran %s", (name) => {
    expect(changedTags(new Set(["sql_query", name]))).toBe(true);
  });

  it("is false for a turn that only listed tags or did something else", () => {
    expect(changedTags(new Set(["tag_list", "curated_view_create"]))).toBe(
      false
    );
    expect(changedTags(new Set())).toBe(false);
  });
});
