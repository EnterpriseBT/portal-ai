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

  it("retries a non-ApiError failure (network blip) up to three times", () => {
    const { queries } = retryPredicates();
    const err = new Error("network down");
    expect(queries(0, err)).toBe(true);
    expect(queries(3, err)).toBe(false);
  });
});
