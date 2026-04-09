import React, { useCallback, useMemo, useState } from "react";

import {
  Box,
  Stack,
  Typography,
  DeferredTextInput,
  Tabs,
  Tab,
  TabPanel,
  useTabs,
  Divider,
  Checkbox,
  Select,
  AsyncSearchableSelect,
} from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import type { SelectOption } from "@portalai/core/ui";
import type { ColumnDefinition } from "@portalai/core/models";

import type { ConnectorEntityWithMappings } from "@portalai/core/contracts";

import type {
  RecommendedColumn,
  RecommendedColumnUpdate,
  RecommendedEntity,
} from "./utils/upload-workflow.util";
import type { ColumnStepErrors } from "./utils/csv-validation.util";
import type { FormErrors } from "../../utils/form-validation.util";

// --- Types ---

interface ColumnMappingStepProps {
  entities: RecommendedEntity[];
  dbEntities: ConnectorEntityWithMappings[];
  isLoadingDbEntities: boolean;
  onUpdateColumn: (
    entityIndex: number,
    columnIndex: number,
    updates: RecommendedColumnUpdate
  ) => void;
  errors?: ColumnStepErrors;
  onColumnKeySearch: (query: string) => Promise<SelectOption[]>;
  onColumnKeyGetById: ((id: string) => Promise<SelectOption | null>) | undefined;
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
    updates: RecommendedColumnUpdate
  ) => void;
  fieldErrors: FormErrors;
}

/** Derive which entity select value is active given current column state. */
function deriveEntitySelectValue(
  column: RecommendedColumn,
  allEntities: RecommendedEntity[],
  dbEntities: ConnectorEntityWithMappings[]
): string {
  const { refEntityKey } = column;
  if (!refEntityKey) return "";
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
  fieldErrors,
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
    column,
    allEntities,
    dbEntities
  );

  let columnOptions: SelectOption[] = [];
  if (currentEntityValue.startsWith("batch:")) {
    const entityKey = currentEntityValue.slice("batch:".length);
    const selectedEntity = allEntities.find(
      (e) => e.connectorEntity.key === entityKey
    );
    columnOptions = selectedEntity
      ? selectedEntity.columns.map((c) => ({
        value: c.normalizedKey ?? c.sourceField,
        label: `${c.normalizedKey ?? c.sourceField} (${c.sourceField})`,
      }))
      : [];
  } else if (currentEntityValue.startsWith("db:")) {
    const entityKey = currentEntityValue.slice("db:".length);
    const selectedDbEntity = dbEntities.find((e) => e.key === entityKey);
    columnOptions = selectedDbEntity
      ? selectedDbEntity.fieldMappings
        .map((fm) => ({
          value: fm.normalizedKey,
          label: `${fm.normalizedKey} (${fm.sourceField})`,
        }))
      : [];
  }

  const currentColumnValue = column.refNormalizedKey ?? "";

  const handleEntityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) {
      onUpdate(entityIndex, columnIndex, {
        refEntityKey: null,
        refNormalizedKey: null,
      });
      return;
    }
    const colonIdx = val.indexOf(":");
    const entityKey = val.slice(colonIdx + 1);
    onUpdate(entityIndex, columnIndex, {
      refEntityKey: entityKey,
      refNormalizedKey: null,
    });
  };

  const handleColumnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value || null;
    onUpdate(entityIndex, columnIndex, { refNormalizedKey: val });
  };

  return (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
      <Select
        label="Reference Entity"
        value={currentEntityValue}
        onChange={handleEntityChange}
        options={entityOptions}
        size="small"
        fullWidth
        required
        error={!!fieldErrors.refEntityKey}
        helperText={fieldErrors.refEntityKey}
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
        required
        error={!!fieldErrors.refColumnKey}
        helperText={fieldErrors.refColumnKey}
        disabled={!currentEntityValue || isLoadingDbEntities}
        placeholder="Select column..."
      />
    </Stack>
  );
};

// --- Column Row ---

