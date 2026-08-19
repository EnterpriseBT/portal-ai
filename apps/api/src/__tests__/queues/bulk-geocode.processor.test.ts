import { describe, it, expect, jest } from "@jest/globals";

import { runBulkGeocode } from "../../queues/processors/bulk-geocode.processor.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import type { GeocodingProvider } from "../../services/geocoding/provider.js";

const args = {
  jobId: "job-1",
  connectorEntityId: "ce_parcels",
  sourceColumnKey: "c_address",
  targetColumnKey: "c_geometry",
  organizationId: "org-1",
};

const hit = (lat: number, lng: number) => ({
  lat,
  lng,
  formattedAddress: "x",
  confidence: 0.9,
});

function baseDeps(
  over: Partial<Parameters<typeof runBulkGeocode>[1]> = {}
): Parameters<typeof runBulkGeocode>[1] {
  const provider: GeocodingProvider = {
    name: "mapbox",
    geocode: async () => hit(40, -111),
    reverseGeocode: async () => {
      throw new Error("unused");
    },
  };
  return {
    fetchAddresses: async () => [
      { recordId: "r1", address: "123 Main" },
      { recordId: "r2", address: "456 Oak" },
    ],
    writeGeometry: jest.fn(async () => {}),
    provider,
    cacheGet: async () => null,
    cacheSet: async () => {},
    commitCharge: jest.fn(async () => {}),
    ...over,
  };
}

describe("runBulkGeocode (#315)", () => {
  it("writes a GeoJSON Point per success and bills only the uncached ones, once", async () => {
    const writeGeometry = jest.fn(async () => {});
    const commitCharge = jest.fn(async () => {});
    const onProgress = jest.fn(async () => {});
    // r1 is a cache hit (free); r2 is a live provider hit (billable).
    const cacheGet = jest.fn(async (address: string) =>
      address === "123 Main" ? hit(1, 2) : null
    );
    const result = await runBulkGeocode(
      args,
      baseDeps({ writeGeometry, commitCharge, cacheGet, onProgress })
    );

    expect(result).toMatchObject({
      geocoded: 1,
      cached: 1,
      failed: 0,
      // Widget-count fields: 2 attempted, 0 failed (#315 smoke fix).
      recordsProcessed: 2,
      recordsFailed: 0,
    });
    // Progress reported per record with the running counts.
    expect(onProgress).toHaveBeenCalledWith({
      processed: 2,
      failed: 0,
      total: 2,
    });
    // A Point ([lng, lat]) written for both records.
    expect(writeGeometry).toHaveBeenCalledTimes(2);
    expect(writeGeometry).toHaveBeenCalledWith(
      "ce_parcels",
      "r1",
      "c_geometry",
      { type: "Point", coordinates: [2, 1] }
    );
    // Charged once, for the single uncached success.
    expect(commitCharge).toHaveBeenCalledTimes(1);
    expect(commitCharge).toHaveBeenCalledWith(1);
  });

  it("counts an unresolved address as failed, keeps the row identifiable, still bills the successes", async () => {
    const provider: GeocodingProvider = {
      name: "mapbox",
      geocode: async (address: string) => {
        if (address === "456 Oak")
          throw new ApiError(
            422,
            ApiCode.GEOCODE_ADDRESS_UNRESOLVED,
            "no match"
          );
        return hit(40, -111);
      },
      reverseGeocode: async () => {
        throw new Error("unused");
      },
    };
    const commitCharge = jest.fn(async () => {});
    const result = await runBulkGeocode(
      args,
      baseDeps({ provider, commitCharge })
    );

    expect(result).toMatchObject({ geocoded: 1, cached: 0, failed: 1 });
    expect(result.partialFailures).toEqual([
      {
        sourceKey: "r2",
        error: expect.objectContaining({
          code: ApiCode.GEOCODE_ADDRESS_UNRESOLVED,
        }),
      },
    ]);
    // The one success still bills.
    expect(commitCharge).toHaveBeenCalledWith(1);
  });

  it("a row with no address is a failure, never a silent skip", async () => {
    const result = await runBulkGeocode(
      args,
      baseDeps({
        fetchAddresses: async () => [
          { recordId: "r1", address: null },
          { recordId: "r2", address: "  " },
        ],
      })
    );
    expect(result).toMatchObject({ geocoded: 0, cached: 0, failed: 2 });
    expect(result.partialFailures).toHaveLength(2);
  });

  it("charges 0 when every address is a cache hit (all free)", async () => {
    const commitCharge = jest.fn(async () => {});
    const result = await runBulkGeocode(
      args,
      baseDeps({ cacheGet: async () => hit(1, 2), commitCharge })
    );
    expect(result).toMatchObject({ geocoded: 0, cached: 2 });
    expect(commitCharge).toHaveBeenCalledWith(0);
  });
});

// #410 — the job's terminal status is classified from `recordsSucceeded` by
// `classifyBatchOutcome` at the worker. The processor's job is to report it
// truthfully; a processor that forgets to set it silently keeps the old
// "always completed" behavior, so these are the tests that would notice.
describe("runBulkGeocode reports recordsSucceeded (#410)", () => {
  it("counts a live provider hit and a cache hit as successes", async () => {
    const result = await runBulkGeocode(
      args,
      baseDeps({
        cacheGet: async (address: string) =>
          address === "123 Main" ? hit(1, 2) : null,
      })
    );
    // 1 cached + 1 geocoded = 2 succeeded. A cache hit is free, not absent.
    expect(result).toMatchObject({ geocoded: 1, cached: 1, failed: 0 });
    expect(result.recordsSucceeded).toBe(2);
  });

  it("reports 0 successes when the provider is down for every row", async () => {
    // The exact production shape that reported `Completed`: a 403 on every
    // address. This is what now classifies as `failed`.
    const result = await runBulkGeocode(
      args,
      baseDeps({
        provider: {
          name: "mapbox",
          geocode: async () => {
            throw new ApiError(
              502,
              ApiCode.GEOCODE_PROVIDER_UNAVAILABLE,
              "Geocoding provider returned 403."
            );
          },
          reverseGeocode: async () => {
            throw new Error("unused");
          },
        },
      })
    );
    expect(result).toMatchObject({ geocoded: 0, cached: 0, failed: 2 });
    expect(result.recordsSucceeded).toBe(0);
  });

  it("keeps recordsSucceeded and recordsFailed consistent on a partial run", async () => {
    const result = await runBulkGeocode(
      args,
      baseDeps({
        provider: {
          name: "mapbox",
          geocode: async (address: string) => {
            if (address === "456 Oak") {
              throw new ApiError(
                422,
                ApiCode.GEOCODE_ADDRESS_UNRESOLVED,
                "Only a low-confidence match."
              );
            }
            return hit(40, -111);
          },
          reverseGeocode: async () => {
            throw new Error("unused");
          },
        },
      })
    );
    expect(result.recordsSucceeded).toBe(1);
    expect(result.recordsFailed).toBe(1);
    // Attempted stays the sum — the two fields must not double-count.
    expect(result.recordsProcessed).toBe(2);
  });

  it("reports 0 successes and 0 failures for an empty batch", async () => {
    // Must classify as completed, not failed: a filter matching no rows is
    // not a broken job.
    const result = await runBulkGeocode(
      args,
      baseDeps({ fetchAddresses: async () => [] })
    );
    expect(result.recordsSucceeded).toBe(0);
    expect(result.recordsFailed).toBe(0);
  });
});
