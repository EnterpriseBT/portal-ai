import { renderHook, act, waitFor } from "@testing-library/react";
import { jest } from "@jest/globals";
import { useAsyncFilterOptions } from "../../ui/searchable-select/useAsyncFilterOptions";
import type { AsyncFilterOptionsConfig } from "../../ui/searchable-select/useAsyncFilterOptions";

// ── Helpers ──────────────────────────────────────────────────────────

interface MockResponse {
  items: Array<{ id: string; name: string }>;
}

const ITEMS = [
  { id: "1", name: "Alpha" },
  { id: "2", name: "Beta" },
  { id: "3", name: "Gamma" },
];

function makeConfig(
  overrides?: Partial<AsyncFilterOptionsConfig<MockResponse, { id: string; name: string }>>
): AsyncFilterOptionsConfig<MockResponse, { id: string; name: string }> {
  return {
    url: "/api/items",
    fetcher: jest.fn<(url: string) => Promise<MockResponse>>().mockResolvedValue({ items: ITEMS }),
    getItems: (res) => res.items,
    mapItem: (item) => ({ value: item.id, label: item.name }),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("useAsyncFilterOptions", () => {
  it("returns an onSearch function and an empty labelMap initially", () => {
    const config = makeConfig();
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    expect(typeof result.current.onSearch).toBe("function");
    expect(result.current.labelMap).toEqual({});
  });

  it("calls fetcher with the base URL when query is empty", async () => {
    const config = makeConfig();
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    let options: Awaited<ReturnType<typeof result.current.onSearch>> = [];
    await act(async () => {
      options = await result.current.onSearch("");
    });

    expect(config.fetcher).toHaveBeenCalledWith("/api/items");
    expect(options).toEqual([
      { value: "1", label: "Alpha" },
      { value: "2", label: "Beta" },
      { value: "3", label: "Gamma" },
    ]);
  });

  it("appends search param when query is provided", async () => {
    const config = makeConfig();
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    await act(async () => {
      await result.current.onSearch("test query");
    });

    expect(config.fetcher).toHaveBeenCalledWith(
      "/api/items?search=test%20query"
    );
  });

  it("appends defaultParams to every request", async () => {
    const config = makeConfig({
      defaultParams: { capability: "write", status: "active" },
    });
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    await act(async () => {
      await result.current.onSearch("");
    });

    const calledUrl = (config.fetcher as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain("capability=write");
    expect(calledUrl).toContain("status=active");
    expect(calledUrl).not.toContain("search=");
  });

  it("merges defaultParams with search param", async () => {
    const config = makeConfig({
      defaultParams: { capability: "write" },
    });
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    await act(async () => {
      await result.current.onSearch("foo");
    });

    const calledUrl = (config.fetcher as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain("capability=write");
    expect(calledUrl).toContain("search=foo");
  });

  it("populates labelMap after onSearch resolves", async () => {
    const config = makeConfig();
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    await act(async () => {
      await result.current.onSearch("");
    });

    await waitFor(() => {
      expect(result.current.labelMap).toEqual({
        "1": "Alpha",
        "2": "Beta",
        "3": "Gamma",
      });
    });
  });

  it("accumulates labelMap entries across multiple searches", async () => {
    const fetcher = jest.fn<(url: string) => Promise<MockResponse>>();
    fetcher
      .mockResolvedValueOnce({ items: [{ id: "1", name: "Alpha" }] })
      .mockResolvedValueOnce({ items: [{ id: "4", name: "Delta" }] });

    const config = makeConfig({ fetcher });
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    await act(async () => {
      await result.current.onSearch("a");
    });
    await act(async () => {
      await result.current.onSearch("d");
    });

    await waitFor(() => {
      expect(result.current.labelMap).toEqual({
        "1": "Alpha",
        "4": "Delta",
      });
    });
  });

  it("uses custom mapItem when provided", async () => {
    const config = makeConfig({
      mapItem: (item) => ({ value: item.name, label: `Item: ${item.name}` }),
    });
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    let options: Awaited<ReturnType<typeof result.current.onSearch>> = [];
    await act(async () => {
      options = await result.current.onSearch("");
    });

    expect(options[0]).toEqual({ value: "Alpha", label: "Item: Alpha" });
  });

  it("returns empty options when fetcher returns no items", async () => {
    const config = makeConfig({
      fetcher: jest.fn<(url: string) => Promise<MockResponse>>().mockResolvedValue({ items: [] }),
    });
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    let options: Awaited<ReturnType<typeof result.current.onSearch>> = [];
    await act(async () => {
      options = await result.current.onSearch("");
    });

    expect(options).toEqual([]);
  });

  it("propagates fetcher errors", async () => {
    const config = makeConfig({
      fetcher: jest.fn<(url: string) => Promise<MockResponse>>().mockRejectedValue(new Error("Network error")),
    });
    const { result } = renderHook(() => useAsyncFilterOptions(config));

    await expect(
      act(async () => {
        await result.current.onSearch("fail");
      })
    ).rejects.toThrow("Network error");
  });
});
