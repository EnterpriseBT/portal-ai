import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  SearchableSelect,
  AsyncSearchableSelect,
  InfiniteScrollSelect,
} from "../ui/searchable-select/index";
import type { SelectOption } from "../ui/searchable-select/index";

// ── Sample data ───────────────────────────────────────────────────────────────

const FRUITS: SelectOption[] = [
  { value: "apple", label: "Apple" },
  { value: "apricot", label: "Apricot" },
  { value: "avocado", label: "Avocado" },
  { value: "banana", label: "Banana" },
  { value: "blueberry", label: "Blueberry" },
  { value: "cherry", label: "Cherry" },
  { value: "cranberry", label: "Cranberry" },
  { value: "date", label: "Date" },
  { value: "elderberry", label: "Elderberry" },
  { value: "fig", label: "Fig" },
  { value: "grape", label: "Grape" },
  { value: "grapefruit", label: "Grapefruit" },
  { value: "guava", label: "Guava" },
  { value: "kiwi", label: "Kiwi" },
  { value: "lemon", label: "Lemon" },
  { value: "lime", label: "Lime" },
  { value: "mango", label: "Mango" },
  { value: "melon", label: "Melon" },
  { value: "orange", label: "Orange" },
  { value: "papaya", label: "Papaya" },
  { value: "peach", label: "Peach" },
  { value: "pear", label: "Pear" },
  { value: "pineapple", label: "Pineapple" },
  { value: "plum", label: "Plum" },
  { value: "pomegranate", label: "Pomegranate" },
];

/** Simulate a server-side search with a 400ms delay. */
function simulateSearch(query: string, dataset: SelectOption[]): Promise<SelectOption[]> {
  return new Promise((resolve) => {
    setTimeout(() => {
      const lower = query.toLowerCase();
      resolve(
        lower
          ? dataset.filter((o) => o.label.toLowerCase().includes(lower))
          : dataset.slice(0, 10)
      );
    }, 400);
  });
}

/** Generate a large 200-item dataset for infinite scroll. */
const LARGE_DATASET: SelectOption[] = Array.from({ length: 200 }, (_, i) => ({
  value: `item-${i + 1}`,
  label: `Item ${String(i + 1).padStart(3, "0")}`,
}));

// ── SearchableSelect (synchronous) ────────────────────────────────────────────

const meta = {
  title: "Components/Form/SearchableSelect",
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Synchronous: Story = {
  name: "SearchableSelect — static list",
  render: function SyncDemo() {
    const [value, setValue] = useState<string | null>(null);
    return (
      <SearchableSelect
        label="Fruit"
        placeholder="Type to filter…"
        options={FRUITS}
        value={value}
        onChange={setValue}
        size="small"
        helperText={value ? `Selected: ${value}` : "Start typing to filter 25 fruits"}
      />
    );
  },
};

export const SynchronousWithError: Story = {
  name: "SearchableSelect — error state",
  render: function SyncErrorDemo() {
    const [value, setValue] = useState<string | null>(null);
    return (
      <SearchableSelect
        label="Fruit (required)"
        options={FRUITS}
        value={value}
        onChange={setValue}
        error={!value}
        helperText={!value ? "A fruit is required" : undefined}
        required
        size="small"
      />
    );
  },
};

// ── AsyncSearchableSelect (search-on-type) ────────────────────────────────────

export const Async: Story = {
  name: "AsyncSearchableSelect — server-side search",
  render: function AsyncDemo() {
    const [value, setValue] = useState<string | null>(null);
    return (
      <AsyncSearchableSelect
        label="Fruit (async)"
        placeholder="Type to search…"
        value={value}
        onChange={setValue}
        onSearch={(query) => simulateSearch(query, FRUITS)}
        debounceMs={300}
        helperText="Results fetched server-side after 400ms"
        size="small"
      />
    );
  },
};

// ── InfiniteScrollSelect (search + paginated scroll) ──────────────────────────

export const InfiniteScroll: Story = {
  name: "InfiniteScrollSelect — paginated browse",
  render: function InfiniteDemo() {
    const [value, setValue] = useState<string | null>(null);

    const fetchPage = async ({
      search,
      page,
      pageSize,
    }: {
      search: string;
      page: number;
      pageSize: number;
    }) => {
      await new Promise((r) => setTimeout(r, 300));
      const filtered = search
        ? LARGE_DATASET.filter((o) =>
            o.label.toLowerCase().includes(search.toLowerCase())
          )
        : LARGE_DATASET;
      const start = page * pageSize;
      const slice = filtered.slice(start, start + pageSize);
      return { options: slice, hasMore: start + pageSize < filtered.length };
    };

    return (
      <InfiniteScrollSelect
        label="Item (infinite)"
        placeholder="Browse or search 200 items…"
        value={value}
        onChange={setValue}
        fetchPage={fetchPage}
        pageSize={20}
        debounceMs={300}
        helperText="Scroll to load more items"
        size="small"
      />
    );
  },
};
