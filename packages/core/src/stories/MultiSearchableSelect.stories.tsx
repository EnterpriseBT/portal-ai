import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  MultiSearchableSelect,
  MultiAsyncSearchableSelect,
  MultiInfiniteScrollSelect,
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

const LARGE_DATASET: SelectOption[] = Array.from({ length: 200 }, (_, i) => ({
  value: `item-${i + 1}`,
  label: `Item ${String(i + 1).padStart(3, "0")}`,
}));

// ── Meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Components/Form/MultiSearchableSelect",
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// ── MultiSearchableSelect (synchronous) ──────────────────────────────────────

export const Synchronous: Story = {
  name: "MultiSearchableSelect — static list",
  render: function MultiSyncDemo() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <MultiSearchableSelect
        label="Fruits"
        placeholder="Type to filter…"
        options={FRUITS}
        value={value}
        onChange={setValue}
        size="small"
        helperText={`${value.length} selected`}
      />
    );
  },
};

// ── MultiAsyncSearchableSelect (search-on-type) ─────────────────────────────

export const Async: Story = {
  name: "MultiAsyncSearchableSelect — server-side search",
  render: function MultiAsyncDemo() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <MultiAsyncSearchableSelect
        label="Fruits (async)"
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

// ── MultiInfiniteScrollSelect (search + paginated scroll) ───────────────────

export const InfiniteScroll: Story = {
  name: "MultiInfiniteScrollSelect — paginated browse",
  render: function MultiInfiniteDemo() {
    const [value, setValue] = useState<string[]>([]);

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
      <MultiInfiniteScrollSelect
        label="Items (infinite)"
        placeholder="Browse or search 200 items…"
        value={value}
        onChange={setValue}
        fetchPage={fetchPage}
        pageSize={20}
        debounceMs={300}
        helperText={`${value.length} selected — scroll to load more`}
        size="small"
      />
    );
  },
};
