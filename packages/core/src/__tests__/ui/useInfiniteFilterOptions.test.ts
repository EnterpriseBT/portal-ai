import { renderHook, act, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";
import { useInfiniteFilterOptions } from "../../ui/searchable-select/useInfiniteFilterOptions";
import type { InfiniteFilterOptionsConfig } from "../../ui/searchable-select/useInfiniteFilterOptions";

// ── Helpers ──────────────────────────────────────────────────────────

interface MockResponse {
  items: Array<{ id: string; name: string }>;
  total: number;
}

const ITEMS = [
  { id: "1", name: "Alpha" },
  { id: "2", name: "Beta" },
  { id: "3", name: "Gamma" },
];

function makeConfig(
  overrides?: Partial<
    InfiniteFilterOptionsConfig<MockResponse, { id: string; name: string }>
  >
): InfiniteFilterOptionsConfig<MockResponse, { id: string; name: string }> {
  return {
    url: "/api/items",
    fetcher: jest
      .fn<(url: string) => Promise<MockResponse>>()
      .mockResolvedValue({
        items: ITEMS,
        total: 3,
      }),
    getItems: (res) => res.items,
    getTotal: (res) => res.total,
    mapItem: (item) => ({ value: item.id, label: item.name }),
    ...overrides,
  };
}

function parseQs(url: string): Record<string, string> {
  const qs = url.split("?")[1] ?? "";
  const params: Record<string, string> = {};
  for (const pair of qs.split("&")) {
    const [key, value] = pair.split("=");
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
  }
  return params;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("useInfiniteFilterOptions", () => {
  it("returns a fetchPage function and an empty labelMap initially", () => {
    const config = makeConfig();
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    expect(typeof result.current.fetchPage).toBe("function");
    expect(result.current.labelMap).toEqual({});
  });

  it("calls fetcher with pagination, sort, and search params", async () => {
    const config = makeConfig();
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await act(async () => {
      await result.current.fetchPage({ search: "test", page: 0, pageSize: 20 });
    });

    const calledUrl = (config.fetcher as jest.Mock).mock.calls[0][0] as string;
    const params = parseQs(calledUrl);

    expect(calledUrl).toMatch(/^\/api\/items\?/);
    expect(params.limit).toBe("20");
    expect(params.offset).toBe("0");
    expect(params.sortBy).toBe("name");
    expect(params.sortOrder).toBe("asc");
    expect(params.search).toBe("test");
  });

  it("calculates offset from page and pageSize", async () => {
    const config = makeConfig();
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await act(async () => {
      await result.current.fetchPage({ search: "", page: 2, pageSize: 10 });
    });

    const calledUrl = (config.fetcher as jest.Mock).mock.calls[0][0] as string;
    const params = parseQs(calledUrl);
    expect(params.offset).toBe("20");
    expect(params.limit).toBe("10");
  });

  it("omits search param when search is empty", async () => {
    const config = makeConfig();
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await act(async () => {
      await result.current.fetchPage({ search: "", page: 0, pageSize: 10 });
    });

    const calledUrl = (config.fetcher as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain("search=");
  });

  it("returns mapped options and hasMore=false when all items fit", async () => {
    const config = makeConfig();
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    let pageResult: Awaited<ReturnType<typeof result.current.fetchPage>>;
    await act(async () => {
      pageResult = await result.current.fetchPage({
        search: "",
        page: 0,
        pageSize: 10,
      });
    });

    expect(pageResult!.options).toEqual([
      { value: "1", label: "Alpha" },
      { value: "2", label: "Beta" },
      { value: "3", label: "Gamma" },
    ]);
    expect(pageResult!.hasMore).toBe(false);
  });

  it("returns hasMore=true when more pages exist", async () => {
    const config = makeConfig({
      fetcher: jest
        .fn<(url: string) => Promise<MockResponse>>()
        .mockResolvedValue({
          items: [
            { id: "1", name: "Alpha" },
            { id: "2", name: "Beta" },
          ],
          total: 5,
        }),
    });
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    let pageResult: Awaited<ReturnType<typeof result.current.fetchPage>>;
    await act(async () => {
      pageResult = await result.current.fetchPage({
        search: "",
        page: 0,
        pageSize: 2,
      });
    });

    expect(pageResult!.hasMore).toBe(true);
  });

  it("uses custom sortBy and sortOrder", async () => {
    const config = makeConfig({ sortBy: "created", sortOrder: "desc" });
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await act(async () => {
      await result.current.fetchPage({ search: "", page: 0, pageSize: 10 });
    });

    const calledUrl = (config.fetcher as jest.Mock).mock.calls[0][0] as string;
    const params = parseQs(calledUrl);
    expect(params.sortBy).toBe("created");
    expect(params.sortOrder).toBe("desc");
  });

  it("appends defaultParams to every request", async () => {
    const config = makeConfig({
      defaultParams: { capability: "write", orgId: "42" },
    });
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await act(async () => {
      await result.current.fetchPage({ search: "", page: 0, pageSize: 10 });
    });

    const calledUrl = (config.fetcher as jest.Mock).mock.calls[0][0] as string;
    const params = parseQs(calledUrl);
    expect(params.capability).toBe("write");
    expect(params.orgId).toBe("42");
  });

  it("merges defaultParams with search and pagination", async () => {
    const config = makeConfig({
      defaultParams: { capability: "write" },
    });
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await act(async () => {
      await result.current.fetchPage({ search: "foo", page: 1, pageSize: 5 });
    });

    const calledUrl = (config.fetcher as jest.Mock).mock.calls[0][0] as string;
    const params = parseQs(calledUrl);
    expect(params.capability).toBe("write");
    expect(params.search).toBe("foo");
    expect(params.offset).toBe("5");
    expect(params.limit).toBe("5");
  });

  it("populates labelMap after fetchPage resolves", async () => {
    const config = makeConfig();
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await act(async () => {
      await result.current.fetchPage({ search: "", page: 0, pageSize: 10 });
    });

    await waitFor(() => {
      expect(result.current.labelMap).toEqual({
        "1": "Alpha",
        "2": "Beta",
        "3": "Gamma",
      });
    });
  });

  it("accumulates labelMap entries across multiple pages", async () => {
    const fetcher = jest.fn<(url: string) => Promise<MockResponse>>();
    fetcher
      .mockResolvedValueOnce({ items: [{ id: "1", name: "Alpha" }], total: 2 })
      .mockResolvedValueOnce({ items: [{ id: "2", name: "Beta" }], total: 2 });

    const config = makeConfig({ fetcher });
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await act(async () => {
      await result.current.fetchPage({ search: "", page: 0, pageSize: 1 });
    });
    await act(async () => {
      await result.current.fetchPage({ search: "", page: 1, pageSize: 1 });
    });

    await waitFor(() => {
      expect(result.current.labelMap).toEqual({
        "1": "Alpha",
        "2": "Beta",
      });
    });
  });

  it("propagates fetcher errors", async () => {
    const config = makeConfig({
      fetcher: jest
        .fn<(url: string) => Promise<MockResponse>>()
        .mockRejectedValue(new Error("Network error")),
    });
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await expect(
      act(async () => {
        await result.current.fetchPage({ search: "", page: 0, pageSize: 10 });
      })
    ).rejects.toThrow("Network error");
  });

  it("pagination params override defaultParams with same keys", async () => {
    const config = makeConfig({
      defaultParams: { limit: 999, offset: 999 },
    });
    const { result } = renderHook(() => useInfiniteFilterOptions(config));

    await act(async () => {
      await result.current.fetchPage({ search: "", page: 0, pageSize: 10 });
    });

    const calledUrl = (config.fetcher as jest.Mock).mock.calls[0][0] as string;
    const params = parseQs(calledUrl);
    // Pagination params should win over defaultParams
    expect(params.limit).toBe("10");
    expect(params.offset).toBe("0");
  });
});
