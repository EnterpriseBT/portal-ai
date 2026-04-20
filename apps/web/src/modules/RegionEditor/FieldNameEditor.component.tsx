import React from "react";
import { Box, Stack, TextInput } from "@portalai/core/ui";

import { defaultFieldNamesForRegion } from "./utils/a1-notation.util";
import type { RegionDraft } from "./utils/region-editor.types";

export interface FieldNameEditorUIProps {
  region: RegionDraft;
  onUpdate: (updates: Partial<RegionDraft>) => void;
}

export const FieldNameEditorUI: React.FC<FieldNameEditorUIProps> = ({
  region,
  onUpdate,
}) => {
  const defaults = defaultFieldNamesForRegion(
    region.bounds,
    region.orientation
  );
  const overrides = region.columnOverrides ?? {};
  return (
    <Stack spacing={0.75}>
      {defaults.map((defaultName) => (
        <Stack
          key={defaultName}
          direction="row"
          spacing={1}
          alignItems="center"
        >
          <Box
            sx={{
              width: 88,
              fontFamily: "monospace",
              fontSize: 12,
              color: "text.secondary",
              flexShrink: 0,
            }}
          >
            {defaultName}
          </Box>
          <TextInput
            size="small"
            fullWidth
            value={overrides[defaultName] ?? ""}
            onChange={(e) => {
              const nextOverrides = { ...overrides };
              if (e.target.value) {
                nextOverrides[defaultName] = e.target.value;
              } else {
                delete nextOverrides[defaultName];
              }
              onUpdate({
                columnOverrides:
                  Object.keys(nextOverrides).length > 0
                    ? nextOverrides
                    : undefined,
              });
            }}
            placeholder={defaultName}
          />
        </Stack>
      ))}
    </Stack>
  );
};
