import React from "react";
import { Box, Typography } from "@mui/material";

/**
 * Overlaid on a map whose basemap style failed or timed out (#910): the data
 * layers still render on a blank background, and this says why the background
 * is blank. Absolutely positioned so it never shifts the map's layout.
 */
export const BasemapUnavailableNotice: React.FC = () => (
  <Box
    role="status"
    data-testid="map-widget-basemap-unavailable"
    sx={{
      position: "absolute",
      left: 8,
      bottom: 8,
      px: 1,
      py: 0.25,
      borderRadius: 1,
      bgcolor: "background.paper",
      boxShadow: 1,
      pointerEvents: "none",
    }}
  >
    <Typography variant="caption" color="text.secondary">
      Basemap unavailable
    </Typography>
  </Box>
);
