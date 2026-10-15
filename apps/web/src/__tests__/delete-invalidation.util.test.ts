/**
 * #802: what a connector or entity delete must refresh. The delete removes the
 * views over the deleted entities and detaches them from their stations, so
 * both lists go stale with the entity. Each delete's list lives in one util
 * the views call, rather than four hand-copied blocks that had already drifted
 * (the entity deletes never refreshed stations).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { jest } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../api/keys";
import {
  invalidateAfterConnectorInstanceDelete,
  invalidateAfterConnectorEntityDelete,
} from "../utils/delete-invalidation.util";

const here = dirname(fileURLToPath(import.meta.url));

function invalidatedKeys(run: (qc: QueryClient) => void): unknown[] {
  const queryClient = new QueryClient();
  const spy = jest.spyOn(queryClient, "invalidateQueries");
  run(queryClient);
  return spy.mock.calls.map(
    ([filters]) => (filters as { queryKey: unknown }).queryKey
  );
}

describe("invalidateAfterConnectorInstanceDelete", () => {
  it("refreshes the instance, its entities, mappings, stations and views", () => {
    expect(invalidatedKeys(invalidateAfterConnectorInstanceDelete)).toEqual(
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

describe("invalidateAfterConnectorEntityDelete", () => {
  it("refreshes the entity, its records, mappings, groups, stations and views", () => {
    expect(invalidatedKeys(invalidateAfterConnectorEntityDelete)).toEqual(
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

describe("delete success handlers use the shared invalidation", () => {
  it.each([
    ["views/Connector.view.tsx", "invalidateAfterConnectorInstanceDelete"],
    [
      "views/ConnectorInstance.view.tsx",
      "invalidateAfterConnectorInstanceDelete",
    ],
    ["views/Entities.view.tsx", "invalidateAfterConnectorEntityDelete"],
    ["views/EntityDetail.view.tsx", "invalidateAfterConnectorEntityDelete"],
  ])("%s calls %s", (file, helper) => {
    const source = readFileSync(join(here, "..", file), "utf8");
    expect(source).toContain(`${helper}(queryClient)`);
  });
});
