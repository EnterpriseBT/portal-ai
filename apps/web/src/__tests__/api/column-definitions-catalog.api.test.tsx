/**
 * #414: the column-definition catalog surface.
 *
 * Two behaviours that had no coverage and caused the bug:
 *  - `search` sent no ordering, so every picker inherited the pagination
 *    contract's `sortBy: created`. The #316 geospatial definitions were
 *    appended last to SYSTEM_COLUMN_DEFINITIONS, so they sorted outside the
 *    default 20-row window and read as missing.
 *  - the binding-label maps asked for `limit: 1000` and were silently answered
 *    with 100 (the contract clamps), with no user typing to recover the miss.
 *    `listAll` pages against `total` instead.
 *
 * These render the hooks rather than calling them, because both use real React
 * and react-query hooks (`useState`, `useMutation`, `useQuery`).
 */
import React from "react";
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockFetchWithAuth = jest.fn<(url: string) => Promise<unknown>>();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: jest.fn(),
  useAuthMutation: jest.fn(),
  useAuthFetch: () => ({ fetchWithAuth: mockFetchWithAuth }),
}));

jest.unstable_mockModule("@portalai/core/ui", () => ({
  useAsyncFilterOptions: jest.fn(),
}));

const { columnDefinitions } = await import("../../api/column-definitions.api");

/** A minimal column-definition row — only the fields the mappers read. */
const row = (id: string, label: string) => ({
  id,
  label,
  key: label.toLowerCase(),
  type: "string",
  description: null,
});

const page = (
  rows: ReturnType<typeof row>[],
  total: number,
  limit: number,
  offset: number
) => ({
  payload: { columnDefinitions: rows, total, limit, offset },
});

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(QueryClientProvider, { client }, children);
};

const urlsCalled = () =>
  mockFetchWithAuth.mock.calls.map(([url]) => url as string);

describe("columnDefinitions.search", () => {
  beforeEach(() => {
    mockFetchWithAuth.mockReset();
    mockFetchWithAuth.mockResolvedValue(
      page([row("cd-1", "Address")], 1, 20, 0)
    );
  });

  it("orders the catalog by label, not by creation date", async () => {
    const { result } = renderHook(() => columnDefinitions.search(), {
      wrapper,
    });

    // `search` writes its label-map cache via setState, so the call has to be
    // acted on or React warns about an update outside act().
    await act(async () => {
      await result.current.onSearch("");
    });

    const url = urlsCalled()[0];
    expect(url).toContain("sortBy=label");
    expect(url).toContain("sortOrder=asc");
    expect(url).not.toContain("sortBy=created");
  });

  it("still forwards the query so any definition stays reachable", async () => {
    const { result } = renderHook(() => columnDefinitions.search(), {
      wrapper,
    });

    await act(async () => {
      await result.current.onSearch("geo");
    });

    expect(urlsCalled()[0]).toContain("search=geo");
  });

  it("lets a caller override the ordering via defaultParams", async () => {
    const { result } = renderHook(
      () => columnDefinitions.search({ defaultParams: { sortBy: "key" } }),
      { wrapper }
    );

    await act(async () => {
      await result.current.onSearch("");
    });

    expect(urlsCalled()[0]).toContain("sortBy=key");
  });
});

describe("columnDefinitions.listAll", () => {
  beforeEach(() => {
    mockFetchWithAuth.mockReset();
  });

  it("pages until the reported total is covered", async () => {
    const first = Array.from({ length: 100 }, (_, i) =>
      row(`cd-${i}`, `Label ${i}`)
    );
    const second = Array.from({ length: 25 }, (_, i) =>
      row(`cd-${100 + i}`, `Label ${100 + i}`)
    );
    mockFetchWithAuth
      .mockResolvedValueOnce(page(first, 125, 100, 0))
      .mockResolvedValueOnce(page(second, 125, 100, 100));

    const { result } = renderHook(() => columnDefinitions.listAll(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.columnDefinitions).toHaveLength(125);
    expect(result.current.data?.total).toBe(125);

    const urls = urlsCalled();
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("offset=0");
    expect(urls[1]).toContain("offset=100");
  });

  it("never asks for more than the server will serve", async () => {
    mockFetchWithAuth.mockResolvedValue(
      page([row("cd-1", "Address")], 1, 100, 0)
    );

    const { result } = renderHook(() => columnDefinitions.listAll(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The contract clamps `limit` to 100; asking for 1000 was how the old
    // callers got silently truncated.
    expect(urlsCalled()[0]).toContain("limit=100");
    expect(urlsCalled()[0]).not.toContain("limit=1000");
  });

  it("stops on a short page even if total disagrees", async () => {
    // A stale or wrong `total` must not spin the loop.
    mockFetchWithAuth.mockResolvedValue(
      page([row("cd-1", "Address")], 9999, 100, 0)
    );

    const { result } = renderHook(() => columnDefinitions.listAll(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(urlsCalled()).toHaveLength(1);
    expect(result.current.data?.columnDefinitions).toHaveLength(1);
  });

  it("requests the catalog label-ordered", async () => {
    mockFetchWithAuth.mockResolvedValue(
      page([row("cd-1", "Address")], 1, 100, 0)
    );

    const { result } = renderHook(() => columnDefinitions.listAll(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(urlsCalled()[0]).toContain("sortBy=label");
  });
});
