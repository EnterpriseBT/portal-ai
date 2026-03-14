import { jest } from "@jest/globals";
import { render, screen, renderHook, act, within } from "./test-utils";
import userEvent from "@testing-library/user-event";
import {
  PaginationToolbar,
  usePagination,
  PaginationToolbarProps,
  FilterConfig,
  SortFieldConfig,
} from "../components/PaginationToolbar.component";

// --- Test Data ---

const selectFilter: FilterConfig = {
  type: "select",
  field: "category",
  label: "Category",
  options: [
    { label: "CRM", value: "crm" },
    { label: "Marketing", value: "marketing" },
  ],
};

const booleanFilter: FilterConfig = {
  type: "boolean",
  field: "isActive",
  label: "Active",
};

const numberFilter: FilterConfig = {
  type: "number",
  field: "minConnections",
  label: "Min Connections",
  min: 0,
  max: 100,
  placeholder: "e.g. 10",
};

const textFilter: FilterConfig = {
  type: "text",
  field: "tag",
  label: "Tag",
  placeholder: "Enter a tag",
};

const allFilters: FilterConfig[] = [
  selectFilter,
  booleanFilter,
  numberFilter,
  textFilter,
];

const sortFields: SortFieldConfig[] = [
  { field: "created", label: "Date Created" },
  { field: "display", label: "Name" },
];

function makeProps(
  overrides: Partial<PaginationToolbarProps> = {}
): PaginationToolbarProps {
  return {
    search: "",
    onSearchChange: jest.fn(),
    filterConfigs: [],
    filters: {},
    onFilterValueChange: jest.fn(),
    activeFilterCount: 0,
    sortFields: [],
    sortBy: "created",
    onSortByChange: jest.fn(),
    sortOrder: "asc",
    onSortOrderChange: jest.fn(),
    offset: 0,
    limit: 20,
    limitOptions: [10, 20, 50, 100],
    onLimitChange: jest.fn(),
    total: 95,
    currentPage: 1,
    totalPages: 5,
    onFirst: jest.fn(),
    onPrev: jest.fn(),
    onNext: jest.fn(),
    onLast: jest.fn(),
    ...overrides,
  };
}

// =============================================================================
// usePagination Hook Tests
// =============================================================================

