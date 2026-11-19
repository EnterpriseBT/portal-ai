/**
 * useWidgetRefresh (#270, promoted + widened in #312, #640, #1038): a stored
 * message block keeps no rows, so it reads through the widget-refresh
 * endpoint on every mount and shows only what that read returns. A pin
 * stores no data (#640): its data is always the live `portalResults.data`
 * query, readable by every reader of the pin.
 */
import { jest } from "@jest/globals";
import { renderHook, waitFor, act } from "@testing-library/react";

import { VIZ_REFRESH_FRESHNESS_MS } from "@portalai/core/constants";
import type { BlockRef } from "@portalai/core";
import type { WidgetRefreshResponse } from "@portalai/core/contracts";

const widgetRefreshMutate =
  jest.fn<
    (vars: {
      messageId: string;
      blockIndex: number;
    }) => Promise<WidgetRefreshResponse>
  >();

/** What the mocked `portalResults.data` query returns; set per test. */
let pinQuery: {
  data?: WidgetRefreshResponse;
  error: { code: string; message: string } | null;
  isFetching: boolean;
  dataUpdatedAt: number;
  refetch: jest.Mock;
};
const pinDataCalls: { id: string; enabled: boolean | undefined }[] = [];

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portalSql: {
      widgetRefresh: () => ({ mutateAsync: widgetRefreshMutate }),
    },
    portalResults: {
      data: (id: string, options?: { enabled?: boolean }) => {
        pinDataCalls.push({ id, enabled: options?.enabled });
        return pinQuery;
      },
    },
  },
}));

const { useWidgetRefresh } = await import("../utils/use-widget-refresh.util");

const FRESH_ROWS: WidgetRefreshResponse = {
  kind: "inline",
  rows: [{ x: 1 }],
};

let seq = 0;
const messageRef = (): BlockRef => ({
  kind: "message",
  messageId: `msg-${++seq}`,
  blockIndex: 1,
});
const pinRef = (): BlockRef => ({
  kind: "pin",
  portalResultId: `pr-${++seq}`,
});

beforeEach(() => {
  widgetRefreshMutate.mockReset();
  pinDataCalls.length = 0;
  pinQuery = {
    data: undefined,
    error: null,
    isFetching: false,
    dataUpdatedAt: 0,
    refetch: jest.fn(),
  };
});

