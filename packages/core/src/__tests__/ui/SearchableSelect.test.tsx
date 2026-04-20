import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { SearchableSelect } from "../../ui/searchable-select/SearchableSelect";
import { AsyncSearchableSelect } from "../../ui/searchable-select/AsyncSearchableSelect";
import { InfiniteScrollSelect } from "../../ui/searchable-select/InfiniteScrollSelect";
import type { SelectOption } from "../../ui/searchable-select/types";

const OPTIONS: SelectOption[] = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
  { value: "date", label: "Date" },
  { value: "elderberry", label: "Elderberry" },
];

// ── SearchableSelect (synchronous) ────────────────────────────────────────────

describe("SearchableSelect", () => {
  it("renders with the provided options", async () => {
    render(
      <SearchableSelect
        label="Fruit"
        options={OPTIONS}
        value={null}
        onChange={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.getByText("Cherry")).toBeInTheDocument();
  });

  it("filters options when the user types", async () => {
    render(
      <SearchableSelect
        label="Fruit"
        options={OPTIONS}
        value={null}
        onChange={() => {}}
      />
    );

    const input = screen.getByRole("combobox");
    await userEvent.type(input, "an");

    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.queryByText("Apple")).not.toBeInTheDocument();
  });

  it("calls onChange with the option value when an option is selected", async () => {
    const handleChange = jest.fn();
    render(
      <SearchableSelect
        label="Fruit"
        options={OPTIONS}
        value={null}
        onChange={handleChange}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByText("Cherry"));

    expect(handleChange).toHaveBeenCalledWith("cherry");
  });

  it("calls onChange(null) when the selection is cleared", async () => {
    const handleChange = jest.fn();
    render(
      <SearchableSelect
        label="Fruit"
        options={OPTIONS}
        value="apple"
        onChange={handleChange}
      />
    );

    const clearButton = screen.getByTitle("Clear");
    await userEvent.click(clearButton);

    expect(handleChange).toHaveBeenCalledWith(null);
  });
});

// ── AsyncSearchableSelect (search-on-type) ────────────────────────────────────

