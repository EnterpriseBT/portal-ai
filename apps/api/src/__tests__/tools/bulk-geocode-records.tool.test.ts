import { describe, it, expect, jest } from "@jest/globals";

import { BulkGeocodeRecordsTool } from "../../tools/bulk-geocode-records.tool.js";
import type { BulkGeocodeToolDeps } from "../../tools/bulk-geocode-records.tool.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

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
    deps
  );
}

describe("BulkGeocodeRecordsTool (#315)", () => {
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
          ApiCode.BULK_JOB_TARGET_LOCKED,
          "entity is locked by a running job"
        );
      },
      countRecords: async () => 5,
      createJob,
    });
    const out = await run(t, { ...baseInput, acknowledgeCost: true });
    expect(out).toMatchObject({ code: ApiCode.BULK_JOB_TARGET_LOCKED });
    expect(createJob).not.toHaveBeenCalled();
  });
});
