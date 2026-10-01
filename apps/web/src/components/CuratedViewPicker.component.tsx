import React, { useCallback, useMemo } from "react";

import { MultiAsyncSearchableSelect } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import { sdk } from "../api/sdk";

/** How many views one search returns. The list is searched, never frontloaded. */
const SEARCH_LIMIT = 20;

export interface CuratedViewPickerUIProps {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Labels for already-selected ids (from the station GET), so a seeded
   *  chip shows its name without a second fetch. */
  selectedLabels?: Record<string, string>;
  /** Searches the views the viewer can read. */
  fetchOptions: (query: string) => Promise<SelectOption[]>;
  helperText?: string;
  disabled?: boolean;
}

/**
 * Searchable multi-select over curated views (#674). Every option comes from
 * `fetchOptions`; a seeded selection is labelled from `selectedLabels`, which
 * are merged into each result so the select resolves them without a lookup.
 */
export const CuratedViewPickerUI: React.FC<CuratedViewPickerUIProps> = ({
  selected,
  onChange,
  selectedLabels,
  fetchOptions,
  helperText,
  disabled,
}) => {
  // Seeded labels join every result set (filtered by the query like the rest),
  // so a selected id the search didn't return still resolves to its name.
  // A seeded id the user has removed reappears as an ordinary option. Pass
  // a stable `selectedLabels`: the select re-searches when `onSearch` changes.
  const onSearch = useCallback(
    async (query: string): Promise<SelectOption[]> => {
      const results = await fetchOptions(query);
      const found = new Set(results.map((o) => String(o.value)));
      const q = query.trim().toLowerCase();
      const seeded = Object.entries(selectedLabels ?? {})
        .filter(
          ([id, label]) => !found.has(id) && label.toLowerCase().includes(q)
        )
        .map(([id, label]) => ({ value: id, label }));
      return [...results, ...seeded];
    },
    [fetchOptions, selectedLabels]
  );

  return (
    <MultiAsyncSearchableSelect
      label="Views"
      placeholder="Search views..."
      value={selected}
      onChange={onChange}
      onSearch={onSearch}
      helperText={helperText}
      disabled={disabled}
      fullWidth
    />
  );
};

export type CuratedViewPickerProps = Omit<
  CuratedViewPickerUIProps,
  "fetchOptions"
>;

/** Wires the picker to `sdk.curatedViews.search` (visibility-filtered server-side). */
export const CuratedViewPicker: React.FC<CuratedViewPickerProps> = (props) => {
  const { mutateAsync: searchViews } = sdk.curatedViews.search();
  const fetchOptions = useMemo(
    () =>
      async (query: string): Promise<SelectOption[]> => {
        const res = await searchViews({ search: query, limit: SEARCH_LIMIT });
        return res.curatedViews.map((v) => ({ value: v.id, label: v.label }));
      },
    [searchViews]
  );
  return <CuratedViewPickerUI {...props} fetchOptions={fetchOptions} />;
};
