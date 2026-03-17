import React, { useCallback } from "react";

import {
  Box,
  Stack,
  Typography,
  TextInput,
  Tabs,
  Tab,
  TabPanel,
  useTabs,
  Divider,
  Checkbox,
} from "@portalai/core/ui";

import type {
  RecommendedColumn,
  RecommendedEntity,
} from "./utils/upload-workflow.util";

// --- Types ---

interface ColumnMappingStepProps {
  entities: RecommendedEntity[];
  onUpdateColumn: (
    entityIndex: number,
    columnIndex: number,
    updates: Partial<RecommendedColumn>
  ) => void;
}

// --- Confidence Chip ---

const ConfidenceChip: React.FC<{ confidence: number }> = ({ confidence }) => {
  const percent = Math.round(confidence * 100);
  const color =
    confidence >= 0.8
      ? "success.main"
      : confidence >= 0.5
        ? "warning.main"
        : "error.main";

  return (
    <Typography
      variant="caption"
      sx={{
        px: 1,
        py: 0.25,
        borderRadius: 1,
        bgcolor: color,
        color: "white",
        fontWeight: "bold",
      }}
    >
      {percent}%
    </Typography>
  );
};

// --- Column Row ---

interface ColumnRowProps {
  column: RecommendedColumn;
  entityIndex: number;
  columnIndex: number;
  onUpdate: (
    entityIndex: number,
    columnIndex: number,
    updates: Partial<RecommendedColumn>
  ) => void;
}

const ColumnRow: React.FC<ColumnRowProps> = ({
  column,
  entityIndex,
  columnIndex,
  onUpdate,
}) => {
  const handleKeyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(entityIndex, columnIndex, {
        recommended: { ...column.recommended, key: e.target.value },
      });
    },
    [entityIndex, columnIndex, column.recommended, onUpdate]
  );

  const handleLabelChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(entityIndex, columnIndex, {
        recommended: { ...column.recommended, label: e.target.value },
      });
    },
    [entityIndex, columnIndex, column.recommended, onUpdate]
  );

  const handlePrimaryKeyToggle = useCallback(
    (checked: boolean) => {
      onUpdate(entityIndex, columnIndex, {
        isPrimaryKeyCandidate: checked,
      });
    },
    [entityIndex, columnIndex, onUpdate]
  );

  return (
    <Box
      sx={{
        p: 1.5,
        border: 1,
        borderColor: column.confidence < 0.8 ? "warning.light" : "divider",
        borderRadius: 1,
      }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Typography variant="body2" fontWeight="medium">
            {column.sourceField}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="caption" color="text.secondary">
              {column.action === "match_existing" ? "Match" : "New"}
            </Typography>
            <ConfidenceChip confidence={column.confidence} />
          </Stack>
        </Stack>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
        >
          <TextInput
            label="Key"
            value={column.recommended.key}
            onChange={handleKeyChange}
            size="small"
            fullWidth
          />
          <TextInput
            label="Label"
            value={column.recommended.label}
            onChange={handleLabelChange}
            size="small"
            fullWidth
          />
          <TextInput
            label="Type"
            value={column.recommended.type}
            size="small"
            fullWidth
            disabled
          />
        </Stack>

        <Checkbox
          label="Primary Key"
          checked={column.isPrimaryKeyCandidate}
          onChange={handlePrimaryKeyToggle}
        />
      </Stack>
    </Box>
  );
};

// --- Component ---

export const ColumnMappingStep: React.FC<ColumnMappingStepProps> = ({
  entities,
  onUpdateColumn,
}) => {
  const { tabsProps, getTabProps, getTabPanelProps } = useTabs();

  if (entities.length === 0) {
    return (
      <Typography color="text.secondary">
        No entities available. Please go back and review entities.
      </Typography>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="body1">
        Review and edit column mappings for each entity.
      </Typography>

      <Tabs {...tabsProps}>
        {entities.map((entity, index) => (
          <Tab
            key={index}
            label={entity.connectorEntity.label}
            {...getTabProps(index)}
          />
        ))}
      </Tabs>

      {entities.map((entity, entityIndex) => (
        <TabPanel key={entityIndex} {...getTabPanelProps(entityIndex)}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" color="text.secondary">
              {entity.columns.length} columns
            </Typography>
            <Divider />
            {entity.columns.map((column, columnIndex) => (
              <ColumnRow
                key={columnIndex}
                column={column}
                entityIndex={entityIndex}
                columnIndex={columnIndex}
                onUpdate={onUpdateColumn}
              />
            ))}
          </Stack>
        </TabPanel>
      ))}
    </Stack>
  );
};