describe("useWidgetRefresh — message blocks (#270)", () => {
  it("a message ref reads through the widget-refresh endpoint on mount", async () => {
    widgetRefreshMutate.mockResolvedValue(FRESH_ROWS);
    const ref = messageRef();
    const { result } = renderHook(() => useWidgetRefresh(ref));

    await waitFor(() => expect(result.current.fresh).toEqual(FRESH_ROWS));
    expect(widgetRefreshMutate).toHaveBeenCalledWith({
      messageId: ref.kind === "message" ? ref.messageId : "",
      blockIndex: 1,
    });
    // The pin query stays off for a message block.
    expect(pinDataCalls.every((c) => c.enabled === false)).toBe(true);
  });

  it("a failed refresh surfaces the error and keeps fresh null (regression)", async () => {
    widgetRefreshMutate.mockRejectedValue(
      Object.assign(new Error("boom"), { code: "UNKNOWN" })
    );
    const { result } = renderHook(() => useWidgetRefresh(messageRef()));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.fresh).toBeNull();
    expect(result.current.isRefreshing).toBe(false);
  });

  it("a 422 marks the widget not refreshable instead of erroring (regression)", async () => {
    widgetRefreshMutate.mockRejectedValue(
      Object.assign(new Error("no pipeline"), {
        code: "VIZ_WIDGET_NOT_REFRESHABLE",
      })
    );
    const { result } = renderHook(() => useWidgetRefresh(messageRef()));

    await waitFor(() => expect(result.current.notRefreshable).toBe(true));
    expect(result.current.error).toBeNull();
  });

  // #1038 review: a remount within the freshness window (the gate re-mounts a
  // widget scrolled back into view) reuses this tab's last read; after the
  // window it reads again. Nothing is stored: a new tab starts empty.
  it("reuses its last read on a remount inside the window, and reads again after", async () => {
    widgetRefreshMutate.mockResolvedValue(FRESH_ROWS);
    const ref = messageRef();
    const first = renderHook(() => useWidgetRefresh(ref));
    await waitFor(() => expect(first.result.current.fresh).toEqual(FRESH_ROWS));
    first.unmount();

    const second = renderHook(() => useWidgetRefresh(ref));
    expect(second.result.current.fresh).toEqual(FRESH_ROWS);
    expect(second.result.current.lastUpdatedAt).not.toBeNull();
    expect(widgetRefreshMutate).toHaveBeenCalledTimes(1);
    second.unmount();

    const realNow = Date.now;
    Date.now = () => realNow() + VIZ_REFRESH_FRESHNESS_MS + 1_000;
    try {
      const third = renderHook(() => useWidgetRefresh(ref));
      await waitFor(() => expect(widgetRefreshMutate).toHaveBeenCalledTimes(2));
      third.unmount();
    } finally {
      Date.now = realNow;
    }
  });

  it("forgets a read once the reader loses access", async () => {
    const ref = messageRef();
    widgetRefreshMutate.mockResolvedValueOnce(FRESH_ROWS);
    const first = renderHook(() => useWidgetRefresh(ref));
    await waitFor(() => expect(first.result.current.fresh).toEqual(FRESH_ROWS));
    widgetRefreshMutate.mockRejectedValueOnce(
      Object.assign(new Error("gone"), { code: "VIZ_WIDGET_DATA_UNAVAILABLE" })
    );
    act(() => first.result.current.refresh());
    await waitFor(() => expect(first.result.current.unavailable).toBe(true));
    first.unmount();

    widgetRefreshMutate.mockResolvedValueOnce(FRESH_ROWS);
    const second = renderHook(() => useWidgetRefresh(ref));
    expect(second.result.current.fresh).toBeNull();
    await waitFor(() => expect(widgetRefreshMutate).toHaveBeenCalledTimes(3));
  });

  it("shows no time until a read completes, then the time of that read (#1038)", async () => {
    let resolve!: (r: WidgetRefreshResponse) => void;
    widgetRefreshMutate.mockReturnValue(
      new Promise<WidgetRefreshResponse>((r) => (resolve = r))
    );
    const before = Date.now();
    const { result } = renderHook(() => useWidgetRefresh(messageRef()));
    expect(result.current.lastUpdatedAt).toBeNull();

    await act(async () => resolve(FRESH_ROWS));

    expect(result.current.lastUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  it("a lost-access 422 marks the widget unavailable and drops an earlier read (#1038)", async () => {
    widgetRefreshMutate.mockResolvedValueOnce(FRESH_ROWS);
    const { result } = renderHook(() => useWidgetRefresh(messageRef()));
    await waitFor(() => expect(result.current.fresh).toEqual(FRESH_ROWS));

    widgetRefreshMutate.mockRejectedValueOnce(
      Object.assign(new Error("gone"), {
        code: "VIZ_WIDGET_DATA_UNAVAILABLE",
      })
    );
    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.fresh).toBeNull();
    expect(result.current.lastUpdatedAt).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("no ref → no refresh at all", async () => {
    const { result } = renderHook(() => useWidgetRefresh(undefined));
    act(() => result.current.refresh());
    expect(widgetRefreshMutate).not.toHaveBeenCalled();
    expect(result.current.allowed).toBe(false);
  });
});

describe("useWidgetRefresh — pins read live data (#640)", () => {
  it("a pin's data is its live query, never the widget-refresh endpoint", async () => {
    const ref = pinRef();
    pinQuery = { ...pinQuery, data: FRESH_ROWS, dataUpdatedAt: 1234 };
    const { result } = renderHook(() => useWidgetRefresh(ref));

    expect(result.current.fresh).toEqual(FRESH_ROWS);
    expect(result.current.lastUpdatedAt).toBe(1234);
    expect(pinDataCalls[pinDataCalls.length - 1]).toEqual({
      id: ref.kind === "pin" ? ref.portalResultId : "",
      enabled: true,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(widgetRefreshMutate).not.toHaveBeenCalled();
  });

  it("every reader may refresh a pin; the button refetches its query", () => {
    const { result } = renderHook(() => useWidgetRefresh(pinRef()));
    expect(result.current.allowed).toBe(true);
    act(() => result.current.refresh());
    expect(pinQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the query's fetch as refreshing", () => {
    pinQuery = { ...pinQuery, isFetching: true };
    const { result } = renderHook(() => useWidgetRefresh(pinRef()));
    expect(result.current.isRefreshing).toBe(true);
  });

  it("a pin with no stored query is not refreshable, not an error", () => {
    pinQuery = {
      ...pinQuery,
      error: { code: "PORTAL_RESULT_NOT_REEXECUTABLE", message: "x" },
    };
    const { result } = renderHook(() => useWidgetRefresh(pinRef()));
    expect(result.current.notRefreshable).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("an unavailable pin is the view's state, not the widget's error", () => {
    pinQuery = {
      ...pinQuery,
      error: { code: "PORTAL_RESULT_DATA_UNAVAILABLE", message: "x" },
    };
    const { result } = renderHook(() => useWidgetRefresh(pinRef()));
    expect(result.current.error).toBeNull();
    expect(result.current.fresh).toBeNull();
  });

  it("an unexpected failure is the widget's error", () => {
    pinQuery = {
      ...pinQuery,
      error: { code: "PORTAL_SQL_UNAVAILABLE", message: "down" },
    };
    const { result } = renderHook(() => useWidgetRefresh(pinRef()));
    expect(result.current.error).toMatchObject({
      code: "PORTAL_SQL_UNAVAILABLE",
    });
  });
});
