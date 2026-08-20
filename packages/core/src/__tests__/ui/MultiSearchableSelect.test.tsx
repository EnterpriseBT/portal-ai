import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { MultiSearchableSelect } from "../../ui/searchable-select/MultiSearchableSelect";
import { MultiAsyncSearchableSelect } from "../../ui/searchable-select/MultiAsyncSearchableSelect";
import { MultiInfiniteScrollSelect } from "../../ui/searchable-select/MultiInfiniteScrollSelect";
import type { SelectOption } from "../../ui/searchable-select/types";

const OPTIONS: SelectOption[] = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
  { value: "cherry", label: "Cherry" },
  { value: "date", label: "Date" },
  { value: "elderberry", label: "Elderberry" },
];

// ── MultiSearchableSelect ────────────────────────────────────────────────────

describe("MultiSearchableSelect", () => {
  it("renders with the provided options", async () => {
    render(
      <MultiSearchableSelect
        label="Fruits"
        options={OPTIONS}
        value={[]}
        onChange={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });

  it("calls onChange with string[] when options are selected", async () => {
    const handleChange = jest.fn();
    render(
      <MultiSearchableSelect
        label="Fruits"
        options={OPTIONS}
        value={[]}
        onChange={handleChange}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByText("Cherry"));

    expect(handleChange).toHaveBeenCalledWith(["cherry"]);
  });

  it("shows selected values as chips", () => {
    render(
      <MultiSearchableSelect
        label="Fruits"
        options={OPTIONS}
        value={["apple", "banana"]}
        onChange={() => {}}
      />
    );

    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
  });

  it("calls onChange without the removed value when a chip is deleted", async () => {
    const handleChange = jest.fn();
    render(
      <MultiSearchableSelect
        label="Fruits"
        options={OPTIONS}
        value={["apple", "banana"]}
        onChange={handleChange}
      />
    );

    // Find the delete button on the "Apple" chip
    const appleChip = screen.getByText("Apple").closest(".MuiChip-root")!;
    const deleteBtn = appleChip.querySelector("[data-testid='CancelIcon']")!;
    await userEvent.click(deleteBtn);

    expect(handleChange).toHaveBeenCalledWith(["banana"]);
  });

  it("filters options when the user types", async () => {
    render(
      <MultiSearchableSelect
        label="Fruits"
        options={OPTIONS}
        value={[]}
        onChange={() => {}}
      />
    );

    const input = screen.getByRole("combobox");
    await userEvent.type(input, "an");

    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.queryByText("Cherry")).not.toBeInTheDocument();
  });

  // ── Per-option disabling (#284) ───────────────────────────────────────────
  //
  // `SelectOption.disabled` has been in the type since the component shipped
  // but was never threaded to MUI — a declared-and-ignored prop. #284 needs it
  // for unentitled toolpacks (visible, unselectable, with a reason), so it
  // becomes real here for every consumer.

  const WITH_DISABLED: SelectOption[] = [
    { value: "apple", label: "Apple" },
    {
      value: "banana",
      label: "Banana",
      disabled: true,
      disabledReason: "Not included in your plan",
    },
  ];

  it("marks a disabled option aria-disabled and refuses to select it", async () => {
    const handleChange = jest.fn();
    render(
      <MultiSearchableSelect
        label="Fruits"
        options={WITH_DISABLED}
        value={[]}
        onChange={handleChange}
      />
    );

    const input = screen.getByRole("combobox");
    await userEvent.click(input);

    const option = screen.getByText("Banana").closest("li")!;
    expect(option).toHaveAttribute("aria-disabled", "true");

    // Pointer: MUI drops pointer events on a disabled option, so a real click
    // cannot reach it at all — user-event refuses the interaction the same way
    // a browser would.
    await expect(userEvent.click(option)).rejects.toThrow(/pointer-events/);

    // Keyboard: narrow to the disabled option only, then try to commit it.
    // MUI's highlight skips disabled options and Enter bails on them.
    await userEvent.type(input, "Banana");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(handleChange).not.toHaveBeenCalled();
  });

  it("renders disabledReason under the label of a disabled option", async () => {
    render(
      <MultiSearchableSelect
        label="Fruits"
        options={WITH_DISABLED}
        value={[]}
        onChange={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("Not included in your plan")).toBeInTheDocument();
    // The enabled option carries no reason line.
    const appleOption = screen.getByText("Apple").closest("li")!;
    expect(appleOption).not.toHaveAttribute("aria-disabled", "true");
    expect(appleOption.textContent).toBe("Apple");
  });

  it("ignores disabledReason on an enabled option", async () => {
    render(
      <MultiSearchableSelect
        label="Fruits"
        options={[
          { value: "apple", label: "Apple", disabledReason: "should not show" },
        ]}
        value={[]}
        onChange={() => {}}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.queryByText("should not show")).not.toBeInTheDocument();
  });

  it("keeps an already-selected value whose option is now disabled, and lets it be removed", async () => {
    // The downgrade case: a station already carries a pack the plan no longer
    // includes. The selection must not vanish, and the user must still be able
    // to drop it — disabling governs ADDING, never removing.
    const handleChange = jest.fn();
    render(
      <MultiSearchableSelect
        label="Fruits"
        options={WITH_DISABLED}
        value={["banana"]}
        onChange={handleChange}
      />
    );

    const chip = screen.getByText("Banana").closest(".MuiChip-root")!;
    expect(chip).toBeInTheDocument();

    const deleteBtn = chip.querySelector("[data-testid='CancelIcon']")!;
    await userEvent.click(deleteBtn);

    expect(handleChange).toHaveBeenCalledWith([]);
  });
});

// ── MultiAsyncSearchableSelect ───────────────────────────────────────────────

describe("MultiAsyncSearchableSelect", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("calls onSearch after debounce and shows results", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([{ value: "banana", label: "Banana" }]);

    await act(async () => {
      render(
        <MultiAsyncSearchableSelect
          label="Fruits"
          value={[]}
          onChange={() => {}}
          onSearch={onSearch}
          debounceMs={300}
        />
      );
    });

    const initialCallCount = onSearch.mock.calls.length; // from mount
    const input = screen.getByRole("combobox");
    await user.type(input, "ban");

    // Not called before debounce (beyond initial mount call)
    expect(onSearch).toHaveBeenCalledTimes(initialCallCount);

    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith("ban");
    });
  });

  it("calls onChange with accumulated values on selection", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const handleChange = jest.fn();
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([
        { value: "banana", label: "Banana" },
        { value: "blueberry", label: "Blueberry" },
      ]);

    render(
      <MultiAsyncSearchableSelect
        label="Fruits"
        value={[]}
        onChange={handleChange}
        onSearch={onSearch}
        debounceMs={300}
      />
    );

    const input = screen.getByRole("combobox");
    await user.type(input, "b");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(onSearch).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Banana")).toBeInTheDocument());
    await user.click(screen.getByText("Banana"));

    expect(handleChange).toHaveBeenCalledWith(["banana"]);
  });

  it("shows a loading indicator while the search is in-flight", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    let resolveSearch!: (options: SelectOption[]) => void;
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockImplementation(
        () =>
          new Promise<SelectOption[]>((resolve) => {
            resolveSearch = resolve;
          })
      );

    render(
      <MultiAsyncSearchableSelect
        label="Fruits"
        value={[]}
        onChange={() => {}}
        onSearch={onSearch}
        debounceMs={300}
      />
    );

    const input = screen.getByRole("combobox");
    await user.type(input, "ban");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(onSearch).toHaveBeenCalled());
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    await act(async () => {
      resolveSearch([{ value: "banana", label: "Banana" }]);
    });
  });

  it("retains input value after search results are loaded", async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const onSearch = jest
      .fn<() => Promise<SelectOption[]>>()
      .mockResolvedValue([{ value: "banana", label: "Banana" }]);

    render(
      <MultiAsyncSearchableSelect
        label="Fruits"
        value={[]}
        onChange={() => {}}
        onSearch={onSearch}
        debounceMs={300}
      />
    );

    const input = screen.getByRole("combobox");
    await user.type(input, "ban");
    act(() => {
      jest.advanceTimersByTime(300);
    });

    await waitFor(() => expect(screen.getByText("Banana")).toBeInTheDocument());

    // Input must not be reset by MUI's internal "reset" event when options load
    expect(input).toHaveValue("ban");
  });

  describe("search failure", () => {
    async function renderAndFailSearch(onSearchError: (e: unknown) => void) {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const boom = new Error("no drive");
      let callCount = 0;
      const onSearch = jest
        .fn<() => Promise<SelectOption[]>>()
        .mockImplementation(async () => {
          callCount++;
          if (callCount === 1) return [{ value: "banana", label: "Banana" }];
          throw boom;
        });

      await act(async () => {
        render(
          <MultiAsyncSearchableSelect
            label="Fruits"
            value={[]}
            onChange={() => {}}
            onSearch={onSearch}
            debounceMs={300}
            onSearchError={onSearchError}
          />
        );
      });

      const input = screen.getByRole("combobox");
      await user.type(input, "b");
      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      return { boom };
    }

    it("calls onSearchError once with the rejection", async () => {
      const onSearchError = jest.fn();
      const { boom } = await renderAndFailSearch(
        onSearchError as (e: unknown) => void
      );
      expect(onSearchError).toHaveBeenCalledTimes(1);
      expect(onSearchError).toHaveBeenCalledWith(boom);
    });

    it("clears stale options on rejection", async () => {
      await renderAndFailSearch(jest.fn() as (e: unknown) => void);
      expect(screen.queryByText("Banana")).not.toBeInTheDocument();
    });
  });
});

