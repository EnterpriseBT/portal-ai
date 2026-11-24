import { Icon, IconName } from "@portalai/core/ui";

import type { BooleanFilterConfig } from "../components/PaginationToolbar.component";

/**
 * #1072: the "Favorites" toggle, led by the favorite star, that the station,
 * pinned-result, view and connector lists put in their toolbar. Pressed, the
 * list asks for `favorite=true`; unpressed, the filter is cleared. A list
 * shows its favorites explainer on an empty page when
 * `pagination.isOnlyFilter(FAVORITE_FILTER.field)`.
 */
export const FAVORITE_FILTER: BooleanFilterConfig = {
  type: "boolean",
  field: "favorite",
  label: "Favorites",
  placement: "toolbar",
  icon: <Icon name={IconName.Star} />,
};
