import { sdk } from "../api/sdk";
import type { MultiSelectFilterConfig } from "../components/PaginationToolbar.component";

/**
 * A list's Tags filter (#1070): a multi-select over the org's tags whose
 * values go out as `tagIds`, which every taggable list matches as
 * "carries any of these".
 */
export function useTagFilter(): MultiSelectFilterConfig {
  const { onSearch, labelMap } = sdk.entityTags.search();
  return {
    type: "multi-select",
    field: "tagIds",
    label: "Tags",
    onSearch,
    labelMap,
  };
}
