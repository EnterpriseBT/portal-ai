/**
 * AdvancedFilterBuilder — recursive filter group/condition builder.
 *
 * Renders a tree of FilterGroups with AND/OR combinators.
 * Each leaf condition has a column select, operator select, and
 * type-aware value input.
 */

import React from "react";

import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import AddIcon from "@mui/icons-material/Add";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import FormControl from "@mui/material/FormControl";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import { Button, Typography } from "@portalai/core/ui";

import {
  OPERATORS_BY_COLUMN_TYPE,
  MAX_FILTER_DEPTH,
  MAX_CONDITIONS,
  countConditions,
  measureDepth,
} from "@portalai/core/contracts";
import type {
  FilterExpression,
  FilterGroup,
  FilterCondition,
  FilterOperator,
  FilterCombinator,
  ColumnDefinitionSummary,
} from "@portalai/core/contracts";
import type { ColumnDataType } from "@portalai/core/models";

import { getOperatorLabel, createDefaultCondition, createEmptyGroup } from "../utils/advanced-filter-builder.util";

// ── Props ───────────────────────────────────────────────────────────

export interface AdvancedFilterBuilderProps {
  expression: FilterExpression;
  onChange: (expression: FilterExpression) => void;
  columnDefinitions: ColumnDefinitionSummary[];
}

// ── Main component ──────────────────────────────────────────────────

export const AdvancedFilterBuilderUI: React.FC<AdvancedFilterBuilderProps> = ({
  expression,
  onChange,
  columnDefinitions,
}) => {
  const totalConditions = countConditions(expression);
  const depth = measureDepth(expression);
  const canAddCondition = totalConditions < MAX_CONDITIONS;
  const canAddGroup = depth < MAX_FILTER_DEPTH && totalConditions < MAX_CONDITIONS;

  if (columnDefinitions.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          No columns available for filtering.
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, minWidth: 500 }}>
      <FilterGroupEditor
        group={expression}
        onChange={onChange}
        columnDefinitions={columnDefinitions}
        depth={1}
        canAddCondition={canAddCondition}
        canAddGroup={canAddGroup}
        isRoot
      />
    </Box>
  );
};

export const AdvancedFilterBuilder = AdvancedFilterBuilderUI;

// ── FilterGroupEditor ───────────────────────────────────────────────

interface FilterGroupEditorProps {
  group: FilterGroup;
  onChange: (group: FilterGroup) => void;
  onRemove?: () => void;
  columnDefinitions: ColumnDefinitionSummary[];
  depth: number;
  canAddCondition: boolean;
  canAddGroup: boolean;
  isRoot?: boolean;
}

