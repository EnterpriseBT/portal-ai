import { queryKeys } from "../api/keys";
import {
  tagAssignmentKeys,
  tagCatalogChangeKeys,
} from "../utils/tag-invalidation.util";

describe("tagAssignmentKeys (#1070)", () => {
  it.each([
    ["entity", queryKeys.connectorEntities.root],
    ["station", queryKeys.stations.root],
    ["pin", queryKeys.portalResults.root],
    ["connector_instance", queryKeys.connectorInstances.root],
    ["curated_view", queryKeys.curatedViews.root],
  ] as const)(
    "refreshes a %s's tags, its type's lists and tag usage",
    (type, root) => {
      expect(tagAssignmentKeys(type)).toEqual([
        queryKeys.tagAssignments.root,
        [...root, "list"],
        queryKeys.entityTags.root,
      ]);
    }
  );

  // A pin's live data and a view's records sit under the same roots; a tag
  // change mustn't re-run them.
  it("leaves a pin's data and a view's records alone", () => {
    for (const type of ["pin", "curated_view"] as const) {
      expect(tagAssignmentKeys(type)).not.toContainEqual(
        type === "pin"
          ? queryKeys.portalResults.root
          : queryKeys.curatedViews.root
      );
    }
  });
});

describe("tagCatalogChangeKeys (#1070)", () => {
  it("refreshes the catalog, every object's tags and every taggable list", () => {
    expect(tagCatalogChangeKeys()).toEqual(
      expect.arrayContaining([
        queryKeys.entityTags.root,
        queryKeys.tagAssignments.root,
        [...queryKeys.connectorEntities.root, "list"],
        [...queryKeys.stations.root, "list"],
        [...queryKeys.portalResults.root, "list"],
        [...queryKeys.connectorInstances.root, "list"],
        [...queryKeys.curatedViews.root, "list"],
      ])
    );
  });
});