describe("usePagination", () => {
  describe("defaults", () => {
    it("should return default state", () => {
      const { result } = renderHook(() => usePagination());

      expect(result.current.search).toBe("");
      expect(result.current.filters).toEqual({});
      expect(result.current.sortBy).toBe("created");
      expect(result.current.sortOrder).toBe("asc");
      expect(result.current.offset).toBe(0);
      expect(result.current.limit).toBe(10);
      expect(result.current.total).toBe(0);
    });

    it("should respect custom defaults", () => {
      const { result } = renderHook(() =>
        usePagination({
          defaultSortBy: "name",
          defaultSortOrder: "desc",
          limit: 50,
        })
      );

      expect(result.current.sortBy).toBe("name");
      expect(result.current.sortOrder).toBe("desc");
      expect(result.current.limit).toBe(50);
    });
  });

  describe("search", () => {
    it("should update search and reset offset", () => {
      const { result } = renderHook(() => usePagination());

      act(() => result.current.setOffset(40));
      expect(result.current.offset).toBe(40);

      act(() => result.current.setSearch("test"));
      expect(result.current.search).toBe("test");
      expect(result.current.offset).toBe(0);
    });

    it("should include search in queryParams when non-empty", () => {
      const { result } = renderHook(() => usePagination());

      expect(result.current.queryParams.search).toBeUndefined();

      act(() => result.current.setSearch("hello"));
      expect(result.current.queryParams.search).toBe("hello");
    });
  });

  describe("filters", () => {
    it("should set filter values and reset offset", () => {
      const { result } = renderHook(() => usePagination());

      act(() => result.current.setOffset(20));
      act(() => result.current.setFilter("category", ["crm", "marketing"]));

      expect(result.current.filters.category).toEqual(["crm", "marketing"]);
      expect(result.current.offset).toBe(0);
    });

    it("should set single filter value for boolean/number/text", () => {
      const { result } = renderHook(() => usePagination());

      act(() => result.current.setFilterValue("isActive", "true"));
      expect(result.current.filters.isActive).toEqual(["true"]);

      act(() => result.current.setFilterValue("isActive", ""));
      expect(result.current.filters.isActive).toEqual([]);
    });
  });

  describe("queryParams", () => {
    it("should include base pagination params", () => {
      const { result } = renderHook(() => usePagination());

      expect(result.current.queryParams).toEqual({
        limit: 10,
        offset: 0,
        sortBy: "created",
        sortOrder: "asc",
      });
    });

    it("should include select filter as string", () => {
      const { result } = renderHook(() =>
        usePagination({ filters: [selectFilter] })
      );

      act(() => result.current.setFilterValue("category", "crm"));
      expect(result.current.queryParams.category).toBe("crm");
    });

    it("should convert boolean filter to actual boolean", () => {
      const { result } = renderHook(() =>
        usePagination({ filters: [booleanFilter] })
      );

      act(() => result.current.setFilterValue("isActive", "true"));
      expect(result.current.queryParams.isActive).toBe(true);
    });

    it("should convert number filter to actual number", () => {
      const { result } = renderHook(() =>
        usePagination({ filters: [numberFilter] })
      );

      act(() => result.current.setFilterValue("minConnections", "42"));
      expect(result.current.queryParams.minConnections).toBe(42);
    });

    it("should include text filter as string", () => {
      const { result } = renderHook(() =>
        usePagination({ filters: [textFilter] })
      );

      act(() => result.current.setFilterValue("tag", "enterprise"));
      expect(result.current.queryParams.tag).toBe("enterprise");
    });

    it("should skip empty filter arrays", () => {
      const { result } = renderHook(() =>
        usePagination({ filters: [booleanFilter] })
      );

      act(() => result.current.setFilterValue("isActive", ""));
      expect(result.current.queryParams).not.toHaveProperty("isActive");
    });
  });

  describe("sorting", () => {
    it("should update sortBy", () => {
      const { result } = renderHook(() => usePagination());

      act(() => result.current.setSortBy("name"));
      expect(result.current.sortBy).toBe("name");
    });

    it("should update sortOrder", () => {
      const { result } = renderHook(() => usePagination());

      act(() => result.current.setSortOrder("desc"));
      expect(result.current.sortOrder).toBe("desc");
    });

    it("should toggle sortOrder", () => {
      const { result } = renderHook(() => usePagination());

      expect(result.current.sortOrder).toBe("asc");
      act(() => result.current.toggleSortOrder());
      expect(result.current.sortOrder).toBe("desc");
      act(() => result.current.toggleSortOrder());
      expect(result.current.sortOrder).toBe("asc");
    });
  });

  describe("pagination navigation", () => {
    it("should compute currentPage and totalPages from toolbarProps", () => {
      const { result } = renderHook(() => usePagination({ limit: 10 }));

      act(() => result.current.setTotal(95));

      expect(result.current.toolbarProps.currentPage).toBe(1);
      expect(result.current.toolbarProps.totalPages).toBe(10);
    });

    it("should advance offset on next page via toolbarProps.onNext", () => {
      const { result } = renderHook(() => usePagination({ limit: 10 }));

      act(() => result.current.setTotal(50));
      act(() => result.current.toolbarProps.onNext());

      expect(result.current.offset).toBe(10);
      expect(result.current.toolbarProps.currentPage).toBe(2);
    });

    it("should go to previous page via toolbarProps.onPrev", () => {
      const { result } = renderHook(() => usePagination({ limit: 10 }));

      act(() => result.current.setTotal(50));
      act(() => result.current.setOffset(20));
      act(() => result.current.toolbarProps.onPrev());

      expect(result.current.offset).toBe(10);
    });

    it("should go to first page via toolbarProps.onFirst", () => {
      const { result } = renderHook(() => usePagination({ limit: 10 }));

      act(() => result.current.setTotal(50));
      act(() => result.current.setOffset(30));
      act(() => result.current.toolbarProps.onFirst());

      expect(result.current.offset).toBe(0);
    });

    it("should go to last page via toolbarProps.onLast", () => {
      const { result } = renderHook(() => usePagination({ limit: 10 }));

      act(() => result.current.setTotal(50));
      act(() => result.current.toolbarProps.onLast());

      expect(result.current.offset).toBe(40);
    });

    it("should not go below 0 on prev", () => {
      const { result } = renderHook(() => usePagination({ limit: 10 }));

      act(() => result.current.setTotal(50));
      act(() => result.current.toolbarProps.onPrev());

      expect(result.current.offset).toBe(0);
    });

    it("should not exceed last page on next", () => {
      const { result } = renderHook(() => usePagination({ limit: 10 }));

      act(() => result.current.setTotal(50));
      act(() => result.current.setOffset(40));
      act(() => result.current.toolbarProps.onNext());

      expect(result.current.offset).toBe(40);
    });
  });

  describe("limit", () => {
    it("should update limit and reset offset", () => {
      const { result } = renderHook(() => usePagination());

      act(() => result.current.setOffset(40));
      act(() => result.current.setLimit(50));

      expect(result.current.limit).toBe(50);
      expect(result.current.offset).toBe(0);
    });
  });

  describe("activeFilterCount", () => {
    it("should count active filter values", () => {
      const { result } = renderHook(() => usePagination());

      act(() => result.current.setFilterValue("category", "crm"));
      act(() => result.current.setFilterValue("isActive", "true"));

      expect(result.current.toolbarProps.activeFilterCount).toBe(2);
    });
  });

  describe("toolbarProps", () => {
    it("should pass through filter and sort configs", () => {
      const { result } = renderHook(() =>
        usePagination({ filters: allFilters, sortFields })
      );

      expect(result.current.toolbarProps.filterConfigs).toBe(allFilters);
      expect(result.current.toolbarProps.sortFields).toBe(sortFields);
    });

    it("should pass limitOptions", () => {
      const { result } = renderHook(() =>
        usePagination({ limitOptions: [5, 25] })
      );

      expect(result.current.toolbarProps.limitOptions).toEqual([5, 25]);
    });
  });
});

