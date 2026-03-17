import React, { useCallback } from "react";

import { Box, Stack, Typography, TextInput, Divider } from "@portalai/core/ui";

import type { RecommendedEntity } from "./utils/upload-workflow.util";

// --- Types ---

interface EntityStepProps {
  entities: RecommendedEntity[];
  files: File[];
  onUpdateEntity: (index: number, updates: Partial<RecommendedEntity>) => void;
}

// --- Component ---

export const EntityStep: React.FC<EntityStepProps> = ({
  entities,
  files,
  onUpdateEntity,
}) => {
  const handleKeyChange = useCallback(
    (index: number, key: string) => {
      onUpdateEntity(index, {
        connectorEntity: { ...entities[index].connectorEntity, key },
      });
    },
    [entities, onUpdateEntity]
  );

  const handleLabelChange = useCallback(
    (index: number, label: string) => {
      onUpdateEntity(index, {
        connectorEntity: { ...entities[index].connectorEntity, label },
      });
    },
    [entities, onUpdateEntity]
  );

  if (entities.length === 0) {
    return (
      <Typography color="text.secondary">
        No entities detected. Please go back and upload files.
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body1">
        Review the detected entities. Each uploaded file maps to one entity.
      </Typography>

      {entities.map((entity, index) => (
        <Box
          key={index}
          sx={{
            p: 2,
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          <Stack spacing={2}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="subtitle2" color="text.secondary">
                Source: {files[index]?.name ?? `File ${index + 1}`}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {entity.columns.length} columns detected
              </Typography>
            </Stack>

            <Divider />

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
            >
              <TextInput
                label="Entity Key"
                value={entity.connectorEntity.key}
                onChange={(e) => handleKeyChange(index, e.target.value)}
                size="small"
                fullWidth
              />
              <TextInput
                label="Entity Label"
                value={entity.connectorEntity.label}
                onChange={(e) => handleLabelChange(index, e.target.value)}
                size="small"
                fullWidth
              />
            </Stack>
          </Stack>
        </Box>
      ))}
    </Stack>
  );
};