interface ColumnRowProps {
  column: RecommendedColumn;
  columnDef: ColumnDefinition | null;
  entityIndex: number;
  columnIndex: number;
  allEntities: RecommendedEntity[];
  dbEntities: ConnectorEntityWithMappings[];
  isLoadingDbEntities: boolean;
  onUpdate: (
    entityIndex: number,
    columnIndex: number,
    updates: RecommendedColumnUpdate
  ) => void;
  fieldErrors: FormErrors;
  onColumnKeySearch: (query: string) => Promise<SelectOption[]>;
  loadSelectedOption?: (value: string) => Promise<SelectOption | null>;
}

const ColumnRow: React.FC<ColumnRowProps> = ({
  column,
  columnDef,
  entityIndex,
  columnIndex,
  allEntities,
  dbEntities,
  isLoadingDbEntities,
  onUpdate,
  fieldErrors,
  onColumnKeySearch,
  loadSelectedOption,
}) => {
  const handleDefinitionSelect = (value: string | null) => {
    if (!value) {
      onUpdate(entityIndex, columnIndex, { existingColumnDefinitionId: "" });
      return;
    }
    // value is the column definition key from search results — but we need
    // to handle both key-based and id-based lookups. The AsyncSearchableSelect
    // returns the option value which is the column def key.
    onUpdate(entityIndex, columnIndex, { existingColumnDefinitionId: value });
  };

  const handleNormalizedKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate(entityIndex, columnIndex, { normalizedKey: e.target.value });
  };

  const handleRequiredToggle = (checked: boolean) => {
    onUpdate(entityIndex, columnIndex, { required: checked });
  };

  const handleDefaultValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate(entityIndex, columnIndex, { defaultValue: e.target.value || null });
  };

  const handleFormatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onUpdate(entityIndex, columnIndex, { format: e.target.value || null });
  };

  const handleEnumValuesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const values = e.target.value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    onUpdate(entityIndex, columnIndex, {
      enumValues: values.length > 0 ? values : null,
    });
  };

  const handlePrimaryKeyToggle = (checked: boolean) => {
    onUpdate(entityIndex, columnIndex, {
      isPrimaryKeyCandidate: checked,
    });
  };

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
          <ConfidenceChip confidence={column.confidence} />
        </Stack>

        {/* Column Definition Selection */}
        <AsyncSearchableSelect
          label="Column Definition"
          value={column.existingColumnDefinitionId || null}
          onChange={handleDefinitionSelect}
          onSearch={onColumnKeySearch}
          loadSelectedOption={loadSelectedOption}
          required
          fullWidth
          error={!!fieldErrors.existingColumnDefinitionId}
          helperText={fieldErrors.existingColumnDefinitionId}
          size="small"
        />

        {/* Column Definition Read-Only Metadata */}
        {columnDef ? (
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              Column Definition (read-only)
            </Typography>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
              <Chip label={columnDef.type} size="small" variant="outlined" />
              {columnDef.description && (
                <Typography variant="caption" color="text.secondary">
                  {columnDef.description}
                </Typography>
              )}
              {columnDef.validationPattern && (
                <Typography variant="caption" color="text.secondary">
                  Validation: {columnDef.validationPattern}
                </Typography>
              )}
              {columnDef.canonicalFormat && (
                <Typography variant="caption" color="text.secondary">
                  Format: {columnDef.canonicalFormat}
                </Typography>
              )}
            </Stack>
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            Select a column definition
          </Typography>
        )}

        {/* Reference Editor */}
        {columnDef && (columnDef.type === "reference" || columnDef.type === "reference-array") && (
          <ReferenceEditor
            column={column}
            entityIndex={entityIndex}
            columnIndex={columnIndex}
            allEntities={allEntities}
            dbEntities={dbEntities}
            isLoadingDbEntities={isLoadingDbEntities}
            onUpdate={onUpdate}
            fieldErrors={fieldErrors}
          />
        )}

        {/* Field-mapping-level fields */}
        <Divider />
        <Typography variant="caption" color="text.secondary">Field Mapping</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <DeferredTextInput
            label="Normalized Key"
            value={column.normalizedKey ?? ""}
            onChange={handleNormalizedKeyChange}
            required
            error={!!fieldErrors.normalizedKey}
            helperText={fieldErrors.normalizedKey ?? "Key used in normalized data"}
            size="small"
            fullWidth
          />
          <DeferredTextInput
            label="Default Value"
            value={column.defaultValue ?? ""}
            onChange={handleDefaultValueChange}
            size="small"
            fullWidth
          />
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <DeferredTextInput
            label="Format"
            value={column.format ?? ""}
            onChange={handleFormatChange}
            size="small"
            fullWidth
            helperText="How to parse raw source values"
          />
          {columnDef?.type === "enum" && (
            <DeferredTextInput
              label="Enum Values (comma-separated)"
              value={column.enumValues?.join(", ") ?? ""}
              onChange={handleEnumValuesChange}
              size="small"
              fullWidth
            />
          )}
        </Stack>

        <Stack direction="row" spacing={2}>
          <Checkbox
            label="Primary Key"
            checked={column.isPrimaryKeyCandidate}
            onChange={handlePrimaryKeyToggle}
          />
          <Checkbox
            label="Required"
            checked={column.required ?? false}
            onChange={handleRequiredToggle}
          />
        </Stack>

        {column.sampleValues && column.sampleValues.length > 0 && (
          <Typography variant="caption" color="text.secondary">
            Sample: {column.sampleValues.slice(0, 3).join(", ")}
            {column.sampleValues.length > 3 && "..."}
          </Typography>
        )}
      </Stack>
    </Box>
  );
};

