import { jest } from "@jest/globals";
import React from "react";

const mockOrg = jest.fn<() => unknown>(() => ({
  data: { organization: { id: "org-1" } },
}));
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { organizations: { current: () => mockOrg() } },
}));

const { renderHook, act } = await import("@testing-library/react");
const { AuthContext } = await import("../providers/Auth.provider");
const {
  RECENT_VISITS_MAX,
  pruneVisits,
  recentVisitsKey,
  recordVisit,
  useRecentVisits,
  useRecordRecentVisit,
} = await import("../utils/use-recent-visits.util");

const authWith = (sub?: string) =>
  ({
    session: {
      user: sub ? { sub, name: "Ada" } : { name: "Ada" },
      isAuthenticated: true,
      isLoading: false,
      error: undefined,
    },
  }) as never;

const wrapper =
  (sub?: string) =>
  ({ children }: { children: React.ReactNode }) => (
    <AuthContext.Provider value={authWith(sub)}>
      {children}
    </AuthContext.Provider>
  );

const KEY = recentVisitsKey("org-1", "auth0|ada");

beforeEach(() => {
  localStorage.clear();
  mockOrg.mockReturnValue({ data: { organization: { id: "org-1" } } });
});

describe("Recent visits (#1076)", () => {
  it("records newest first, once per object, at most 20", () => {
    let list = recordVisit([], { type: "station", id: "s1", visitedAt: 1 });
    list = recordVisit(list, { type: "pin", id: "p1", visitedAt: 2 });
    list = recordVisit(list, { type: "station", id: "s1", visitedAt: 3 });
    expect(list.map((v) => `${v.type}:${v.id}`)).toEqual([
      "station:s1",
      "pin:p1",
    ]);
    for (let i = 0; i < 30; i++) {
      list = recordVisit(list, { type: "entity", id: `e${i}`, visitedAt: i });
    }
    expect(list).toHaveLength(RECENT_VISITS_MAX);
    expect(list[0].id).toBe("e29");
  });

  it("prunes to what the server still returned", () => {
    const list = [
      { type: "station" as const, id: "s1", visitedAt: 2 },
      { type: "pin" as const, id: "p1", visitedAt: 1 },
    ];
    expect(pruneVisits(list, new Set(["pin:p1"]))).toEqual([list[1]]);
  });

  it("keys the store by org and user", () => {
    expect(KEY).toBe("portalai-recent:org-1:auth0|ada");
  });

  it("records a loaded object under its own org and reads it back", () => {
    renderHook(
      () =>
        useRecordRecentVisit("station", { id: "s1", organizationId: "org-1" }),
      { wrapper: wrapper("auth0|ada") }
    );
    const { result } = renderHook(() => useRecentVisits(), {
      wrapper: wrapper("auth0|ada"),
    });
    expect(result.current.visits.map((v) => v.id)).toEqual(["s1"]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
  });

  it("records nothing for an object that didn't load", () => {
    renderHook(() => useRecordRecentVisit("station", undefined), {
      wrapper: wrapper("auth0|ada"),
    });
    expect(localStorage.length).toBe(0);
  });

  it("neither reads nor writes before the user and org are known", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ type: "station", id: "s1", visitedAt: 1 }])
    );
    const noUser = renderHook(() => useRecentVisits(), { wrapper: wrapper() });
    expect(noUser.result.current.visits).toEqual([]);
    act(() => noUser.result.current.record({ type: "pin", id: "p1" }));

    mockOrg.mockReturnValue({ data: undefined });
    const noOrg = renderHook(() => useRecentVisits(), {
      wrapper: wrapper("auth0|ada"),
    });
    expect(noOrg.result.current.visits).toEqual([]);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
  });

  it("keeps another org's visits apart", () => {
    renderHook(
      () =>
        useRecordRecentVisit("station", { id: "s9", organizationId: "org-2" }),
      { wrapper: wrapper("auth0|ada") }
    );
    const { result } = renderHook(() => useRecentVisits(), {
      wrapper: wrapper("auth0|ada"),
    });
    expect(result.current.visits).toEqual([]);
  });

  it("prunes through the hook, and drops malformed entries", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { type: "station", id: "s1", visitedAt: 2 },
        { type: "portal", id: "x", visitedAt: 1 },
        { nope: true },
        { type: "pin", id: "p1", visitedAt: 1 },
      ])
    );
    const { result } = renderHook(() => useRecentVisits(), {
      wrapper: wrapper("auth0|ada"),
    });
    expect(result.current.visits.map((v) => v.id)).toEqual(["s1", "p1"]);
    act(() => result.current.prune(new Set(["pin:p1"])));
    expect(result.current.visits.map((v) => v.id)).toEqual(["p1"]);
  });

  it("reads a storage failure as no visits", () => {
    const spy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const { result } = renderHook(() => useRecentVisits(), {
      wrapper: wrapper("auth0|ada"),
    });
    expect(result.current.visits).toEqual([]);
    spy.mockRestore();
  });
});