// ── MultiInfiniteScrollSelect ────────────────────────────────────────────────

describe("MultiInfiniteScrollSelect", () => {
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
      <MultiInfiniteScrollSelect
        label="Fruits"
        value={[]}
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

  it("calls onChange with selected values", async () => {
    const handleChange = jest.fn();
    const fetchPage = jest
      .fn<() => Promise<{ options: SelectOption[]; hasMore: boolean }>>()
      .mockResolvedValue({ options: OPTIONS, hasMore: false });

    render(
      <MultiInfiniteScrollSelect
        label="Fruits"
        value={[]}
        onChange={handleChange}
        fetchPage={fetchPage}
        pageSize={5}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    await waitFor(() => expect(fetchPage).toHaveBeenCalled());

    await userEvent.click(screen.getByText("Cherry"));
    expect(handleChange).toHaveBeenCalledWith(["cherry"]);
  });

  it("appends results when the scroll sentinel enters the viewport", async () => {
    const page0 = OPTIONS.slice(0, 3).map((o) => ({ ...o }));
    const page1 = OPTIONS.slice(3).map((o) => ({ ...o }));

    const fetchPage = jest
      .fn<() => Promise<{ options: SelectOption[]; hasMore: boolean }>>()
      .mockResolvedValueOnce({ options: page0, hasMore: true })
      .mockResolvedValueOnce({ options: page1, hasMore: false });

    render(
      <MultiInfiniteScrollSelect
        label="Fruits"
        value={[]}
        onChange={() => {}}
        fetchPage={fetchPage}
        pageSize={3}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));

    expect(screen.getByText("Apple")).toBeInTheDocument();

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
      <MultiInfiniteScrollSelect
        label="Fruits"
        value={[]}
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
      <MultiInfiniteScrollSelect
        label="Fruits"
        value={[]}
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
      <MultiInfiniteScrollSelect
        label="Fruits"
        value={[]}
        onChange={() => {}}
        fetchPage={fetchPage}
        pageSize={5}
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(1));

    await act(async () => {
      observerCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        mockObserver as unknown as IntersectionObserver
      );
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
