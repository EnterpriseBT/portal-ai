import { jest } from "@jest/globals";

/**
 * #678 slice 4: the curated view page's table state. Filters and paging are
 * remembered per view, stale filters are dropped against the view's current
 * columns, and the advanced filter builder is offered over exactly those
 * columns. The view page's container reads a route param, so this state lives
 * in a hook that can be tested on its own.
 */

const { renderHook, render, screen, act } = await import("./test-utils");
const { useCuratedViewTablePagination } =
  await import("../utils/curated-view-table.util");
const { PaginationToolbar } =
  await import("../components/PaginationToolbar.component");

const col = (normalizedKey: string, type: "string" | "number" = "string") => ({
  key: normalizedKey,
  normalizedKey,
  label: normalizedKey,
  type,
  required: false,
  enumValues: null,
  defaultValue: null,
  format: null,
  validationPattern: null,
  canonicalFormat: null,
});
const COLUMNS = [col("name"), col("age", "number")];
const KEY = "pagination:curated-view:v-1";

const condition = (field: string) => ({
  combinator: "and" as const,
  conditions: [{ field, operator: "eq", value: "x" }],
});

beforeEach(() => localStorage.clear());

describe("useCuratedViewTablePagination (#678)", () => {
  it("persists under pagination:curated-view:<viewId>", () => {
    const { result } = renderHook(() =>
      useCuratedViewTablePagination("v-1", COLUMNS)
    );
    act(() => result.current.setAdvancedFilters(condition("name") as never));
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    expect(stored.advancedFilters).toEqual(condition("name"));
  });

  it("sends `filters` only once a filter is applied", () => {
    const { result } = renderHook(() =>
      useCuratedViewTablePagination("v-1", COLUMNS)
    );
    expect(result.current.queryParams).not.toHaveProperty("filters");
    act(() => result.current.setAdvancedFilters(condition("age") as never));
    expect(typeof result.current.queryParams.filters).toBe("string");
  });

  it("drops a persisted filter on a column the view no longer has, and saves the cleaned state", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        search: "",
        filters: {},
        sortBy: "created",
        sortOrder: "asc",
        limit: 10,
        advancedFilters: condition("salary"),
      })
    );
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { result } = renderHook(() =>
      useCuratedViewTablePagination("v-1", COLUMNS)
    );
    expect(result.current.queryParams).not.toHaveProperty("filters");
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    expect(JSON.stringify(stored.advancedFilters)).not.toContain("salary");
    warn.mockRestore();
  });

  it("offers the advanced filter builder once the view's columns are known", () => {
    const { result, rerender } = renderHook(
      ({ columns }) => useCuratedViewTablePagination("v-1", columns),
      { initialProps: { columns: [] as typeof COLUMNS } }
    );
    const { unmount } = render(
      <PaginationToolbar {...result.current.toolbarProps} />
    );
    expect(screen.queryByText("Advanced Filters")).not.toBeInTheDocument();
    unmount();

    rerender({ columns: COLUMNS });
    render(<PaginationToolbar {...result.current.toolbarProps} />);
    expect(screen.getByText("Advanced Filters")).toBeInTheDocument();
  });

  it("clears a saved filter the server refuses, so a stale filter can't lock the page in an error", () => {
    // The columns arrive with the records response, so a stale saved filter is
    // sent before they're known. The server's 400 is what clears it.
    localStorage.setItem(
      KEY,
      JSON.stringify({
        search: "",
        filters: {},
        sortBy: "created",
        sortOrder: "asc",
        limit: 10,
        advancedFilters: condition("salary"),
      })
    );
    const { result, rerender } = renderHook(
      ({ invalidFilter }) =>
        useCuratedViewTablePagination("v-1", [], { invalidFilter }),
      { initialProps: { invalidFilter: false } }
    );
    expect(typeof result.current.queryParams.filters).toBe("string");

    rerender({ invalidFilter: true });
    expect(result.current.queryParams).not.toHaveProperty("filters");
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    expect(JSON.stringify(stored.advancedFilters ?? {})).not.toContain(
      "salary"
    );
  });
});
