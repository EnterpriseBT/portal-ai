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
  Select,
} from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import type { ConnectorEntityWithMappings } from "@portalai/core/contracts";

import type {
  RecommendedColumn,
  RecommendedEntity,
} from "./utils/upload-workflow.util";

// --- Constants ---

const TYPES_WITH_FORMAT = ["string", "date", "datetime"] as const;

const COLUMN_TYPE_OPTIONS: SelectOption[] = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & Time" },
  { value: "enum", label: "Enum" },
  { value: "json", label: "JSON" },
  { value: "array", label: "Array" },
  { value: "reference", label: "Reference" },
  { value: "currency", label: "Currency" },
];

// --- Types ---

interface ColumnMappingStepProps {
  entities: RecommendedEntity[];
  dbEntities: ConnectorEntityWithMappings[];
  isLoadingDbEntities: boolean;
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

// --- Reference Editor ---

interface ReferenceEditorProps {
  column: RecommendedColumn;
  entityIndex: number;
  columnIndex: number;
  allEntities: RecommendedEntity[];
  dbEntities: ConnectorEntityWithMappings[];
  isLoadingDbEntities: boolean;
  onUpdate: (
    entityIndex: number,
    columnIndex: number,
    updates: Partial<RecommendedColumn>
  ) => void;
}

/** Derive which entity select value is active given current column state. */
function deriveEntitySelectValue(
  recommended: RecommendedColumn["recommended"],
  allEntities: RecommendedEntity[],
  dbEntities: ConnectorEntityWithMappings[]
): string {
  const { refEntityKey, refColumnKey, refColumnDefinitionId } = recommended;
  if (!refEntityKey) return "";
  // refColumnDefinitionId means user chose from existing DB entities
  if (refColumnDefinitionId) return `db:${refEntityKey}`;
  // refColumnKey means user chose from batch entities
  if (refColumnKey) return `batch:${refEntityKey}`;
  // Only refEntityKey set — heuristic: prefer batch, fall back to db
  const inBatch = allEntities.some(
    (e) => e.connectorEntity.key === refEntityKey
  );
  if (inBatch) return `batch:${refEntityKey}`;
  const inDb = dbEntities.some((e) => e.key === refEntityKey);
  if (inDb) return `db:${refEntityKey}`;
  return `batch:${refEntityKey}`;
}

const ReferenceEditor: React.FC<ReferenceEditorProps> = ({
  column,
  entityIndex,
  columnIndex,
  allEntities,
  dbEntities,
  isLoadingDbEntities,
  onUpdate,
}) => {
  const batchOptions: SelectOption[] = allEntities.map((e) => ({
    value: `batch:${e.connectorEntity.key}`,
    label: `${e.connectorEntity.label} (${e.connectorEntity.key}) — this import`,
  }));

  const dbOptions: SelectOption[] = dbEntities.map((e) => ({
    value: `db:${e.key}`,
    label: `${e.label} (${e.key}) — existing`,
  }));

  const entityOptions: SelectOption[] = [...batchOptions, ...dbOptions];

  const currentEntityValue = deriveEntitySelectValue(
    column.recommended,
    allEntities,
    dbEntities
  );

  const isDbMode = currentEntityValue.startsWith("db:");

  // Build column options based on whether selected entity is batch or DB
  let columnOptions: SelectOption[] = [];
  if (currentEntityValue.startsWith("batch:")) {
    const entityKey = currentEntityValue.slice("batch:".length);
    const selectedEntity = allEntities.find(
      (e) => e.connectorEntity.key === entityKey
    );
    columnOptions = selectedEntity
      ? selectedEntity.columns.map((c) => ({
          value: c.recommended.key,
          label: `${c.recommended.label} (${c.recommended.key})`,
        }))
      : [];
  } else if (currentEntityValue.startsWith("db:")) {
    const entityKey = currentEntityValue.slice("db:".length);
    const selectedDbEntity = dbEntities.find((e) => e.key === entityKey);
    columnOptions = selectedDbEntity
      ? selectedDbEntity.fieldMappings
          .filter((fm) => fm.columnDefinition !== null)
          .map((fm) => ({
            value: fm.columnDefinition!.id,
            label: `${fm.columnDefinition!.label} (${fm.columnDefinition!.key})`,
          }))
      : [];
  }

  // Column select value: DB mode uses refColumnDefinitionId, batch uses refColumnKey
  const currentColumnValue = isDbMode
    ? (column.recommended.refColumnDefinitionId ?? "")
    : (column.recommended.refColumnKey ?? "");

  const handleEntityChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      if (!val) {
        onUpdate(entityIndex, columnIndex, {
          recommended: {
            ...column.recommended,
            refEntityKey: null,
            refColumnKey: null,
            refColumnDefinitionId: null,
          },
        });
        return;
      }
      const colonIdx = val.indexOf(":");
      const entityKey = val.slice(colonIdx + 1);
      onUpdate(entityIndex, columnIndex, {
        recommended: {
          ...column.recommended,
          refEntityKey: entityKey,
          refColumnKey: null,
          refColumnDefinitionId: null,
        },
      });
    },
    [entityIndex, columnIndex, column.recommended, onUpdate]
  );

  const handleColumnChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value || null;
      if (isDbMode) {
        onUpdate(entityIndex, columnIndex, {
          recommended: {
            ...column.recommended,
            refColumnKey: null,
            refColumnDefinitionId: val,
          },
        });
      } else {
        onUpdate(entityIndex, columnIndex, {
          recommended: {
            ...column.recommended,
            refColumnKey: val,
            refColumnDefinitionId: null,
          },
        });
      }
    },
    [entityIndex, columnIndex, column.recommended, onUpdate, isDbMode]
  );

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
      <Select
        label="Reference Entity"
        value={currentEntityValue}
        onChange={handleEntityChange}
        options={entityOptions}
        size="small"
        fullWidth
        placeholder={isLoadingDbEntities ? "Loading..." : "Select entity..."}
        disabled={isLoadingDbEntities}
      />
      <Select
        label="Reference Column"
        value={currentColumnValue}
        onChange={handleColumnChange}
        options={columnOptions}
        size="small"
        fullWidth
        disabled={!currentEntityValue || isLoadingDbEntities}
        placeholder="Select column..."
      />
    </Stack>
  );
};

