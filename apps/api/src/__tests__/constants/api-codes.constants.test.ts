import { describe, it, expect } from "@jest/globals";
import {
  ApiCode,
  ApiCodeDefaultRecommendation,
} from "../../constants/api-codes.constants.js";

// Anchor test for the new ApiCode entries added under #85's large-data-
// ops work. Asserts that each new code exists AND has a corresponding
// default recommendation string so consumers can default cheaply.

const NEW_CODES_PHASE_1: ApiCode[] = [
  ApiCode.BULK_JOB_TARGET_LOCKED,
  ApiCode.BULK_JOB_EXPRESSION_INVALID,
  ApiCode.BULK_JOB_MAX_RECORDS_EXCEEDED,
  ApiCode.BULK_JOB_BATCH_TIMEOUT,
  ApiCode.BULK_JOB_CANCELLED,
  ApiCode.BULK_JOB_PARTIAL_FAILURE,
  ApiCode.READ_HANDLE_EXPIRED,
  ApiCode.READ_STREAM_INTERRUPTED,
  ApiCode.PORTAL_SQL_TIMEOUT,
  ApiCode.BULK_DISPATCH_TOOL_NOT_FOUND,
  ApiCode.BULK_DISPATCH_TOOL_NOT_BULK_DISPATCHABLE,
  ApiCode.BULK_DISPATCH_COST_NOT_ACKNOWLEDGED,
];

describe("Phase 1 ApiCode additions (#85)", () => {
  it.each(NEW_CODES_PHASE_1)("%s is exported on the ApiCode enum", (code) => {
    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(0);
  });

  it.each(NEW_CODES_PHASE_1)(
    "%s has a default recommendation string",
    (code) => {
      const rec = ApiCodeDefaultRecommendation[code];
      expect(typeof rec).toBe("string");
      expect((rec ?? "").length).toBeGreaterThan(0);
    }
  );
});
