/**
 * #802: what a connector or entity delete must refresh. The delete removes the
 * views over the deleted entities and detaches them from their stations, so
 * both lists go stale with the entity. Each delete's list lives in one util
 * the views call, rather than four hand-copied blocks that had already drifted
 * (the entity deletes never refreshed stations). Each util returns keys for
 * the call's `invalidate` option (#985), which still runs when the page
 * unmounts before the request settles.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { queryKeys } from "../api/keys";
import {
  connectorInstanceDeleteKeys,
  connectorEntityDeleteKeys,
  stationDeleteKeys,
} from "../utils/delete-invalidation.util";

const here = dirname(fileURLToPath(import.meta.url));

describe("connectorInstanceDeleteKeys", () => {
  it("refreshes the instance, its entities, mappings, stations and views", () => {
    expect(connectorInstanceDeleteKeys()).toEqual(
      expect.arrayContaining([
        queryKeys.connectorInstances.root,
        queryKeys.connectorEntities.root,
        queryKeys.fieldMappings.root,
        queryKeys.stations.root,
        queryKeys.curatedViews.root,
      ])
    );
  });
});

describe("connectorEntityDeleteKeys", () => {
  it("refreshes the entity, its records, mappings, groups, stations and views", () => {
    expect(connectorEntityDeleteKeys()).toEqual(
      expect.arrayContaining([
        queryKeys.connectorEntities.root,
        queryKeys.entityRecords.root,
        queryKeys.fieldMappings.root,
        queryKeys.entityGroups.root,
        queryKeys.stations.root,
        queryKeys.curatedViews.root,
      ])
    );
  });
});

// #1041: the station page's delete had its own copy of this list, without the
// organization. Deleting the default station there left the cached org
// pointing at it, and the Stations page showed "Station not found" until a
// reload.
describe("stationDeleteKeys", () => {
  it("refreshes the station, its portals and pins, and the organization", () => {
    expect(stationDeleteKeys()).toEqual(
      expect.arrayContaining([
        queryKeys.stations.root,
        queryKeys.portals.root,
        queryKeys.portalResults.root,
        queryKeys.organizations.root,
      ])
    );
  });
});

describe("delete calls invalidate through the shared keys", () => {
  it.each([
    ["views/Connector.view.tsx", "connectorInstanceDeleteKeys"],
    ["views/ConnectorInstance.view.tsx", "connectorInstanceDeleteKeys"],
    ["views/Entities.view.tsx", "connectorEntityDeleteKeys"],
    ["views/EntityDetail.view.tsx", "connectorEntityDeleteKeys"],
    ["views/Stations.view.tsx", "stationDeleteKeys"],
    ["views/StationDetail.view.tsx", "stationDeleteKeys"],
  ])("%s calls %s", (file, helper) => {
    const source = readFileSync(join(here, "..", file), "utf8");
    expect(source).toContain(`invalidate: ${helper}()`);
  });
});
