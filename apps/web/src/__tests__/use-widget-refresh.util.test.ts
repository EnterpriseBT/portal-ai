/**
 * useWidgetRefresh (#270, promoted + widened in #312): freshness-gated
 * refresh keyed by a discriminated BlockRef — message-block refs dispatch to
 * the widget-refresh endpoint, pin refs to the pinned-result refresh
 * endpoint. Session freshness keys never collide across kinds.
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
const pinRefreshMutate =
  jest.fn<(vars: { id: string }) => Promise<WidgetRefreshResponse>>();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portalSql: {
      widgetRefresh: () => ({ mutateAsync: widgetRefreshMutate }),
    },
    portalResults: {
      refresh: () => ({ mutateAsync: pinRefreshMutate }),
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
  pinRefreshMutate.mockReset();
});

describe("useWidgetRefresh — BlockRef dispatch (#312)", () => {
  it("a message ref auto-refreshes through the widget-refresh endpoint", async () => {
    widgetRefreshMutate.mockResolvedValue(FRESH_ROWS);
    const ref = messageRef();
    const { result } = renderHook(() => useWidgetRefresh(ref, STALE));

    await waitFor(() => expect(result.current.fresh).toEqual(FRESH_ROWS));
    expect(widgetRefreshMutate).toHaveBeenCalledWith({
      messageId: ref.kind === "message" ? ref.messageId : "",
      blockIndex: 1,
    });
    expect(pinRefreshMutate).not.toHaveBeenCalled();
  });

  it("a pin ref auto-refreshes through the pinned-result endpoint", async () => {
    pinRefreshMutate.mockResolvedValue(FRESH_ROWS);
    const ref = pinRef();
    const { result } = renderHook(() => useWidgetRefresh(ref, STALE));

    await waitFor(() => expect(result.current.fresh).toEqual(FRESH_ROWS));
    expect(pinRefreshMutate).toHaveBeenCalledWith({
      id: ref.kind === "pin" ? ref.portalResultId : "",
    });
    expect(widgetRefreshMutate).not.toHaveBeenCalled();
  });

  it("freshness keys never collide across ref kinds", async () => {
    widgetRefreshMutate.mockResolvedValue(FRESH_ROWS);
    pinRefreshMutate.mockResolvedValue(FRESH_ROWS);

    // Hydrate a message ref — its freshness entry must not satisfy a pin ref.
    const mRef = messageRef();
    const first = renderHook(() => useWidgetRefresh(mRef, STALE));
    await waitFor(() => expect(widgetRefreshMutate).toHaveBeenCalledTimes(1));
    first.unmount();

    const pRef = pinRef();
    renderHook(() => useWidgetRefresh(pRef, STALE));
    await waitFor(() => expect(pinRefreshMutate).toHaveBeenCalledTimes(1));
  });

  it("a failed refresh surfaces the error and keeps fresh null (regression)", async () => {
    pinRefreshMutate.mockRejectedValue(
      Object.assign(new Error("boom"), { code: "UNKNOWN" })
    );
    const { result } = renderHook(() => useWidgetRefresh(pinRef(), STALE));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.fresh).toBeNull();
    expect(result.current.isRefreshing).toBe(false);
  });

  it("a 422 marks the widget not refreshable instead of erroring (regression)", async () => {
    const notRefreshable = Object.assign(new Error("no pipeline"), {
      code: "VIZ_WIDGET_NOT_REFRESHABLE",
    });
    pinRefreshMutate.mockRejectedValue(notRefreshable);
    const { result } = renderHook(() => useWidgetRefresh(pinRef(), STALE));

    await waitFor(() => expect(result.current.notRefreshable).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it("no ref → no refresh at all", async () => {
    const { result } = renderHook(() => useWidgetRefresh(undefined, STALE));
    act(() => result.current.refresh());
    expect(widgetRefreshMutate).not.toHaveBeenCalled();
    expect(pinRefreshMutate).not.toHaveBeenCalled();
  });
});
