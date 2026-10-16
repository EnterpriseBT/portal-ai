import { describe, it, expect, jest } from "@jest/globals";

import { BulkGeocodeRecordsTool } from "../../tools/bulk-geocode-records.tool.js";
import type { BulkGeocodeToolDeps } from "../../tools/bulk-geocode-records.tool.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { JobLockService } from "../../services/job-lock.service.js";
import { wrapWithLockGate } from "../../services/lock-gate.service.js";
import { TOOL_AUTHORIZATION } from "@portalai/core/registries";

type Built = { execute: (input: unknown) => Promise<Record<string, unknown>> };
const run = (t: unknown, input: unknown) => (t as Built).execute(input);

const baseInput = {
  connectorEntityId: "ce_parcels",
  sourceColumnKey: "c_address",
  targetColumnKey: "c_geometry",
};

function build(deps: BulkGeocodeToolDeps) {
  return new BulkGeocodeRecordsTool().build(
    "portal-1",
    "station-1",
    "org-1",
    "user-1",
    { assertEntityInScope: async () => {}, ...deps }
  );
}

describe("BulkGeocodeRecordsTool (#315)", () => {
  it("#802: refuses an entity that's deleted or outside the station, before anything else", async () => {
    const recordRejection = jest.fn(async () => {});
    const createJob = jest.fn(async () => ({ id: "job-x" }));
    const assertEntityInScope = jest.fn(async () => {
      throw new ApiError(
        404,
        ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
        "Connector entity not found"
      );
    });
    const t = build({
      assertEntityInScope,
      recordRejection,
      createJob,
      validateAck: async () => ({ ok: true }),
      assertUnlocked: async () => {},
      countRecords: async () => 100,
    });

    const out = await run(t, { ...baseInput, acknowledgeCost: true });

    expect(assertEntityInScope).toHaveBeenCalledWith("station-1", "ce_parcels");
    expect(out).toMatchObject({
      success: false,
      code: ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
    });
    expect(recordRejection).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("first call without acknowledgeCost → records a rejection + returns COST_NOT_ACKNOWLEDGED", async () => {
    const recordRejection = jest.fn(async () => {});
    const createJob = jest.fn(async () => ({ id: "job-x" }));
    const t = build({
      recordRejection,
      createJob,
      assertUnlocked: async () => {},
      countRecords: async () => 100,
    });

    const out = await run(t, baseInput);
    expect(out).toMatchObject({
      code: ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED,
      success: false,
    });
    expect(recordRejection).toHaveBeenCalledTimes(1);
    // No job enqueued on the rejection path.
    expect(createJob).not.toHaveBeenCalled();
  });

  it("acked call → locks, counts, enqueues bulk_geocode + returns the progress block", async () => {
    const assertUnlocked = jest.fn(async () => {});
    const createJob = jest.fn(async () => ({ id: "job-42" }));
    const t = build({
      validateAck: async () => ({ ok: true }),
      assertUnlocked,
      countRecords: async () => 250,
      createJob,
    });

    const out = await run(t, { ...baseInput, acknowledgeCost: true });
    expect(out).toMatchObject({
      jobId: "job-42",
      expectedRecords: 250,
      blockKind: "bulk-job-progress",
    });
    expect(assertUnlocked).toHaveBeenCalledWith(["ce_parcels"], "org-1");
    // Metadata carries the lock array + column keys.
    const [, params] = createJob.mock.calls[0] as unknown as [
      string,
      { metadata: Record<string, unknown> },
    ];
    expect(params.metadata).toMatchObject({
      connectorEntityId: "ce_parcels",
      sourceColumnKey: "c_address",
      targetColumnKey: "c_geometry",
      targetConnectorEntityIds: ["ce_parcels"],
      portalId: "portal-1",
      expectedRecords: 250,
    });
  });

  it("acked but validate says stale → COST_ACKNOWLEDGEMENT_INVALID, no enqueue", async () => {
    const createJob = jest.fn(async () => ({ id: "nope" }));
    const t = build({
      validateAck: async () => ({ ok: false, reason: "stale" }),
      assertUnlocked: async () => {},
      countRecords: async () => 5,
      createJob,
    });
    const out = await run(t, { ...baseInput, acknowledgeCost: true });
    expect(out).toMatchObject({
      code: ApiCode.BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID,
    });
    expect(createJob).not.toHaveBeenCalled();
  });

  it("a locked target entity refuses (typed envelope), no enqueue", async () => {
    const createJob = jest.fn(async () => ({ id: "nope" }));
    const t = build({
      validateAck: async () => ({ ok: true }),
      assertUnlocked: async () => {
        throw new ApiError(
          409,
          ApiCode.ENTITY_LOCKED_BY_JOB,
          "entity is locked by a running job"
        );
      },
      countRecords: async () => 5,
      createJob,
    });
    const out = await run(t, { ...baseInput, acknowledgeCost: true });
    expect(out).toMatchObject({ code: ApiCode.ENTITY_LOCKED_BY_JOB });
    expect(createJob).not.toHaveBeenCalled();
  });
});

// #811: the lock gate refuses this tool before it runs (and so before the
// cost gate inside it admits the call), reading the entity id from the
// tool's real input through `TOOL_AUTHORIZATION`'s `entityIdArgs`.
describe("BulkGeocodeRecordsTool — behind the lock gate (#811)", () => {
  it("is refused before it runs when its entity is locked", async () => {
    const assertNoneRunning = jest
      .spyOn(JobLockService, "assertNoneRunning")
      .mockRejectedValue(
        new ApiError(
          409,
          ApiCode.ENTITY_LOCKED_BY_JOB,
          "Revalidation is running on this entity."
        )
      );
    const countRecords = jest.fn(async () => 10);
    const createJob = jest.fn(async () => ({ id: "job-x" }));
    const assertUnlocked = jest.fn(async () => {});
    try {
      const tools = {
        bulk_geocode_records: build({
          countRecords,
          createJob,
          assertUnlocked,
        }),
      };
      wrapWithLockGate(
        tools as never,
        { organizationId: "org-1" },
        (name) => TOOL_AUTHORIZATION[name]
      );

      const out = await run(tools.bulk_geocode_records, {
        ...baseInput,
        acknowledgeCost: true,
      });

      expect(out).toEqual({
        error: expect.objectContaining({ code: ApiCode.ENTITY_LOCKED_BY_JOB }),
      });
      expect(assertNoneRunning).toHaveBeenCalledWith(
        [{ kind: "connectorEntity", id: "ce_parcels" }],
        { organizationId: "org-1" }
      );
      // The tool body never ran.
      expect(assertUnlocked).not.toHaveBeenCalled();
      expect(countRecords).not.toHaveBeenCalled();
      expect(createJob).not.toHaveBeenCalled();
    } finally {
      assertNoneRunning.mockRestore();
    }
  });
});
