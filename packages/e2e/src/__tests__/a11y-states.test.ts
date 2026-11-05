import type { Page, Route } from "@playwright/test";

import {
  apiPathMatcher,
  applyState,
  emptyPayload,
  ERROR_STATUS,
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

  it("the error body is the API's error envelope", () => {
    const body = loadErrorFixture();
    expect(body.success).toBe(false);
    expect(typeof body.message).toBe("string");
    expect(typeof body.code).toBe("string");
  });

  // The app's query client retries a 5xx three times with backoff (~14s) and
  // never a 4xx (apps/web/src/client.ts shouldRetry), so a 4xx shows the
  // error UI at once. The UI is the same component for both.
  it("the error status is a 4xx the app's query client doesn't retry", () => {
    expect(ERROR_STATUS).toBeGreaterThanOrEqual(400);
    expect(ERROR_STATUS).toBeLessThan(500);
    expect([401, 403, 404, 429]).not.toContain(ERROR_STATUS);
  });
});

describe("apiPathMatcher", () => {
  it("matches API requests by path, never the app's own source modules", () => {
    const list = apiPathMatcher("/api/stations*");
    expect(list(new URL("http://localhost:3000/api/stations?limit=10"))).toBe(
      true
    );
    expect(list(new URL("http://localhost:3000/api/stations"))).toBe(true);
    expect(list(new URL("http://localhost:3000/src/api/stations.api.ts"))).toBe(
      false
    );
    expect(list(new URL("http://localhost:3000/api/stations/abc"))).toBe(false);
  });

  it("matches one path segment per *", () => {
    const one = apiPathMatcher("/api/connector-entities/*");
    expect(one(new URL("http://x/api/connector-entities/abc"))).toBe(true);
    expect(one(new URL("http://x/api/connector-entities/abc/records"))).toBe(
      false
    );
    const jobs = apiPathMatcher("/api/connector-entities/*/running-jobs");
    expect(
      jobs(new URL("http://x/api/connector-entities/abc/running-jobs"))
    ).toBe(true);
  });

  it("refuses a pattern that isn't anchored at /api/", () => {
    expect(() => apiPathMatcher("**/api/stations*")).toThrow(/\/api\//);
  });
});

describe("applyState", () => {
  /** A Page that records its one route handler, and Routes that record how
   *  they were answered. */
  function fakePage() {
    let handler: ((route: Route) => Promise<void>) | undefined;
    const page = {
      route: async (_m: unknown, h: (route: Route) => Promise<void>) => {
        handler = h;
      },
    } as unknown as Page;
    const route = (path: string) => {
      const calls: string[] = [];
      const r = {
        request: () => ({ url: () => `http://localhost:3000${path}` }),
        fulfill: async (o: { status: number }) =>
          void calls.push(`fulfill ${o.status}`),
        continue: async () => void calls.push("continue"),
      } as unknown as Route;
      return { r, calls };
    };
    return { page, route, fire: (r: Route) => handler!(r) };
  }

  it("counts the requests it handled, so a pattern that matched nothing can be told apart", async () => {
    const { page, route, fire } = fakePage();
    const state = await applyState(page, "error", "/api/stations");
    expect(state.handled()).toBe(0);
    const { r, calls } = route("/api/stations");
    await fire(r);
    expect(state.handled()).toBe(1);
    expect(calls).toEqual([`fulfill ${ERROR_STATUS}`]);
  });

  it("counts a held loading request as handled, and lets it through on release", async () => {
    const { page, route, fire } = fakePage();
    const state = await applyState(page, "loading", "/api/stations");
    const { r, calls } = route("/api/stations");
    await fire(r);
    expect(state.handled()).toBe(1);
    expect(calls).toEqual([]);
    state.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toEqual(["continue"]);
  });
});
