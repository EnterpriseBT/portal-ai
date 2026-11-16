import React, { useId } from "react";
import { Box, Button, Typography } from "@mui/material";

import type { RenderedFeature } from "./utils/rendered-features.util";

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface MapFeatureListUIProps {
  items: RenderedFeature[];
  /** Features in view, including those past the list's cap. */
  total: number;
  selectedKey: string | null;
  onSelect: (item: RenderedFeature) => void;
  /** Every current host (a portal session, a pin's detail page) puts the
   *  map directly under the page's h1, so 2 by default (#796 smoke: an h3
   *  failed axe's heading-order). A host with its own result headings passes
   *  one level below them. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}

/**
 * "Features in view" (#796): the features a map is drawing, as buttons a
 * keyboard or screen-reader user can walk. Selecting one opens its details on
 * the map and highlights it.
 */
export const MapFeatureListUI: React.FC<MapFeatureListUIProps> = ({
  items,
  total,
  selectedKey,
  onSelect,
  headingLevel = 2,
}) => {
  const headingId = useId();
  const more = total - items.length;
  return (
    <Box component="section" aria-labelledby={headingId}>
      <Typography
        id={headingId}
        component={`h${headingLevel}`}
        variant="subtitle2"
      >
        Features in view ({total.toLocaleString("en-US")})
      </Typography>
      {total === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No features in view.
        </Typography>
      ) : (
        <Box
          component="ul"
          data-testid="map-feature-list"
          // Styled from the theme (#796): `[data-visual-part="feature-list"]`.
          data-visual-part="feature-list"
        >
          {items.map((item) => (
            <li key={item.key}>
              <Button
                size="small"
                aria-pressed={item.key === selectedKey}
                data-feature-key={item.key}
                onClick={() => onSelect(item)}
                data-visual-part="feature-item"
              >
                {item.label}
              </Button>
            </li>
          ))}
          {more > 0 ? (
            <li>
              <Typography variant="caption" color="text.secondary">
                and {more.toLocaleString("en-US")} more. Zoom in to list them.
              </Typography>
            </li>
          ) : null}
        </Box>
      )}
    </Box>
  );
};
