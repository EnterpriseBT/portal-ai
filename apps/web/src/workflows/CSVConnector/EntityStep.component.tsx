import React, { useCallback, useMemo } from "react";

import { Box, Stack, Typography, TextInput, Divider } from "@portalai/core/ui";

import type { RecommendedEntity, ParseSummary } from "./utils/upload-workflow.util";

// --- Types ---

interface EntityStepProps {
  entities: RecommendedEntity[];
  files: File[];
  parseResults: ParseSummary[] | null;
  onUpdateEntity: (index: number, updates: Partial<RecommendedEntity>) => void;
}

// --- Component ---

export const EntityStep: React.FC<EntityStepProps> = ({
  entities,
  files,
  parseResults,
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

  // Build a lookup for parse results by file name
  const parseResultsByFile = useMemo(() => {
    if (!parseResults) return new Map<string, ParseSummary>();
    return new Map(parseResults.map((pr) => [pr.fileName, pr]));
  }, [parseResults]);

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

      {/* Parse summary */}
      {parseResults && parseResults.length > 0 && (
        <Box
          sx={{
            p: 2,
            bgcolor: "action.hover",
            borderRadius: 1,
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            Parse Summary
          </Typography>
          <Stack spacing={0.5}>
            {parseResults.map((pr) => (
              <Typography key={pr.fileName} variant="body2" color="text.secondary">
                {pr.fileName}: {pr.rowCount.toLocaleString()} rows, delimiter: &quot;{pr.delimiter}&quot;, {pr.columnCount} columns, {pr.encoding}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}

      {entities.map((entity, index) => {
        const sourceFile = entity.sourceFileName || files[index]?.name || `File ${index + 1}`;
        const parseSummary = parseResultsByFile.get(sourceFile);

        return (
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
                Source: {sourceFile}
                {parseSummary && (
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    ({parseSummary.rowCount.toLocaleString()} rows)
                  </Typography>
                )}
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
        );
      })}
    </Stack>
  );
};
