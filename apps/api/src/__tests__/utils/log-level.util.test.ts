import { describe, it, expect } from "@jest/globals";

import { isExpectedBackpressure } from "../../utils/log-level.util.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

describe("isExpectedBackpressure (#698)", () => {
  it("treats MAP_TILE_BUSY as expected backpressure, not an error", () => {
    expect(
      isExpectedBackpressure(new ApiError(503, ApiCode.MAP_TILE_BUSY, "busy"))
    ).toBe(true);
  });

  it("keeps a pool-exhaustion signal (DB_ADMISSION_TIMEOUT) and real failures as errors", () => {
    expect(
      isExpectedBackpressure(
        new ApiError(503, ApiCode.DB_ADMISSION_TIMEOUT, "busy")
      )
    ).toBe(false);
    expect(
      isExpectedBackpressure(
        new ApiError(504, ApiCode.MAP_TILE_TIMEOUT, "slow")
      )
    ).toBe(false);
    expect(isExpectedBackpressure(new Error("boom"))).toBe(false);
    expect(isExpectedBackpressure(undefined)).toBe(false);
  });

  it("treats a spent map-tile bucket (MAP_TILE_RATE_LIMITED) as expected backpressure (#705)", () => {
    expect(
      isExpectedBackpressure(
        new ApiError(429, ApiCode.MAP_TILE_RATE_LIMITED, "slow down")
      )
    ).toBe(true);
  });

  it("keeps the API bucket (API_RATE_LIMITED) an error: a runaway client should alert (#705)", () => {
    expect(
      isExpectedBackpressure(
        new ApiError(429, ApiCode.API_RATE_LIMITED, "slow down")
      )
    ).toBe(false);
  });

  it("keeps the anonymous site limiter (SITE_CONFIG_RATE_LIMITED) as an error (#705)", () => {
    expect(
      isExpectedBackpressure(
        new ApiError(429, ApiCode.SITE_CONFIG_RATE_LIMITED, "scraper")
      )
    ).toBe(false);
  });
});