// --- Component ---

const EMPTY_ERRORS: ColumnStepErrors = {};

export const ColumnMappingStep: React.FC<ColumnMappingStepProps> = ({
  entities,
  dbEntities,
  isLoadingDbEntities,
  onUpdateColumn,
  errors = EMPTY_ERRORS,
  onColumnKeySearch,
  onColumnKeyGetById,
}) => {
  const { value: activeTab, tabsProps, getTabProps, getTabPanelProps } = useTabs();
  const activeEntity = entities[activeTab];

  // Accumulate column definitions from search results by ID
  const [columnDefsById, setColumnDefsById] = useState<Record<string, ColumnDefinition>>({});

  const handleColumnKeySearch = useCallback(
    async (query: string) => {
      const results = await onColumnKeySearch(query);
      setColumnDefsById((prev) => {
        const next = { ...prev };
        for (const opt of results) {
          const cd = (opt as { columnDefinition?: ColumnDefinition }).columnDefinition;
          if (cd) next[cd.id] = cd;
        }
        return next;
      });
      return results;
    },
    [onColumnKeySearch],
  );

  // Load the selected option by ID — used when the initial generic search
  // may not include the pre-selected column definition.
  const loadSelectedOption = useMemo(() => {
    if (!onColumnKeyGetById) return undefined;
    const getById = onColumnKeyGetById;
    return async (id: string): Promise<{ value: string | number; label: string } | null> => {
      const result = await getById(id);
      if (!result) return null;
      // Cache the column definition for metadata display
      const cd = (result as { columnDefinition?: ColumnDefinition }).columnDefinition;
      if (cd) {
        setColumnDefsById((prev) => ({ ...prev, [cd.id]: cd }));
      }
      return result;
    };
  }, [onColumnKeyGetById]);

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

      {activeEntity && (
        <TabPanel {...getTabPanelProps(activeTab)}>
          <Stack spacing={1}>
            <Typography variant="subtitle2" color="text.secondary">
              {activeEntity.columns.length} columns
            </Typography>
            <Divider />
            {activeEntity.columns.map((column, columnIndex) => (
              <ColumnRow
                key={`${activeTab}-${columnIndex}`}
                column={column}
                columnDef={columnDefsById[column.existingColumnDefinitionId] ?? null}
                entityIndex={activeTab}
                columnIndex={columnIndex}
                allEntities={entities}
                dbEntities={dbEntities}
                isLoadingDbEntities={isLoadingDbEntities}
                onUpdate={onUpdateColumn}
                fieldErrors={errors[activeTab]?.[columnIndex] ?? {}}
                onColumnKeySearch={handleColumnKeySearch}
                loadSelectedOption={loadSelectedOption}
              />
            ))}
          </Stack>
        </TabPanel>
      )}
    </Stack>
  );
};