// --- Column Row ---

interface ColumnRowProps {
  column: RecommendedColumn;
  entityIndex: number;
  columnIndex: number;
  allEntities: RecommendedEntity[];
  dbEntities: ConnectorEntityWithMappings[];
  isLoadingDbEntities: boolean;
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
  allEntities,
  dbEntities,
  isLoadingDbEntities,
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

  const handleTypeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newType = e.target.value;
      const isReference = newType === "reference";
      const supportsFormat = (TYPES_WITH_FORMAT as readonly string[]).includes(newType);
      onUpdate(entityIndex, columnIndex, {
        recommended: {
          ...column.recommended,
          type: newType,
          ...(!isReference && {
            refEntityKey: null,
            refColumnKey: null,
            refColumnDefinitionId: null,
          }),
          ...(!supportsFormat && { format: null }),
        },
      });
    },
    [entityIndex, columnIndex, column.recommended, onUpdate]
  );

  const handleFormatChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(entityIndex, columnIndex, {
        recommended: {
          ...column.recommended,
          format: e.target.value || null,
        },
      });
    },
    [entityIndex, columnIndex, column.recommended, onUpdate]
  );

  const handleEnumValuesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const values = e.target.value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      onUpdate(entityIndex, columnIndex, {
        recommended: {
          ...column.recommended,
          enumValues: values.length > 0 ? values : null,
        },
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

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
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
          <Select
            label="Type"
            value={column.recommended.type}
            onChange={handleTypeChange}
            options={COLUMN_TYPE_OPTIONS}
            size="small"
            fullWidth
          />
        </Stack>

        {column.recommended.type === "reference" && (
          <ReferenceEditor
            column={column}
            entityIndex={entityIndex}
            columnIndex={columnIndex}
            allEntities={allEntities}
            dbEntities={dbEntities}
            isLoadingDbEntities={isLoadingDbEntities}
            onUpdate={onUpdate}
          />
        )}

        {(TYPES_WITH_FORMAT as readonly string[]).includes(column.recommended.type) && (
          <TextInput
            label="Format"
            value={column.recommended.format ?? ""}
            onChange={handleFormatChange}
            size="small"
            fullWidth
            placeholder="e.g. YYYY-MM-DD, email, ISO8601"
          />
        )}

        {column.recommended.type === "enum" && (
          <TextInput
            label="Enum Values (comma-separated)"
            value={column.recommended.enumValues?.join(", ") ?? ""}
            onChange={handleEnumValuesChange}
            size="small"
            fullWidth
          />
        )}

        <Checkbox
          label="Primary Key"
          checked={column.isPrimaryKeyCandidate}
          onChange={handlePrimaryKeyToggle}
        />

        {column.sampleValues && column.sampleValues.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            Sample: {column.sampleValues.slice(0, 3).join(", ")}
            {column.sampleValues.length > 3 && "…"}
          </Typography>
        )}
      </Stack>
    </Box>
  );
};

// --- Component ---

export const ColumnMappingStep: React.FC<ColumnMappingStepProps> = ({
  entities,
  dbEntities,
  isLoadingDbEntities,
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
                allEntities={entities}
                dbEntities={dbEntities}
                isLoadingDbEntities={isLoadingDbEntities}
                onUpdate={onUpdateColumn}
              />
            ))}
          </Stack>
        </TabPanel>
      ))}
    </Stack>
  );
};
