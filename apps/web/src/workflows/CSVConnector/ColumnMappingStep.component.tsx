import React, { useCallback } from "react";

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
} from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import type { ConnectorEntityWithMappings } from "@portalai/core/contracts";

import type {
  RecommendedColumn,
  RecommendedEntity,
} from "./utils/upload-workflow.util";
import type { ColumnStepErrors } from "./utils/csv-validation.util";
import type { FormErrors } from "../../utils/form-validation.util";

// --- Constants ---

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
  { value: "reference-array", label: "Reference Array (M:M)" },
];

const STRING_CANONICAL_FORMAT_OPTIONS: SelectOption[] = [
  { value: "", label: "None" },
  { value: "lowercase", label: "Lowercase — e.g. jane@example.com" },
  { value: "uppercase", label: "Uppercase — e.g. US" },
  { value: "trim", label: "Trim — removes leading/trailing whitespace" },
  { value: "phone", label: "Phone — normalizes to +1XXXXXXXXXX" },
];

const NUMBER_CANONICAL_FORMAT_OPTIONS: SelectOption[] = [
  { value: "", label: "None" },
  { value: "$#,##0.00", label: "USD — $1,234.56" },
  { value: "€#,##0.00", label: "EUR — €1,234.56" },
  { value: "£#,##0.00", label: "GBP — £1,234.56" },
  { value: "¥#,##0", label: "JPY — ¥1,234" },
  { value: "#,##0.00", label: "2 decimals — 1,234.56" },
  { value: "#,##0.000", label: "3 decimals — 1,234.567" },
  { value: "#,##0", label: "Integer — 1,234" },
];

