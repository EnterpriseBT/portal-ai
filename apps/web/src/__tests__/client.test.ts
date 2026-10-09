import { describe, it, expect } from "@jest/globals";

import { queryClient } from "../client";
import { ApiError } from "../utils/api.util";

/**
 * The retry predicates on the shared query client. A 4xx is a verdict about
 * the request, so re-issuing it cannot change the answer — retrying one only
 * delays the error the user needs to see, and repeats whatever work the
 * server already did to reject it. 5xx keeps its retries.
 */
type RetryFn = (failureCount: number, error: Error) => boolean;
type DelayFn = (failureCount: number, error: Error) => number;

/** A `429 API_RATE_LIMITED` as `fetchWithAuth` builds it (#747). */
function rateLimited(seconds: number): ApiError {
  const err = new ApiError(
    `Too many requests. Try again in ${seconds} seconds.`,
    "API_RATE_LIMITED",
    429,
    { retryAfterSeconds: seconds }
  );
  err.retryAfterSeconds = seconds;
  return err;
}

function retryPredicates(): { queries: RetryFn; mutations: RetryFn } {
  const defaults = queryClient.getDefaultOptions();
  const queries = defaults.queries?.retry as RetryFn | undefined;
  const mutations = defaults.mutations?.retry as RetryFn | undefined;
  if (typeof queries !== "function" || typeof mutations !== "function") {
    throw new Error("expected both retry options to be functions");
  }
  return { queries, mutations };
}

describe("queryClient retry policy", () => {
  it("does not retry a 409 — the state conflict is deterministic", () => {
    const { queries, mutations } = retryPredicates();
    const err = new ApiError(
      "This Microsoft account has no OneDrive.",
      "MICROSOFT_EXCEL_NO_ONEDRIVE",
      409
    );
    expect(queries(0, err)).toBe(false);
    expect(mutations(0, err)).toBe(false);
  });

  it("does not retry a 404", () => {
    const { queries, mutations } = retryPredicates();
    const err = new ApiError("Not found", "CONNECTOR_INSTANCE_NOT_FOUND", 404);
    expect(queries(0, err)).toBe(false);
    expect(mutations(0, err)).toBe(false);
  });

  it("still retries a 502 up to three failures", () => {
    const { queries, mutations } = retryPredicates();
    const err = new ApiError(
      "Microsoft Graph children failed (502)",
      "MICROSOFT_EXCEL_LIST_FAILED",
      502
    );
    expect(queries(0, err)).toBe(true);
    expect(queries(2, err)).toBe(true);
    expect(queries(3, err)).toBe(false);
    expect(mutations(0, err)).toBe(true);
  });

  it("keeps the pre-existing 401 and ORGANIZATION_USER_NOT_FOUND opt-outs", () => {
    const { queries, mutations } = retryPredicates();
    const unauthorized = new ApiError("Unauthorized", "UNAUTHORIZED", 401);
    const noOrgUser = new ApiError(
      "No membership",
      "ORGANIZATION_USER_NOT_FOUND",
      // Deliberately a 5xx: the code alone must veto the retry, independent
      // of status.
      500
    );
    expect(queries(0, unauthorized)).toBe(false);
    expect(mutations(0, unauthorized)).toBe(false);
    expect(queries(0, noOrgUser)).toBe(false);
    expect(mutations(0, noOrgUser)).toBe(false);
  });

  // #747: the API bucket's 429 is the one 4xx whose answer changes with time.
  it("retries a query on API_RATE_LIMITED up to three failures", () => {
    const { queries } = retryPredicates();
    const err = rateLimited(30);
    expect(queries(0, err)).toBe(true);
    expect(queries(2, err)).toBe(true);
    expect(queries(3, err)).toBe(false);
  });

  it("never retries a mutation on API_RATE_LIMITED — no write is resent", () => {
    const { mutations } = retryPredicates();
    expect(mutations(0, rateLimited(30))).toBe(false);
  });

  it("does not retry a map-tile or codeless 429", () => {
    const { queries } = retryPredicates();
    const tile = new ApiError(
      "Too many map tile requests.",
      "MAP_TILE_RATE_LIMITED",
      429
    );
    const codeless = new ApiError("Too Many Requests", "", 429);
    expect(queries(0, tile)).toBe(false);
    expect(queries(0, codeless)).toBe(false);
  });

  it("retries a non-ApiError failure (network blip) up to three times", () => {
    const { queries } = retryPredicates();
    const err = new Error("network down");
    expect(queries(0, err)).toBe(true);
    expect(queries(3, err)).toBe(false);
  });
});

describe("queryClient query retry delay (#747)", () => {
  function queryDelay(): DelayFn {
    const delay = queryClient.getDefaultOptions().queries?.retryDelay;
    if (typeof delay !== "function") {
      throw new Error("expected queries.retryDelay to be a function");
    }
    return delay as DelayFn;
  }

  it("waits out the rate-limit window the server named", () => {
    expect(queryDelay()(0, rateLimited(42))).toBe(42_000);
  });

  it("keeps react-query's exponential backoff for everything else", () => {
    const err = new ApiError("Bad gateway", "UPSTREAM_FAILED", 502);
    expect(queryDelay()(0, err)).toBe(1_000);
    expect(queryDelay()(1, err)).toBe(2_000);
    expect(queryDelay()(10, err)).toBe(30_000);
  });
});
