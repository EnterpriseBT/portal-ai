import React from "react";
import { Box, Stack, Typography } from "@portalai/core/ui";

import type { EntityLegendEntry } from "./utils/region-editor.types";

export interface EntityLegendUIProps {
  entries: EntityLegendEntry[];
  selectedEntityId?: string | null;
  onEntitySelect?: (entityId: string) => void;
}

export const EntityLegendUI: React.FC<EntityLegendUIProps> = ({
  entries,
  selectedEntityId,
  onEntitySelect,
}) => {
  if (entries.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No entities bound yet.
      </Typography>
    );
  }

  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {entries.map((entry) => {
        const isSelected = entry.id === selectedEntityId;
        const interactive = Boolean(onEntitySelect);
        return (
          <Box
            key={entry.id}
            onClick={() => onEntitySelect?.(entry.id)}
            sx={{
              display: "inline-flex",
              alignItems: "center",
              gap: 0.75,
              border: "1px solid",
              borderColor: isSelected ? entry.color : "divider",
              borderRadius: 16,
              backgroundColor: isSelected ? `${entry.color}14` : "background.paper",
              px: 1,
              py: 0.25,
              cursor: interactive ? "pointer" : "default",
            }}
          >
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                backgroundColor: entry.color,
              }}
            />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              {entry.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {entry.regionCount} {entry.regionCount === 1 ? "region" : "regions"}
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );
};