const VALIDATION_PRESETS = [
  { label: "Custom", value: "Custom", pattern: "", message: "" },
  { label: "Email", value: "email", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", message: "Must be a valid email address" },
  { label: "URL", value: "url", pattern: "^https?://.*", message: "Must be a valid URL" },
  { label: "Phone", value: "phone", pattern: "^\\+?[\\d\\s\\-().]+$", message: "Must be a valid phone number" },
  { label: "UUID", value: "uuid", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", message: "Must be a valid UUID" },
];

interface TypeFieldConfig {
  format: { enabled: boolean; helperText: string };
  validation: { enabled: boolean };
  canonicalFormat: { enabled: boolean; options: SelectOption[] };
}

const TYPE_FIELD_CONFIG: Record<string, TypeFieldConfig> = {
  string: {
    format: { enabled: false, helperText: "Not used for string columns" },
    validation: { enabled: true },
    canonicalFormat: { enabled: true, options: STRING_CANONICAL_FORMAT_OPTIONS },
  },
  number: {
    format: { enabled: true, helperText: "e.g. currency for 2 decimals, precision:N for N decimals, eu for European format (1.234,56)" },
    validation: { enabled: true },
    canonicalFormat: { enabled: true, options: NUMBER_CANONICAL_FORMAT_OPTIONS },
  },
  boolean: {
    format: { enabled: true, helperText: "Custom true:false labels. e.g. active:inactive, yes:no, 1:0" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  date: {
    format: { enabled: true, helperText: "Date format for parsing. e.g. yyyy-MM-dd, MM/dd/yyyy, dd.MM.yyyy" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  datetime: {
    format: { enabled: true, helperText: "Datetime format for parsing. e.g. yyyy-MM-dd HH:mm:ss, MM/dd/yyyy hh:mm a" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  enum: {
    format: { enabled: false, helperText: "Not used for enum columns" },
    validation: { enabled: true },
    canonicalFormat: { enabled: false, options: [] },
  },
  json: {
    format: { enabled: false, helperText: "Not used for JSON columns" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  array: {
    format: { enabled: true, helperText: "Delimiter character for splitting values. Default is comma (,). e.g. | for pipe-delimited" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  reference: {
    format: { enabled: false, helperText: "Not used for reference columns" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
  "reference-array": {
    format: { enabled: true, helperText: "Delimiter character for splitting values. Default is comma (,). e.g. | for pipe-delimited" },
    validation: { enabled: false },
    canonicalFormat: { enabled: false, options: [] },
  },
};

const DEFAULT_TYPE_CONFIG: TypeFieldConfig = {
  format: { enabled: true, helperText: "How to parse raw source values" },
  validation: { enabled: true },
  canonicalFormat: { enabled: true, options: STRING_CANONICAL_FORMAT_OPTIONS },
};

const EMPTY_ERRORS: FormErrors = {};

function toSnakeCase(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

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
  errors?: ColumnStepErrors;
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
  fieldErrors?: FormErrors;
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

const ReferenceEditor: React.FC<ReferenceEditorProps> = React.memo(({
  column,
  entityIndex,
  columnIndex,
  allEntities,
  dbEntities,
  isLoadingDbEntities,
  onUpdate,
  fieldErrors = EMPTY_ERRORS,
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
});

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
  fieldErrors?: FormErrors;
}

const ColumnRow: React.FC<ColumnRowProps> = React.memo(({
  column,
  entityIndex,
  columnIndex,
  allEntities,
  dbEntities,
  isLoadingDbEntities,
  onUpdate,
  fieldErrors = EMPTY_ERRORS,
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
      const isReference = newType === "reference" || newType === "reference-array";
      const newConfig = TYPE_FIELD_CONFIG[newType] ?? DEFAULT_TYPE_CONFIG;
      const prevConfig = TYPE_FIELD_CONFIG[column.recommended.type] ?? DEFAULT_TYPE_CONFIG;
      const canonicalChanged = prevConfig.canonicalFormat.enabled !== newConfig.canonicalFormat.enabled
        || prevConfig.canonicalFormat.options !== newConfig.canonicalFormat.options;
      const validationLost = prevConfig.validation.enabled && !newConfig.validation.enabled;
      onUpdate(entityIndex, columnIndex, {
        recommended: {
          ...column.recommended,
          type: newType,
          ...(!isReference && {
            refEntityKey: null,
            refColumnKey: null,
            refColumnDefinitionId: null,
          }),
          ...(canonicalChanged && { canonicalFormat: null }),
          ...(validationLost && { validationPattern: null, validationMessage: null }),
        },
        ...(newType !== "enum" && { enumValues: null }),
        ...(!newConfig.format.enabled && { format: null }),
      });
    },
    [entityIndex, columnIndex, column.recommended, onUpdate]
  );

  // Mapping-level handlers
  const handleNormalizedKeyChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(entityIndex, columnIndex, { normalizedKey: e.target.value });
    },
    [entityIndex, columnIndex, onUpdate]
  );

  const handleRequiredToggle = useCallback(
    (checked: boolean) => {
      onUpdate(entityIndex, columnIndex, { required: checked });
    },
    [entityIndex, columnIndex, onUpdate]
  );

  const handleDefaultValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(entityIndex, columnIndex, { defaultValue: e.target.value || null });
    },
    [entityIndex, columnIndex, onUpdate]
  );

  const handleFormatChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(entityIndex, columnIndex, { format: e.target.value || null });
    },
    [entityIndex, columnIndex, onUpdate]
  );

  const handleEnumValuesChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const values = e.target.value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      onUpdate(entityIndex, columnIndex, {
        enumValues: values.length > 0 ? values : null,
      });
    },
    [entityIndex, columnIndex, onUpdate]
  );

  // Column-definition-level handlers
  const handleValidationPresetChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const preset = VALIDATION_PRESETS.find((p) => p.value === e.target.value);
      if (preset) {
        onUpdate(entityIndex, columnIndex, {
          recommended: {
            ...column.recommended,
            validationPattern: preset.pattern || null,
            validationMessage: preset.message || null,
          },
        });
      }
    },
    [entityIndex, columnIndex, column.recommended, onUpdate]
  );

  const handleValidationPatternChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(entityIndex, columnIndex, {
        recommended: { ...column.recommended, validationPattern: e.target.value || null },
      });
    },
    [entityIndex, columnIndex, column.recommended, onUpdate]
  );

  const handleValidationMessageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(entityIndex, columnIndex, {
        recommended: { ...column.recommended, validationMessage: e.target.value || null },
      });
    },
    [entityIndex, columnIndex, column.recommended, onUpdate]
  );

  const handleCanonicalFormatChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(entityIndex, columnIndex, {
        recommended: { ...column.recommended, canonicalFormat: e.target.value || null },
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

  const typeConfig = TYPE_FIELD_CONFIG[column.recommended.type] ?? DEFAULT_TYPE_CONFIG;

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
          <DeferredTextInput
            label="Key"
            value={column.recommended.key}
            onChange={handleKeyChange}
            required
            error={!!fieldErrors.key}
            helperText={fieldErrors.key}
            size="small"
            fullWidth
          />
          <DeferredTextInput
            label="Label"
            value={column.recommended.label}
            onChange={handleLabelChange}
            required
            error={!!fieldErrors.label}
            helperText={fieldErrors.label}
            size="small"
            fullWidth
          />
          <Select
            label="Type"
            value={column.recommended.type}
            onChange={handleTypeChange}
            options={COLUMN_TYPE_OPTIONS}
            required
            error={!!fieldErrors.type}
            helperText={fieldErrors.type}
            size="small"
            fullWidth
          />
        </Stack>

        {(column.recommended.type === "reference" || column.recommended.type === "reference-array") && (
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

        {/* Column-definition-level fields */}
        <Divider />
        <Typography variant="caption" color="text.secondary">Column Definition</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Select
            label="Validation Preset"
            value={VALIDATION_PRESETS.find((p) => p.pattern === (column.recommended.validationPattern ?? ""))?.value ?? ""}
            onChange={handleValidationPresetChange}
            options={VALIDATION_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
            size="small"
            fullWidth
            disabled={!typeConfig.validation.enabled}
            helperText={!typeConfig.validation.enabled ? "Not applicable for this column type" : undefined}
          />
          <DeferredTextInput
            label="Validation Pattern"
            value={column.recommended.validationPattern ?? ""}
            onChange={handleValidationPatternChange}
            size="small"
            fullWidth
            disabled={!typeConfig.validation.enabled}
            error={!!fieldErrors.validationPattern}
            helperText={
              !typeConfig.validation.enabled
                ? "Not applicable for this column type"
                : fieldErrors.validationPattern ?? "Regex that values must match after coercion"
            }
            slotProps={{ htmlInput: { "aria-invalid": !!fieldErrors.validationPattern } }}
          />
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <DeferredTextInput
            label="Validation Message"
            value={column.recommended.validationMessage ?? ""}
            onChange={handleValidationMessageChange}
            size="small"
            fullWidth
            disabled={!typeConfig.validation.enabled}
            helperText={
              !typeConfig.validation.enabled
                ? "Not applicable for this column type"
                : "Shown when the pattern doesn't match"
            }
          />
          <Select
            label="Canonical Format"
            value={column.recommended.canonicalFormat ?? ""}
            onChange={handleCanonicalFormatChange}
            options={typeConfig.canonicalFormat.options}
            size="small"
            fullWidth
            disabled={!typeConfig.canonicalFormat.enabled}
            helperText={
              !typeConfig.canonicalFormat.enabled
                ? "Not applicable for this column type"
                : "Normalizes the stored value before saving"
            }
          />
        </Stack>

        {/* Field-mapping-level fields */}
        <Divider />
        <Typography variant="caption" color="text.secondary">Field Mapping</Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <DeferredTextInput
            label="Normalized Key"
            value={column.normalizedKey ?? toSnakeCase(column.recommended.key)}
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
            disabled={!typeConfig.format.enabled}
            helperText={typeConfig.format.helperText}
          />
          {column.recommended.type === "enum" && (
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
            {column.sampleValues.length > 3 && "…"}
          </Typography>
        )}
      </Stack>
    </Box>
  );
});

// --- Component ---

export const ColumnMappingStep: React.FC<ColumnMappingStepProps> = ({
  entities,
  dbEntities,
  isLoadingDbEntities,
  onUpdateColumn,
  errors = {},
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
                fieldErrors={errors[entityIndex]?.[columnIndex]}
              />
            ))}
          </Stack>
        </TabPanel>
      ))}
    </Stack>
  );
};
