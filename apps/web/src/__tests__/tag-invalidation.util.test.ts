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
        root,
        queryKeys.entityTags.root,
      ]);
    }
  );
});

describe("tagCatalogChangeKeys (#1070)", () => {
  it("refreshes the catalog, every object's tags and every taggable list", () => {
    expect(tagCatalogChangeKeys()).toEqual(
      expect.arrayContaining([
        queryKeys.entityTags.root,
        queryKeys.tagAssignments.root,
        queryKeys.connectorEntities.root,
        queryKeys.stations.root,
        queryKeys.portalResults.root,
        queryKeys.connectorInstances.root,
        queryKeys.curatedViews.root,
      ])
    );
  });
});
