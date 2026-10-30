import React from "react";
import { Box, Link, Typography } from "@mui/material";

import type { AttributionPart } from "./utils/attribution.util";

export interface MapAttributionUIProps {
  /** One entry per credited source, already reduced to safe parts. */
  attributions: AttributionPart[][];
}

/**
 * The map's attribution (#928), in place of MapLibre's control, which renders
 * source attribution as HTML. Parts come from `toSafeAttribution`, so this
 * renders only text and allow-listed links; React escapes the text. Overlaid
 * bottom-right so it never shifts the map's layout.
 */
export const MapAttributionUI: React.FC<MapAttributionUIProps> = ({
  attributions,
}) => {
  if (attributions.length === 0) return null;
  return (
    <Box
      data-testid="map-attribution"
      sx={{
        position: "absolute",
        right: 0,
        bottom: 0,
        maxWidth: "70%",
        px: 0.75,
        py: 0.125,
        borderTopLeftRadius: 4,
        bgcolor: "background.paper",
        opacity: 0.85,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {attributions.map((parts, i) => (
          <React.Fragment key={i}>
            {i > 0 ? " | " : null}
            {parts.map((part, j) =>
              part.href ? (
                <Link
                  key={j}
                  href={part.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  color="inherit"
                >
                  {part.text}
                </Link>
              ) : (
                <React.Fragment key={j}>{part.text}</React.Fragment>
              )
            )}
          </React.Fragment>
        ))}
      </Typography>
    </Box>
  );
};
