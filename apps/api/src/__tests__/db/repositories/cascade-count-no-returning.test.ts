/**
 * Guard: the record-scale cascade soft-deletes must report their
 * affected-row count WITHOUT `RETURNING` (#423).
 *
 * Deleting a connector instance whose entity held ~200K `entity_records`
 * OOM-killed the API task (`exit 137`, five times on 2026-08-20). Each of
 * these methods ran `UPDATE … RETURNING *` and used the result only for
 * `result.length`, so every matched row — carrying its `data` JSONB — was
 * streamed into Node, decoded and discarded. With `DesiredCount: 1` that
 * is a full environment outage.
 *
 * The count itself is contract: `ConnectorEntityValidationService.
 * executeDelete` returns these numbers as `ConnectorEntityCascadeCounts`,
 * which reach an API response (`connector-entity.router.ts`) and an agent
 * tool result (`connector-entity-delete.tool.ts`). So the fix is "same
 * number, no rows" — not "drop the return value".
 *
 * The integration suite proves the number is right against real SQL. It
 * cannot prove *how* the number was obtained: `result.length` over 200K
 * materialized rows and a driver-reported count are indistinguishable by
 * their return value. This guard closes that gap by handing each method a
 * fake client and asserting `.returning()` is never reached — the one
 * observable difference, and the one that decides whether the API stays
 * up. A regression here is silent everywhere else until a large tenant
 * deletes something.
 *
 * `softDeleteBeforeWatermark` is deliberately absent: it already projects
 * `.returning({ id })` and its caller genuinely needs those ids to clean
 * the wide table (`rest-api.adapter.ts`). Returning ids on purpose is
 * fine; returning whole rows to call `.length` on them is the bug.
 */

import { describe, it, expect } from "@jest/globals";

import { EntityRecordsRepository } from "../../../db/repositories/entity-records.repository.js";
import { EntityGroupMembersRepository } from "../../../db/repositories/entity-group-members.repository.js";
import { EntityTagAssignmentsRepository } from "../../../db/repositories/entity-tag-assignments.repository.js";
import { FieldMappingsRepository } from "../../../db/repositories/field-mappings.repository.js";
import { ConnectorEntitiesRepository } from "../../../db/repositories/connector-entities.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";

/**
 * Minimal stand-in for the drizzle update chain.
 *
 * `.where()` yields a thenable so `await`ing the builder resolves the way
 * postgres-js does — an array-like carrying `count` — while still exposing
 * `.returning()` so a method that reaches for it is caught rather than
 * crashing with a confusing TypeError.
 */
function fakeClient(affected: number) {
  const state = { returningCalled: false, setPayload: null as unknown };

  const resolved = Object.assign([] as unknown[], { count: affected });

  const thenable = {
    returning: () => {
      state.returningCalled = true;
      // What the pre-fix code consumed: one object per affected row.
      return Promise.resolve(
        Array.from({ length: affected }, (_, i) => ({ id: `row-${i}` }))
      );
    },
    then: <T>(
      onFulfilled: (value: unknown) => T,
      onRejected?: (reason: unknown) => T
    ) => Promise.resolve(resolved).then(onFulfilled, onRejected),
  };

  const client = {
    update: () => ({
      set: (payload: unknown) => {
        state.setPayload = payload;
        return { where: () => thenable };
      },
    }),
  } as unknown as DbClient;

  return { client, state };
}

const AFFECTED = 7;
const ENTITY_IDS = ["ce-1", "ce-2"];

const CASCADES: ReadonlyArray<{
  name: string;
  call: (client: DbClient) => Promise<number>;
}> = [
  {
    name: "entityRecords.softDeleteByConnectorEntityIds",
    call: (c) =>
      new EntityRecordsRepository().softDeleteByConnectorEntityIds(
        ENTITY_IDS,
        "user-1",
        c
      ),
  },
  {
    name: "entityRecords.softDeleteByConnectorEntityId",
    call: (c) =>
      new EntityRecordsRepository().softDeleteByConnectorEntityId(
        "ce-1",
        "user-1",
        c
      ),
  },
  {
    name: "entityGroupMembers.softDeleteByConnectorEntityIds",
    call: (c) =>
      new EntityGroupMembersRepository().softDeleteByConnectorEntityIds(
        ENTITY_IDS,
        "user-1",
        c
      ),
  },
  {
    name: "entityTagAssignments.softDeleteByConnectorEntityIds",
    call: (c) =>
      new EntityTagAssignmentsRepository().softDeleteByConnectorEntityIds(
        ENTITY_IDS,
        "user-1",
        c
      ),
  },
  {
    name: "fieldMappings.softDeleteByConnectorEntityIds",
    call: (c) =>
      new FieldMappingsRepository().softDeleteByConnectorEntityIds(
        ENTITY_IDS,
        "user-1",
        c
      ),
  },
  {
    name: "connectorEntities.softDeleteByConnectorInstanceId",
    call: (c) =>
      new ConnectorEntitiesRepository().softDeleteByConnectorInstanceId(
        "ci-1",
        "user-1",
        c
      ),
  },
];

describe("record-scale cascades count without RETURNING (#423)", () => {
  it.each(CASCADES.map((c) => [c.name, c] as const))(
    "%s does not materialize rows to count them",
    async (_name, cascade) => {
      const { client, state } = fakeClient(AFFECTED);

      await cascade.call(client);

      expect(state.returningCalled).toBe(false);
    }
  );

  it.each(CASCADES.map((c) => [c.name, c] as const))(
    "%s reports the driver's affected-row count",
    async (_name, cascade) => {
      const { client } = fakeClient(AFFECTED);

      await expect(cascade.call(client)).resolves.toBe(AFFECTED);
    }
  );

  it.each(CASCADES.map((c) => [c.name, c] as const))(
    "%s still stamps deleted + deletedBy",
    async (_name, cascade) => {
      const { client, state } = fakeClient(AFFECTED);

      await cascade.call(client);

      expect(state.setPayload).toMatchObject({ deletedBy: "user-1" });
      expect((state.setPayload as { deleted: number }).deleted).toBeGreaterThan(
        0
      );
    }
  );
});
