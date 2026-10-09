import { jest, it, expect } from "@jest/globals";

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({}),
}));

const { rateLimitedError } =
  await import("../../utils/rate-limit-refusal.util.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

const minute = 1_700_000_040_000; // a whole minute

it("is a 429 naming the seconds left in the window it was counted in (#705)", () => {
  const err = rateLimitedError(
    ApiCode.API_RATE_LIMITED,
    "Too many requests.",
    minute + 15_500
  );
  expect(err.status).toBe(429);
  expect(err.code).toBe(ApiCode.API_RATE_LIMITED);
  expect(err.message).toBe("Too many requests. Try again in 45 seconds.");
  expect(err.details).toEqual({ retryAfterSeconds: 45 });
});

it("says 1 second, singular", () => {
  const err = rateLimitedError(
    ApiCode.MAP_TILE_RATE_LIMITED,
    "Too many map tile requests.",
    minute + 59_999
  );
  expect(err.message).toBe(
    "Too many map tile requests. Try again in 1 second."
  );
});
