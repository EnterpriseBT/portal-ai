/**
 * useWidgetRefresh (#270, promoted + widened in #312, #640): message-block
 * refs refresh through the widget-refresh endpoint, freshness-gated. A pin
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

const STALE = Date.now() - VIZ_REFRESH_FRESHNESS_MS - 60_000;

// Unique refs per test so the module-level freshness map doesn't leak
// hydration timestamps across cases.
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
  it("a stale message ref auto-refreshes through the widget-refresh endpoint", async () => {
    widgetRefreshMutate.mockResolvedValue(FRESH_ROWS);
    const ref = messageRef();
    const { result } = renderHook(() => useWidgetRefresh(ref, STALE));

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
    const { result } = renderHook(() => useWidgetRefresh(messageRef(), STALE));

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
    const { result } = renderHook(() => useWidgetRefresh(messageRef(), STALE));

    await waitFor(() => expect(result.current.notRefreshable).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it("no ref → no refresh at all", async () => {
    const { result } = renderHook(() => useWidgetRefresh(undefined, STALE));
    act(() => result.current.refresh());
    expect(widgetRefreshMutate).not.toHaveBeenCalled();
    expect(result.current.allowed).toBe(false);
  });
});

describe("useWidgetRefresh — pins read live data (#640)", () => {
  it("a pin's data is its live query, never the widget-refresh endpoint", async () => {
    const ref = pinRef();
    pinQuery = { ...pinQuery, data: FRESH_ROWS, dataUpdatedAt: 1234 };
    const { result } = renderHook(() => useWidgetRefresh(ref, STALE));

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
    const { result } = renderHook(() => useWidgetRefresh(pinRef(), STALE));
    expect(result.current.allowed).toBe(true);
    act(() => result.current.refresh());
    expect(pinQuery.refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the query's fetch as refreshing", () => {
    pinQuery = { ...pinQuery, isFetching: true };
    const { result } = renderHook(() => useWidgetRefresh(pinRef(), STALE));
    expect(result.current.isRefreshing).toBe(true);
  });

  it("a pin with no stored query is not refreshable, not an error", () => {
    pinQuery = {
      ...pinQuery,
      error: { code: "PORTAL_RESULT_NOT_REEXECUTABLE", message: "x" },
    };
    const { result } = renderHook(() => useWidgetRefresh(pinRef(), STALE));
    expect(result.current.notRefreshable).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("an unavailable pin is the view's state, not the widget's error", () => {
    pinQuery = {
      ...pinQuery,
      error: { code: "PORTAL_RESULT_DATA_UNAVAILABLE", message: "x" },
    };
    const { result } = renderHook(() => useWidgetRefresh(pinRef(), STALE));
    expect(result.current.error).toBeNull();
    expect(result.current.fresh).toBeNull();
  });

  it("an unexpected failure is the widget's error", () => {
    pinQuery = {
      ...pinQuery,
      error: { code: "PORTAL_SQL_UNAVAILABLE", message: "down" },
    };
    const { result } = renderHook(() => useWidgetRefresh(pinRef(), STALE));
    expect(result.current.error).toMatchObject({
      code: "PORTAL_SQL_UNAVAILABLE",
    });
  });
});
