import { INTERNAL_ERROR_MESSAGE } from "@portalai/core/constants";

import {
  emptyPayload,
  loadErrorFixture,
  loadRunningJobFixture,
  withRunningJob,
} from "../lib/a11y-states.js";

describe("emptyPayload", () => {
  it("empties every list in the payload and zeroes its totals and counts", () => {
    expect(
      emptyPayload({
        success: true,
        payload: {
          stations: [{ id: "a" }, { id: "b" }],
          total: 2,
          count: 2,
          sortBy: "created",
        },
      })
    ).toEqual({
      success: true,
      payload: { stations: [], total: 0, count: 0, sortBy: "created" },
    });
  });

  it("empties a payload that is itself a list", () => {
    expect(emptyPayload({ success: true, payload: [1, 2] })).toEqual({
      success: true,
      payload: [],
    });
  });

  it("leaves a body without a payload alone", () => {
    expect(emptyPayload({ success: false, code: "X" })).toEqual({
      success: false,
      code: "X",
    });
  });
});

describe("withRunningJob", () => {
  it("adds the fixture job to the running-jobs list", () => {
    const job = loadRunningJobFixture();
    const out = withRunningJob(
      { success: true, payload: { runningJobs: [] } },
      job
    ) as {
      payload: { runningJobs: unknown[] };
    };
    expect(out.payload.runningJobs).toEqual([job]);
  });

  it("refuses a body with no running-jobs list rather than faking one", () => {
    expect(() =>
      withRunningJob({ success: true, payload: {} }, loadRunningJobFixture())
    ).toThrow(/runningJobs/);
  });
});

describe("fixtures", () => {
  it("the running job parses against core's job schema and is non-terminal", () => {
    const job = loadRunningJobFixture();
    expect(["pending", "active", "awaiting_confirmation", "stalled"]).toContain(
      job.status
    );
  });

  it("the error body is the API's 500 envelope", () => {
    const body = loadErrorFixture();
    expect(body.success).toBe(false);
    expect(body.message).toBe(INTERNAL_ERROR_MESSAGE);
    expect(typeof body.code).toBe("string");
  });
});