const FilterGroupEditor: React.FC<FilterGroupEditorProps> = ({
  group,
  onChange,
  onRemove,
  columnDefinitions,
  depth,
  canAddCondition,
  canAddGroup,
  isRoot = false,
}) => {
  const handleCombinatorChange = (_: unknown, value: string | null) => {
    if (value === "and" || value === "or") {
      onChange({ ...group, combinator: value as FilterCombinator });
    }
  };

  const handleConditionChange = (index: number, item: FilterCondition | FilterGroup) => {
    const next = [...group.conditions];
    next[index] = item;
    onChange({ ...group, conditions: next });
  };

  const handleRemoveCondition = (index: number) => {
    const next = group.conditions.filter((_, i) => i !== index);
    onChange({ ...group, conditions: next });
  };

  const handleAddCondition = () => {
    const defaultField = columnDefinitions[0]?.key ?? "";
    onChange({
      ...group,
      conditions: [...group.conditions, createDefaultCondition(defaultField)],
    });
  };

  const handleAddGroup = () => {
    const defaultField = columnDefinitions[0]?.key ?? "";
    const newGroup = createEmptyGroup();
    newGroup.conditions = [createDefaultCondition(defaultField)];
    onChange({
      ...group,
      conditions: [...group.conditions, newGroup],
    });
  };

  return (
    <Box
      sx={{
        border: isRoot ? undefined : "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        p: isRoot ? 0 : 1.5,
        position: "relative",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <ToggleButtonGroup
          value={group.combinator}
          exclusive
          onChange={handleCombinatorChange}
          size="small"
        >
          <ToggleButton value="and" sx={{ px: 1.5, py: 0.25, textTransform: "none" }}>
            AND
          </ToggleButton>
          <ToggleButton value="or" sx={{ px: 1.5, py: 0.25, textTransform: "none" }}>
            OR
          </ToggleButton>
        </ToggleButtonGroup>

        <Box sx={{ flex: 1 }} />

        {!isRoot && onRemove && (
          <IconButton size="small" onClick={onRemove} color="error">
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        )}
      </Box>

      {/* Conditions */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {group.conditions.map((item, index) => {
          if ("combinator" in item) {
            return (
              <FilterGroupEditor
                key={index}
                group={item}
                onChange={(updated) => handleConditionChange(index, updated)}
                onRemove={() => handleRemoveCondition(index)}
                columnDefinitions={columnDefinitions}
                depth={depth + 1}
                canAddCondition={canAddCondition}
                canAddGroup={depth + 1 < MAX_FILTER_DEPTH && canAddCondition}
              />
            );
          }
          return (
            <FilterConditionEditor
              key={index}
              condition={item}
              onChange={(updated) => handleConditionChange(index, updated)}
              onRemove={() => handleRemoveCondition(index)}
              columnDefinitions={columnDefinitions}
            />
          );
        })}
      </Box>

      {/* Add buttons */}
      <Box sx={{ display: "flex", gap: 1, mt: 1 }}>
        <Button
          variant="text"
          size="small"
          startIcon={<AddIcon />}
          onClick={handleAddCondition}
          disabled={!canAddCondition}
        >
          Condition
        </Button>
        <Button
          variant="text"
          size="small"
          startIcon={<PlaylistAddIcon />}
          onClick={handleAddGroup}
          disabled={!canAddGroup}
        >
          Group
        </Button>
      </Box>
    </Box>
  );
};

// ── FilterConditionEditor ───────────────────────────────────────────

interface FilterConditionEditorProps {
  condition: FilterCondition;
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
  columnDefinitions: ColumnDefinitionSummary[];
}

const FilterConditionEditor: React.FC<FilterConditionEditorProps> = ({
  condition,
  onChange,
  onRemove,
  columnDefinitions,
}) => {
  const colDef = columnDefinitions.find((c) => c.key === condition.field);
  const colType: ColumnDataType = colDef?.type ?? "string";
  const operators = OPERATORS_BY_COLUMN_TYPE[colType] ?? OPERATORS_BY_COLUMN_TYPE.string;

  // Reset operator and value when field changes
  const handleFieldChange = (field: string) => {
    const newColDef = columnDefinitions.find((c) => c.key === field);
    const newType: ColumnDataType = newColDef?.type ?? "string";
    const newOperators = OPERATORS_BY_COLUMN_TYPE[newType];
    const newOp = newOperators.includes(condition.operator as FilterOperator)
      ? condition.operator
      : newOperators[0];
    onChange({ field, operator: newOp, value: "" });
  };

  const handleOperatorChange = (operator: FilterOperator) => {
    // Clear value for empty/not-empty operators
    const value = operator === "is_empty" || operator === "is_not_empty" ? null : condition.value;
    onChange({ ...condition, operator, value });
  };

  const needsValue = condition.operator !== "is_empty" && condition.operator !== "is_not_empty";
  const isBetween = condition.operator === "between";

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      {/* Column select */}
      <FormControl size="small" sx={{ minWidth: 130 }}>
        <Select
          value={condition.field}
          onChange={(e) => handleFieldChange(e.target.value)}
          displayEmpty
        >
          {columnDefinitions.map((col) => (
            <MenuItem key={col.key} value={col.key}>
              {col.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Operator select */}
      <FormControl size="small" sx={{ minWidth: 120 }}>
        <Select
          value={condition.operator}
          onChange={(e) => handleOperatorChange(e.target.value as FilterOperator)}
        >
          {operators.map((op) => (
            <MenuItem key={op} value={op}>
              {getOperatorLabel(op)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Value input */}
      {needsValue && (
        <Box sx={{ flex: 1, minWidth: 100 }}>
          <FilterValueInput
            condition={condition}
            colType={colType}
            isBetween={isBetween}
            onChange={onChange}
          />
        </Box>
      )}

      {/* Remove */}
      <IconButton size="small" onClick={onRemove} color="error">
        <DeleteOutlineIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

// ── FilterValueInput ────────────────────────────────────────────────

interface FilterValueInputProps {
  condition: FilterCondition;
  colType: ColumnDataType;
  isBetween: boolean;
  onChange: (condition: FilterCondition) => void;
}

const FilterValueInput: React.FC<FilterValueInputProps> = ({
  condition,
  colType,
  isBetween,
  onChange,
}) => {
  switch (colType) {
    case "boolean":
      return (
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={String(condition.value) === "true"}
              onChange={(e) => onChange({ ...condition, value: e.target.checked })}
            />
          }
          label={String(condition.value) === "true" ? "True" : "False"}
        />
      );

    case "number":
    case "currency":
      if (isBetween) {
        const arr = Array.isArray(condition.value) ? condition.value : ["", ""];
        return (
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            <TextField
              size="small"
              type="number"
              placeholder="Min"
              value={arr[0] ?? ""}
              onChange={(e) => onChange({ ...condition, value: [e.target.value, arr[1] ?? ""] })}
              sx={{ flex: 1 }}
            />
            <Typography variant="body2">-</Typography>
            <TextField
              size="small"
              type="number"
              placeholder="Max"
              value={arr[1] ?? ""}
              onChange={(e) => onChange({ ...condition, value: [arr[0] ?? "", e.target.value] })}
              sx={{ flex: 1 }}
            />
          </Box>
        );
      }
      return (
        <TextField
          size="small"
          type="number"
          fullWidth
          placeholder="Value"
          value={condition.value ?? ""}
          onChange={(e) => onChange({ ...condition, value: Number(e.target.value) })}
        />
      );

    case "date":
      if (isBetween) {
        const arr = Array.isArray(condition.value) ? condition.value : ["", ""];
        return (
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            <TextField
              size="small"
              type="date"
              value={arr[0] ?? ""}
              onChange={(e) => onChange({ ...condition, value: [e.target.value, arr[1] ?? ""] })}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Typography variant="body2">-</Typography>
            <TextField
              size="small"
              type="date"
              value={arr[1] ?? ""}
              onChange={(e) => onChange({ ...condition, value: [arr[0] ?? "", e.target.value] })}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
        );
      }
      return (
        <TextField
          size="small"
          type="date"
          fullWidth
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      );

    case "datetime":
      if (isBetween) {
        const arr = Array.isArray(condition.value) ? condition.value : ["", ""];
        return (
          <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
            <TextField
              size="small"
              type="datetime-local"
              value={arr[0] ?? ""}
              onChange={(e) => onChange({ ...condition, value: [e.target.value, arr[1] ?? ""] })}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Typography variant="body2">-</Typography>
            <TextField
              size="small"
              type="datetime-local"
              value={arr[1] ?? ""}
              onChange={(e) => onChange({ ...condition, value: [arr[0] ?? "", e.target.value] })}
              sx={{ flex: 1 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
        );
      }
      return (
        <TextField
          size="small"
          type="datetime-local"
          fullWidth
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      );

    case "enum": {
      // For in/not_in, allow comma-separated values as a simple text input
      const isMulti = condition.operator === "in" || condition.operator === "not_in";
      if (isMulti) {
        const arr = Array.isArray(condition.value) ? condition.value : [];
        return (
          <TextField
            size="small"
            fullWidth
            placeholder="value1, value2, ..."
            value={arr.join(", ")}
            onChange={(e) => {
              const values = e.target.value.split(",").map((v) => v.trim()).filter(Boolean);
              onChange({ ...condition, value: values });
            }}
          />
        );
      }
      return (
        <TextField
          size="small"
          fullWidth
          placeholder="Value"
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
        />
      );
    }

    // string, reference, array, json, and fallback
    default:
      return (
        <TextField
          size="small"
          fullWidth
          placeholder="Value"
          value={String(condition.value ?? "")}
          onChange={(e) => onChange({ ...condition, value: e.target.value })}
        />
      );
  }
};
