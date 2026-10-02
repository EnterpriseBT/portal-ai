import { jest } from "@jest/globals";

/**
 * #678 slice 4: the curated view page's table state. Filters and paging are
 * remembered per view, saved filters are applied only once the view's columns
 * are known (and stripped against them), the advanced filter builder is
 * offered over exactly those columns, and a filter or sort the server refuses
 * is reset so it can't lock the page in an error. The view page's container
 * reads a route param, so this state lives in a hook that can be tested on its
 * own.
 */

const { renderHook, render, screen, act, fireEvent } =
  await import("./test-utils");
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
type Cols = typeof COLUMNS;

const cond = (field: string) => ({ field, operator: "eq", value: "x" });
const group = (...fields: string[]) => ({
  combinator: "and" as const,
  conditions: fields.map(cond),
});
const save = (advancedFilters: unknown, extra: Record<string, unknown> = {}) =>
  localStorage.setItem(
    KEY,
    JSON.stringify({
      search: "",
      filters: {},
      sortBy: "created",
      sortOrder: "asc",
      limit: 10,
      advancedFilters,
      ...extra,
    })
  );
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "{}");
const decode = (filters: unknown) =>
  JSON.parse(Buffer.from(String(filters), "base64").toString("utf-8"));

type Props = { columns: Cols; errorCode?: string | null };
const mount = (initial: Props, onRecovered = jest.fn()) =>
  renderHook(
    ({ columns, errorCode }: Props) =>
      useCuratedViewTablePagination("v-1", columns, {
        errorCode,
        onRecovered,
      }),
    { initialProps: initial }
  );

beforeEach(() => localStorage.clear());

describe("useCuratedViewTablePagination (#678)", () => {
  it("persists under pagination:curated-view:<viewId>", () => {
    const { result } = mount({ columns: COLUMNS });
    act(() => result.current.setAdvancedFilters(group("name") as never));
    expect(stored().advancedFilters).toEqual(group("name"));
  });

  it("sends `filters` only once a filter is applied", () => {
    const { result } = mount({ columns: COLUMNS });
    expect(result.current.queryParams).not.toHaveProperty("filters");
    act(() => result.current.setAdvancedFilters(group("age") as never));
    expect(typeof result.current.queryParams.filters).toBe("string");
  });

  it("holds a saved filter back until the columns are known, then applies only its valid conditions", () => {
    save(group("name", "salary"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { result, rerender } = mount({ columns: [] });
    // Before the columns load, nothing stale goes to the server.
    expect(result.current.queryParams).not.toHaveProperty("filters");

    rerender({ columns: COLUMNS });
    // The valid `name` condition survives; only `salary` is dropped.
    const sent = decode(result.current.queryParams.filters);
    expect(JSON.stringify(sent)).toContain('"name"');
    expect(JSON.stringify(sent)).not.toContain("salary");
    expect(JSON.stringify(stored().advancedFilters)).not.toContain("salary");
    expect(JSON.stringify(stored().advancedFilters)).toContain('"name"');
    warn.mockRestore();
  });

  it("doesn't lose a saved filter when something else is saved before the columns load", () => {
    save(group("name"));
    const { result, rerender } = mount({ columns: [] });
    act(() => result.current.setSearch("acme"));
    expect(stored().advancedFilters).toEqual(group("name"));
    rerender({ columns: COLUMNS });
    expect(typeof result.current.queryParams.filters).toBe("string");
  });

  it("offers the advanced filter builder once the view's columns are known", () => {
    const { result, rerender } = mount({ columns: [] });
    const { unmount } = render(
      <PaginationToolbar {...result.current.toolbarProps} />
    );
    expect(screen.queryByText("Advanced Filters")).not.toBeInTheDocument();
    unmount();

    rerender({ columns: COLUMNS });
    render(<PaginationToolbar {...result.current.toolbarProps} />);
    expect(screen.getByText("Advanced Filters")).toBeInTheDocument();
  });

  it("offers a Created sort in the toolbar, like the entity records table", async () => {
    const { result } = mount({ columns: COLUMNS });
    render(<PaginationToolbar {...result.current.toolbarProps} />);
    fireEvent.click(screen.getByText("Sort"));
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(result.current.queryParams.sortBy).toBe("created");
  });

  it("clears an applied filter the server refuses, and reports it", () => {
    const onRecovered = jest.fn();
    const { result, rerender } = mount({ columns: COLUMNS }, onRecovered);
    act(() => result.current.setAdvancedFilters(group("age") as never));

    rerender({ columns: COLUMNS, errorCode: "CURATED_VIEW_INVALID_FILTER" });
    expect(result.current.queryParams).not.toHaveProperty("filters");
    expect(JSON.stringify(stored().advancedFilters ?? {})).not.toContain("age");
    expect(onRecovered).toHaveBeenCalledWith("filter");
  });

  it("doesn't claim to clear a filter when none is applied (a broken view filter shares the code)", () => {
    const onRecovered = jest.fn();
    const { rerender } = mount({ columns: COLUMNS }, onRecovered);
    rerender({ columns: COLUMNS, errorCode: "CURATED_VIEW_INVALID_FILTER" });
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("resets a sort the server refuses to the default, and reports it", () => {
    save(undefined, { sortBy: "tags", sortOrder: "desc" });
    const onRecovered = jest.fn();
    const { result, rerender } = mount({ columns: COLUMNS }, onRecovered);
    expect(result.current.sortBy).toBe("tags");

    rerender({ columns: COLUMNS, errorCode: "CURATED_VIEW_INVALID_SORT" });
    expect(result.current.sortBy).toBe("created");
    expect(result.current.sortOrder).toBe("asc");
    expect(stored().sortBy).toBe("created");
    expect(onRecovered).toHaveBeenCalledWith("sort");
  });
});