// =============================================================================
// PaginationToolbar Component Tests
// =============================================================================

describe("PaginationToolbar", () => {
  describe("search", () => {
    it("should render search input", () => {
      render(<PaginationToolbar {...makeProps()} />);
      expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    });

    it("should display search value", () => {
      render(<PaginationToolbar {...makeProps({ search: "hello" })} />);
      expect(screen.getByPlaceholderText("Search...")).toHaveValue("hello");
    });

    it("should call onSearchChange on input", async () => {
      const onSearchChange = jest.fn();
      const user = userEvent.setup();
      render(<PaginationToolbar {...makeProps({ onSearchChange })} />);

      await user.type(screen.getByPlaceholderText("Search..."), "a");
      expect(onSearchChange).toHaveBeenCalledWith("a");
    });

    it("should show clear button when search has value", () => {
      render(<PaginationToolbar {...makeProps({ search: "test" })} />);
      // The close icon button should be present
      const input = screen.getByPlaceholderText("Search...");
      const container = input.closest(".MuiTextField-root")!;
      expect(
        within(container as HTMLElement).getByTestId("CloseIcon")
      ).toBeInTheDocument();
    });

    it("should not show clear button when search is empty", () => {
      render(<PaginationToolbar {...makeProps({ search: "" })} />);
      expect(screen.queryByTestId("CloseIcon")).not.toBeInTheDocument();
    });

    it("should call onSearchChange with empty string when clear is clicked", async () => {
      const onSearchChange = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar {...makeProps({ search: "test", onSearchChange })} />
      );

      const closeIcon = screen.getByTestId("CloseIcon");
      await user.click(closeIcon);
      expect(onSearchChange).toHaveBeenCalledWith("");
    });
  });

  describe("filter button", () => {
    it("should not render filter button when no filterConfigs", () => {
      render(<PaginationToolbar {...makeProps({ filterConfigs: [] })} />);
      expect(screen.queryByText("Filter")).not.toBeInTheDocument();
    });

    it("should render filter button when filterConfigs provided", () => {
      render(
        <PaginationToolbar {...makeProps({ filterConfigs: [selectFilter] })} />
      );
      expect(screen.getByText("Filter")).toBeInTheDocument();
    });

    it("should open filter popover on click", async () => {
      const user = userEvent.setup();
      render(
        <PaginationToolbar {...makeProps({ filterConfigs: [selectFilter] })} />
      );

      await user.click(screen.getByText("Filter"));
      expect(screen.getByText("Category")).toBeInTheDocument();
      expect(screen.getByText("CRM")).toBeInTheDocument();
      expect(screen.getByText("Marketing")).toBeInTheDocument();
    });

    it("should call onFilterValueChange when select option clicked", async () => {
      const onFilterValueChange = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar
          {...makeProps({ filterConfigs: [selectFilter], onFilterValueChange })}
        />
      );

      await user.click(screen.getByText("Filter"));
      await user.click(screen.getByText("CRM"));
      expect(onFilterValueChange).toHaveBeenCalledWith("category", "crm");
    });

    it("should render boolean filter as switch", async () => {
      const user = userEvent.setup();
      render(
        <PaginationToolbar {...makeProps({ filterConfigs: [booleanFilter] })} />
      );

      await user.click(screen.getByText("Filter"));
      // MUI Switch renders an internal input with checkbox role
      expect(screen.getByText("No")).toBeInTheDocument();
    });

    it("should call onFilterValueChange for boolean toggle", async () => {
      const onFilterValueChange = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar
          {...makeProps({
            filterConfigs: [booleanFilter],
            onFilterValueChange,
          })}
        />
      );

      await user.click(screen.getByText("Filter"));
      // Click the "No" label to toggle the switch
      await user.click(screen.getByText("No"));
      expect(onFilterValueChange).toHaveBeenCalledWith("isActive", "true");
    });

    it("should render number filter input", async () => {
      const user = userEvent.setup();
      render(
        <PaginationToolbar {...makeProps({ filterConfigs: [numberFilter] })} />
      );

      await user.click(screen.getByText("Filter"));
      expect(screen.getByPlaceholderText("e.g. 10")).toBeInTheDocument();
    });

    it("should render text filter input", async () => {
      const user = userEvent.setup();
      render(
        <PaginationToolbar {...makeProps({ filterConfigs: [textFilter] })} />
      );

      await user.click(screen.getByText("Filter"));
      expect(screen.getByPlaceholderText("Enter a tag")).toBeInTheDocument();
    });

    it("should call onFilterValueChange for text input", async () => {
      const onFilterValueChange = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar
          {...makeProps({ filterConfigs: [textFilter], onFilterValueChange })}
        />
      );

      await user.click(screen.getByText("Filter"));
      await user.type(screen.getByPlaceholderText("Enter a tag"), "x");
      expect(onFilterValueChange).toHaveBeenCalledWith("tag", "x");
    });
  });

  describe("active filter chips", () => {
    it("should render select filter chips", () => {
      render(
        <PaginationToolbar
          {...makeProps({
            filterConfigs: [selectFilter],
            filters: { category: ["crm"] },
          })}
        />
      );
      expect(screen.getByText("Category: CRM")).toBeInTheDocument();
    });

    it("should render boolean filter chip", () => {
      render(
        <PaginationToolbar
          {...makeProps({
            filterConfigs: [booleanFilter],
            filters: { isActive: ["true"] },
          })}
        />
      );
      expect(screen.getByText("Active: Yes")).toBeInTheDocument();
    });

    it("should render number filter chip", () => {
      render(
        <PaginationToolbar
          {...makeProps({
            filterConfigs: [numberFilter],
            filters: { minConnections: ["42"] },
          })}
        />
      );
      expect(screen.getByText("Min Connections: 42")).toBeInTheDocument();
    });

    it("should render text filter chip", () => {
      render(
        <PaginationToolbar
          {...makeProps({
            filterConfigs: [textFilter],
            filters: { tag: ["enterprise"] },
          })}
        />
      );
      expect(screen.getByText("Tag: enterprise")).toBeInTheDocument();
    });

    it("should not render chips for empty filter arrays", () => {
      render(
        <PaginationToolbar
          {...makeProps({
            filterConfigs: [booleanFilter],
            filters: { isActive: [] },
          })}
        />
      );
      expect(screen.queryByText(/Active:/)).not.toBeInTheDocument();
    });
  });

  describe("sort button", () => {
    it("should not render sort button when no sortFields", () => {
      render(<PaginationToolbar {...makeProps({ sortFields: [] })} />);
      expect(screen.queryByText("Sort")).not.toBeInTheDocument();
    });

    it("should render sort button when sortFields provided", () => {
      render(<PaginationToolbar {...makeProps({ sortFields })} />);
      expect(screen.getByText("Sort")).toBeInTheDocument();
    });

    it("should open sort popover with fields and direction", async () => {
      const user = userEvent.setup();
      render(<PaginationToolbar {...makeProps({ sortFields })} />);

      await user.click(screen.getByText("Sort"));
      expect(screen.getByText("Date Created")).toBeInTheDocument();
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Asc")).toBeInTheDocument();
      expect(screen.getByText("Desc")).toBeInTheDocument();
    });

    it("should call onSortByChange when a sort field is selected", async () => {
      const onSortByChange = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar {...makeProps({ sortFields, onSortByChange })} />
      );

      await user.click(screen.getByText("Sort"));
      await user.click(screen.getByText("Name"));
      expect(onSortByChange).toHaveBeenCalledWith("display");
    });

    it("should call onSortOrderChange when direction chip is clicked", async () => {
      const onSortOrderChange = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar {...makeProps({ sortFields, onSortOrderChange })} />
      );

      await user.click(screen.getByText("Sort"));
      await user.click(screen.getByText("Desc"));
      expect(onSortOrderChange).toHaveBeenCalledWith("desc");
    });
  });

  describe("pagination controls", () => {
    it("should display current page and total", () => {
      render(
        <PaginationToolbar
          {...makeProps({ currentPage: 3, totalPages: 5, total: 95 })}
        />
      );
      expect(screen.getByText("3 of 5 (95)")).toBeInTheDocument();
    });

    it("should disable first and prev buttons on first page", () => {
      render(
        <PaginationToolbar {...makeProps({ currentPage: 1, totalPages: 5 })} />
      );

      const firstBtn = screen.getByTestId("FirstPageIcon").closest("button")!;
      const prevBtn = screen.getByTestId("ChevronLeftIcon").closest("button")!;
      expect(firstBtn).toBeDisabled();
      expect(prevBtn).toBeDisabled();
    });

    it("should disable next and last buttons on last page", () => {
      render(
        <PaginationToolbar {...makeProps({ currentPage: 5, totalPages: 5 })} />
      );

      const nextBtn = screen.getByTestId("ChevronRightIcon").closest("button")!;
      const lastBtn = screen.getByTestId("LastPageIcon").closest("button")!;
      expect(nextBtn).toBeDisabled();
      expect(lastBtn).toBeDisabled();
    });

    it("should enable all buttons on middle page", () => {
      render(
        <PaginationToolbar {...makeProps({ currentPage: 3, totalPages: 5 })} />
      );

      const firstBtn = screen.getByTestId("FirstPageIcon").closest("button")!;
      const prevBtn = screen.getByTestId("ChevronLeftIcon").closest("button")!;
      const nextBtn = screen.getByTestId("ChevronRightIcon").closest("button")!;
      const lastBtn = screen.getByTestId("LastPageIcon").closest("button")!;
      expect(firstBtn).not.toBeDisabled();
      expect(prevBtn).not.toBeDisabled();
      expect(nextBtn).not.toBeDisabled();
      expect(lastBtn).not.toBeDisabled();
    });

    it("should call onFirst when first button is clicked", async () => {
      const onFirst = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar
          {...makeProps({ currentPage: 3, totalPages: 5, onFirst })}
        />
      );

      await user.click(screen.getByTestId("FirstPageIcon").closest("button")!);
      expect(onFirst).toHaveBeenCalledTimes(1);
    });

    it("should call onPrev when prev button is clicked", async () => {
      const onPrev = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar
          {...makeProps({ currentPage: 3, totalPages: 5, onPrev })}
        />
      );

      await user.click(
        screen.getByTestId("ChevronLeftIcon").closest("button")!
      );
      expect(onPrev).toHaveBeenCalledTimes(1);
    });

    it("should call onNext when next button is clicked", async () => {
      const onNext = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar
          {...makeProps({ currentPage: 3, totalPages: 5, onNext })}
        />
      );

      await user.click(
        screen.getByTestId("ChevronRightIcon").closest("button")!
      );
      expect(onNext).toHaveBeenCalledTimes(1);
    });

    it("should call onLast when last button is clicked", async () => {
      const onLast = jest.fn();
      const user = userEvent.setup();
      render(
        <PaginationToolbar
          {...makeProps({ currentPage: 3, totalPages: 5, onLast })}
        />
      );

      await user.click(screen.getByTestId("LastPageIcon").closest("button")!);
      expect(onLast).toHaveBeenCalledTimes(1);
    });
  });

  describe("snapshot", () => {
    it("should match snapshot with all features", () => {
      const { container } = render(
        <PaginationToolbar
          {...makeProps({
            search: "test",
            filterConfigs: allFilters,
            filters: { category: ["crm"], isActive: ["true"] },
            activeFilterCount: 2, // updated to reflect single-select
            sortFields,
            currentPage: 2,
            totalPages: 5,
            total: 95,
          })}
        />
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});