describe("AsyncSearchableSelect", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("calls onSearch('') on mount to load initial options", async () => {
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue(OPTIONS);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value={null}
          onChange={() => {}}
          onSearch={onSearch}
        />
      );
    });

    expect(onSearch).toHaveBeenCalledWith("");
  });

  it("debounces search after user types (does not fire synchronously)", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([]);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value={null}
          onChange={() => {}}
          onSearch={onSearch}
          debounceMs={300}
        />
      );
    });

    const initialCallCount = onSearch.mock.calls.length; // from mount
    const input = screen.getByRole("combobox");
    await user.type(input, "ban");

    // Debounce not yet elapsed — no additional onSearch call
    expect(onSearch).toHaveBeenCalledTimes(initialCallCount);
  });

  it("calls onSearch with query after debounce delay", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([{ value: "banana", label: "Banana" }]);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value={null}
          onChange={() => {}}
          onSearch={onSearch}
          debounceMs={300}
        />
      );
    });

    const input = screen.getByRole("combobox");
    await user.type(input, "ban");

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith("ban");
    });
  });

  it("replaces options with each new search result", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    let callCount = 0;
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockImplementation(async () => {
        callCount++;
        // First call is initial load, second is "b", third is "c"
        if (callCount <= 2) return [{ value: "banana", label: "Banana" }];
        return [{ value: "cherry", label: "Cherry" }];
      });

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value={null}
          onChange={() => {}}
          onSearch={onSearch}
          debounceMs={300}
        />
      );
    });

    const input = screen.getByRole("combobox");

    // First user search
    await user.type(input, "b");
    act(() => {
      jest.advanceTimersByTime(300);
    });
    await waitFor(() => expect(screen.getByText("Banana")).toBeInTheDocument());

    // Clear input and type new query
    await user.clear(input);
    await user.type(input, "c");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Previous result should be replaced
    await waitFor(() => {
      expect(screen.queryByText("Banana")).not.toBeInTheDocument();
      expect(screen.getByText("Cherry")).toBeInTheDocument();
    });
  });

  it("shows a loading indicator while the search is in-flight", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    let resolveSearch!: (options: SelectOption[]) => void;
    let callCount = 0;
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve([]); // initial load resolves fast
        return new Promise<SelectOption[]>((resolve) => {
          resolveSearch = resolve;
        });
      });

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value={null}
          onChange={() => {}}
          onSearch={onSearch}
          debounceMs={300}
        />
      );
    });

    const input = screen.getByRole("combobox");
    await user.type(input, "ban");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("ban"));

    // Loading spinner should be visible while in-flight
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    // Resolve the search
    await act(async () => {
      resolveSearch([{ value: "banana", label: "Banana" }]);
    });
  });

  it("retains search text in input after results are loaded", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([{ value: "banana", label: "Banana" }]);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value={null}
          onChange={() => {}}
          onSearch={onSearch}
          debounceMs={300}
        />
      );
    });

    const input = screen.getByRole("combobox");
    await user.type(input, "ban");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(screen.getByText("Banana")).toBeInTheDocument());

    // Input must show the search text, not the option label
    expect(input).toHaveValue("ban");
  });

  it("displays selected value as a Chip above the input when value is set", async () => {
    const loadSelectedOption = jest
      .fn<() => Promise<SelectOption | null>>()
      .mockResolvedValue({ value: "banana", label: "Banana" });
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([]);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value="banana"
          onChange={() => {}}
          onSearch={onSearch}
          loadSelectedOption={loadSelectedOption}
        />
      );
    });

    // Chip should show the option label
    expect(screen.getByText("Banana")).toBeInTheDocument();
    // Input should be empty (search query), not showing the selected label
    expect(screen.getByRole("combobox")).toHaveValue("");
  });

  it("clears selection when Chip delete icon is clicked", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onChange = jest.fn();
    const loadSelectedOption = jest
      .fn<() => Promise<SelectOption | null>>()
      .mockResolvedValue({ value: "banana", label: "Banana" });
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([]);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value="banana"
          onChange={onChange}
          onSearch={onSearch}
          loadSelectedOption={loadSelectedOption}
        />
      );
    });

    // Click the chip's delete button (MUI Chip renders a button with role)
    const chip = screen.getByText("Banana").closest(".MuiChip-root")!;
    const deleteButton = chip.querySelector(".MuiChip-deleteIcon")!;
    await user.click(deleteButton);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("calls loadSelectedOption on mount when value is set", async () => {
    const loadSelectedOption = jest
      .fn<() => Promise<SelectOption | null>>()
      .mockResolvedValue({ value: "id-123", label: "Loaded by ID" });
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([]);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value="id-123"
          onChange={() => {}}
          onSearch={onSearch}
          loadSelectedOption={loadSelectedOption}
        />
      );
    });

    expect(loadSelectedOption).toHaveBeenCalledWith("id-123");
    // Chip should show the loaded label
    expect(screen.getByText("Loaded by ID")).toBeInTheDocument();
  });

  it("retains loaded option label after debounce fires on mount", async () => {
    let resolveLoad!: (opt: SelectOption) => void;
    const loadSelectedOption = jest
      .fn<() => Promise<SelectOption | null>>()
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveLoad = resolve;
          })
      );
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([{ value: "common-1", label: "Common One" }]);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Column"
          value="slow-id"
          onChange={() => {}}
          onSearch={onSearch}
          loadSelectedOption={loadSelectedOption}
          debounceMs={200}
        />
      );
    });

    // loadSelectedOption is in-flight; advance past debounce delay
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // Now resolve loadSelectedOption after the debounce window
    await act(async () => {
      resolveLoad({ value: "slow-id", label: "Slow Column" });
    });

    // Chip should show the resolved label, not the raw ID
    await waitFor(() => {
      expect(screen.getByText("Slow Column")).toBeInTheDocument();
    });
  });

  it("preserves selected option label after a subsequent search replaces options", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const loadSelectedOption = jest
      .fn<() => Promise<SelectOption | null>>()
      .mockResolvedValue({ value: "rare-id", label: "Rare Array Column" });
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([
        { value: "common-1", label: "Common One" },
        { value: "common-2", label: "Common Two" },
      ]);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Column"
          value="rare-id"
          onChange={() => {}}
          onSearch={onSearch}
          loadSelectedOption={loadSelectedOption}
          debounceMs={300}
        />
      );
    });

    // Selected option label should be visible in chip after mount
    const chipLabel = () => {
      const labels = document.querySelectorAll(".MuiChip-label");
      return Array.from(labels).find(
        (el) => el.textContent === "Rare Array Column"
      );
    };
    expect(chipLabel()).toBeTruthy();

    // Type a search that returns results NOT including the selected option
    const input = screen.getByRole("combobox");
    await user.type(input, "common");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith("common"));

    // The chip should still show the resolved label, not the raw ID
    await waitFor(() => expect(chipLabel()).toBeTruthy());
  });

  it("does not call loadSelectedOption when value is null", async () => {
    const loadSelectedOption = jest
      .fn<() => Promise<SelectOption | null>>()
      .mockResolvedValue(null);
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([]);

    await act(async () => {
      render(
        <AsyncSearchableSelect
          label="Fruit"
          value={null}
          onChange={() => {}}
          onSearch={onSearch}
          loadSelectedOption={loadSelectedOption}
        />
      );
    });

    expect(loadSelectedOption).not.toHaveBeenCalled();
    // Should have called default onSearch('') instead
    expect(onSearch).toHaveBeenCalledWith("");
  });
});

