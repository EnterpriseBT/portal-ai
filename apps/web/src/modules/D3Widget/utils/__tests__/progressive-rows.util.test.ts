import { jest } from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";

import type { HandleSnapshotPayload } from "../../../../api/portal-sql.api";

// ── SDK mock ─────────────────────────────────────────────────────────

type SnapshotVars = { handleId: string; offset: number; limit: number };

const mutateAsync =
  jest.fn<(vars: SnapshotVars) => Promise<HandleSnapshotPayload>>();

jest.unstable_mockModule("../../../../api/sdk", () => ({
  sdk: {
    portalSql: {
      handleSnapshotPage: () => ({ mutateAsync }),
    },
  },
}));

const { useProgressiveHandleRows } = await import("../progressive-rows.util");
const { D3_SNAPSHOT_PAGE_SIZE } = await import("../bridge.util");

// ── Helpers ──────────────────────────────────────────────────────────

const makeRows = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => ({ id: from + i }));

const page = (
  rows: Array<Record<string, unknown>>,
  total: number,
  offset: number
): HandleSnapshotPayload => ({
  rows,
  total,
  offset,
  limit: D3_SNAPSHOT_PAGE_SIZE,
});

/** Serves pages from a fixed total, keyed by the requested offset. */
const serveTotal = (total: number) => {
  mutateAsync.mockImplementation(async ({ offset }) => {
    const remaining = Math.max(0, total - offset);
    const count = Math.min(D3_SNAPSHOT_PAGE_SIZE, remaining);
    return page(makeRows(count, offset), total, offset);
  });
};

beforeEach(() => {
  mutateAsync.mockReset();
});

// ── Paging (spec case 16) ────────────────────────────────────────────

describe("useProgressiveHandleRows — paging", () => {
  it("pages from offset 0 by D3_SNAPSHOT_PAGE_SIZE, emitting ordered batches", async () => {
    serveTotal(2_250);
    const { result } = renderHook(() => useProgressiveHandleRows("qh-1"));

    await waitFor(() => expect(result.current.complete).toBe(true));

    expect(mutateAsync.mock.calls.map((c) => c[0])).toEqual([
      { handleId: "qh-1", offset: 0, limit: D3_SNAPSHOT_PAGE_SIZE },
      { handleId: "qh-1", offset: 1_000, limit: D3_SNAPSHOT_PAGE_SIZE },
      { handleId: "qh-1", offset: 2_000, limit: D3_SNAPSHOT_PAGE_SIZE },
    ]);
    expect(result.current.batches.map((b) => b.seq)).toEqual([0, 1, 2]);
    expect(result.current.batches.map((b) => b.done)).toEqual([
      false,
      false,
      true,
    ]);
    expect(result.current.receivedRows).toBe(2_250);
    expect(result.current.error).toBeNull();
  });

  it("stops at an exact page-multiple total without an extra empty request", async () => {
    serveTotal(2_000);
    const { result } = renderHook(() => useProgressiveHandleRows("qh-2"));

    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(result.current.receivedRows).toBe(2_000);
  });

  it("completes with a single empty batch for a zero-row handle", async () => {
    serveTotal(0);
    const { result } = renderHook(() => useProgressiveHandleRows("qh-3"));

    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(result.current.batches).toEqual([{ rows: [], seq: 0, done: true }]);
    expect(result.current.receivedRows).toBe(0);
  });

  it("requests pages strictly sequentially — page N+1 only after N resolves", async () => {
    let release!: (payload: HandleSnapshotPayload) => void;
    mutateAsync.mockImplementation(
      ({ offset }) =>
        new Promise<HandleSnapshotPayload>((resolve) => {
          release = (payload) => resolve({ ...payload, offset });
        })
    );
    const { result } = renderHook(() => useProgressiveHandleRows("qh-4"));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    // Nothing else may be in flight while page 1 is pending.
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    release(page(makeRows(D3_SNAPSHOT_PAGE_SIZE), 1_500, 0));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));

    release(page(makeRows(500, 1_000), 1_500, 1_000));
    await waitFor(() => expect(result.current.complete).toBe(true));
    expect(result.current.receivedRows).toBe(1_500);
  });

  it("does nothing for a null handle", () => {
    const { result } = renderHook(() => useProgressiveHandleRows(null));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(result.current.batches).toEqual([]);
    expect(result.current.complete).toBe(false);
  });
});

// ── Errors + teardown (spec case 17) ─────────────────────────────────

describe("useProgressiveHandleRows — errors and teardown", () => {
  it("maps READ_HANDLE_EXPIRED to the expired-cache copy and stops paging", async () => {
    mutateAsync.mockRejectedValue(
      Object.assign(new Error("expired"), { code: "READ_HANDLE_EXPIRED" })
    );
    const { result } = renderHook(() => useProgressiveHandleRows("qh-5"));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe(
      "The chart's data has expired from cache. Re-run the original query to refresh."
    );
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(result.current.complete).toBe(false);
  });

  it("passes other error messages through", async () => {
    mutateAsync.mockRejectedValue(new Error("network down"));
    const { result } = renderHook(() => useProgressiveHandleRows("qh-6"));

    await waitFor(() => expect(result.current.error).toBe("network down"));
  });

  it("stops paging on unmount", async () => {
    let release!: (payload: HandleSnapshotPayload) => void;
    mutateAsync.mockImplementation(
      () =>
        new Promise<HandleSnapshotPayload>((resolve) => {
          release = resolve;
        })
    );
    const { unmount } = renderHook(() => useProgressiveHandleRows("qh-7"));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));

    unmount();
    release(page(makeRows(D3_SNAPSHOT_PAGE_SIZE), 5_000, 0));

    // Give any (incorrect) follow-up request a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });
});
