import { describe, it, expect, jest, afterEach } from "@jest/globals";
import type pino from "pino";

import { PortalSqlService } from "../../services/portal-sql.service.js";
import { requestContext } from "../../utils/request-context.util.js";

// A fresh store per run — the memo must not leak across requests.
const newStore = () => ({ log: {} as pino.Logger });

// An empty granted-view set — buildViewsForSession then produces only the
// string-built _meta_* views (no per-view DB work), so the only observable DB
// call is resolveGrantedViewColumns, which we spy on.
function mockResolution() {
  return jest
    .spyOn(PortalSqlService, "resolveGrantedViewColumns")
    .mockResolvedValue({
      set: { canPerformAny: () => false } as never,
      views: [],
    } as never);
}

describe("resolveViewsForSession request memo (#647)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves grants once for two calls within one request", async () => {
    const spy = mockResolution();
    await requestContext.run(newStore(), async () => {
      await PortalSqlService.resolveViewsForSession("s1", "org1", "u1");
      await PortalSqlService.resolveViewsForSession("s1", "org1", "u1");
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("resolves per-call when there is no request context", async () => {
    const spy = mockResolution();
    await PortalSqlService.resolveViewsForSession("s1", "org1", "u1");
    await PortalSqlService.resolveViewsForSession("s1", "org1", "u1");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("keys the memo by (station, user, org) — a different caller re-resolves", async () => {
    const spy = mockResolution();
    await requestContext.run(newStore(), async () => {
      await PortalSqlService.resolveViewsForSession("s1", "org1", "u1");
      await PortalSqlService.resolveViewsForSession("s1", "org1", "u2");
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("bypasses the memo for a non-default client (needs that client's visibility)", async () => {
    const spy = mockResolution();
    const txClient = {} as never;
    await requestContext.run(newStore(), async () => {
      await PortalSqlService.resolveViewsForSession(
        "s1",
        "org1",
        "u1",
        txClient
      );
      await PortalSqlService.resolveViewsForSession(
        "s1",
        "org1",
        "u1",
        txClient
      );
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