// ── InfiniteScrollSelect (search + paginated scroll) ──────────────────────────

describe("InfiniteScrollSelect", () => {
  let observerCallback: IntersectionObserverCallback;
  let mockObserver: {
    observe: jest.Mock;
    disconnect: jest.Mock;
    unobserve: jest.Mock;
  };

  beforeEach(() => {
    mockObserver = {
      observe: jest.fn(),
      disconnect: jest.fn(),
      unobserve: jest.fn(),
    };

    globalThis.IntersectionObserver = jest.fn(
      (cb: IntersectionObserverCallback) => {
        observerCallback = cb;
        return mockObserver;
      }
    ) as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls fetchPage on open with page 0", async () => {
    const fetchPage = jest
      .fn<() => Promise<{ options: SelectOption[]; hasMore: boolean }>>()
      .mockResolvedValue({ options: OPTIONS, hasMore: false });

    render(
      <InfiniteScrollSelect
        label="Fruit"
        value={null}
        onChange={() => {}}
        fetchPage={fetchPage}
        pageSize={5}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));

    await waitFor(() => {
      expect(fetchPage).toHaveBeenCalledWith({
        search: "",
        page: 0,
        pageSize: 5,
      });
    });
  });

  it("appends results when the scroll sentinel enters the viewport", async () => {
    const page0 = OPTIONS.slice(0, 3).map((o) => ({ ...o }));
    const page1 = OPTIONS.slice(3).map((o) => ({ ...o }));

    const fetchPage = jest
      .fn<() => Promise<{ options: SelectOption[]; hasMore: boolean }>>()
      .mockResolvedValueOnce({ options: page0, hasMore: true })
      .mockResolvedValueOnce({ options: page1, hasMore: false });

    render(
      <InfiniteScrollSelect
        label="Fruit"
        value={null}
        onChange={() => {}}
        fetchPage={fetchPage}
        pageSize={3}
      />
    );

    // Open dropdown — triggers page 0
    await userEvent.click(screen.getByRole("combobox"));
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));

    // Verify first page items are present
    expect(screen.getByText("Apple")).toBeInTheDocument();

    // Simulate sentinel entering viewport to trigger page 1
    await act(async () => {
      observerCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        mockObserver as unknown as IntersectionObserver
      );
    });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage).toHaveBeenLastCalledWith({
      search: "",
      page: 1,
      pageSize: 3,
    });
  });

  it("resets options and refetches on search input change", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    const fetchPage = jest
      .fn<() => Promise<{ options: SelectOption[]; hasMore: boolean }>>()
      .mockResolvedValue({
        options: [{ value: "apple", label: "Apple" }],
        hasMore: false,
      });

    render(
      <InfiniteScrollSelect
        label="Fruit"
        value={null}
        onChange={() => {}}
        fetchPage={fetchPage}
        pageSize={20}
        debounceMs={300}
      />
    );

    await user.click(screen.getByRole("combobox"));
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));

    const input = screen.getByRole("combobox");
    await user.type(input, "app");

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    expect(fetchPage).toHaveBeenLastCalledWith({
      search: "app",
      page: 0,
      pageSize: 20,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("retains input value after search results are loaded", async () => {
    jest.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    const fetchPage = jest
      .fn<() => Promise<{ options: SelectOption[]; hasMore: boolean }>>()
      .mockResolvedValue({
        options: [{ value: "apple", label: "Apple" }],
        hasMore: false,
      });

    render(
      <InfiniteScrollSelect
        label="Fruit"
        value={null}
        onChange={() => {}}
        fetchPage={fetchPage}
        pageSize={20}
        debounceMs={300}
      />
    );

    await user.click(screen.getByRole("combobox"));
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));

    const input = screen.getByRole("combobox");
    await user.type(input, "app");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText("Apple")).toBeInTheDocument());

    // Input must not be reset by MUI's internal "reset" event when options load
    expect(input).toHaveValue("app");

    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("does not fetch the next page when hasMore is false", async () => {
    const fetchPage = jest
      .fn<() => Promise<{ options: SelectOption[]; hasMore: boolean }>>()
      .mockResolvedValue({ options: OPTIONS, hasMore: false });

    render(
      <InfiniteScrollSelect
        label="Fruit"
        value={null}
        onChange={() => {}}
        fetchPage={fetchPage}
        pageSize={5}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));

    // Simulate sentinel intersection — hasMore is false, so no additional fetch
    await act(async () => {
      observerCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        mockObserver as unknown as IntersectionObserver
      );
    });

    // Still only one call
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
