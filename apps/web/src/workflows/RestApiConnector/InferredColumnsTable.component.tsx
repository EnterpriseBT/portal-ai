/**
 * Editable per-endpoint columns table for `EndpointColumnReview`.
 *
 * Slice 7 follow-up: rebuilds the bespoke MUI Table on top of the
 * shared `DataTable` from `@portalai/core/ui` so the layout, overflow,
 * and TableContainer wiring stay consistent with the rest of the app.
 * Each cell renders a controlled MUI input (TextField / Select /
 * Checkbox / IconButton) via DataTable's per-column `render` callback;
 * row changes are dispatched by index to the parent.
 *
 * Pure UI — the parent owns the rows array and dispatches edit events.
 */

import React from "react";

import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import CloseIcon from "@mui/icons-material/Close";
import {
  Button,
  DataTable,
  Stack,
  Typography,
  type DataTableColumn,
} from "@portalai/core/ui";
import {
  ColumnDataTypeEnum,
  type ColumnDataType,
} from "@portalai/core/models";

import type { FormErrors } from "../../utils/form-validation.util";
import type { ColumnRowDraft } from "./utils/rest-api-validation.util";
import { SuggestionChipUI } from "./SuggestionChip.component";

const COLUMN_TYPE_OPTIONS: ColumnDataType[] = [...ColumnDataTypeEnum.options];

const SAMPLE_PREVIEW_MAX = 60;

function formatSamplePreview(samples: unknown[]): string {
  if (samples.length === 0) return "—";
  const head = samples
    .slice(0, 3)
    .map((s) => (typeof s === "string" ? s : JSON.stringify(s)))
    .map((s) =>
      s.length > SAMPLE_PREVIEW_MAX ? s.slice(0, SAMPLE_PREVIEW_MAX) + "…" : s
    )
    .join(", ");
  return samples.length > 3 ? `${head}, …` : head;
}

export interface InferredColumnsTableUIProps {
  rows: ColumnRowDraft[];
  onChange: (index: number, patch: Partial<ColumnRowDraft>) => void;
  onAdoptSuggestion: (index: number) => void;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  errors: FormErrors;
}

// Internal row shape DataTable consumes. `__row` carries the original
// draft + index so per-cell renderers can dispatch back to the parent
// without separate prop drilling.
interface TableRow extends Record<string, unknown> {
  __index: number;
  __row: ColumnRowDraft;
  __error: string | undefined;
}

export const InferredColumnsTableUI: React.FC<InferredColumnsTableUIProps> = ({
  rows,
  onChange,
  onAdoptSuggestion,
  onAddRow,
  onRemoveRow,
  errors,
}) => {
  const tableRows: TableRow[] = React.useMemo(
    () =>
      rows.map((row, index) => ({
        __index: index,
        __row: row,
        __error: errors[`row-${index}-normalizedKey`],
        sourceField: row.sourceField,
        normalizedKey: row.normalizedKey,
        type: row.type,
        required: row.required,
        sample: row.samples,
      })),
    [rows, errors]
  );

  const columns: DataTableColumn[] = React.useMemo(
    () => [
      {
        key: "sourceField",
        label: "Source field",
        render: (_value, row) => {
          const r = row as TableRow;
          return (
            <Stack spacing={0.5}>
              <Typography variant="body2">
                {r.__row.sourceField || <em>(manual)</em>}
              </Typography>
              {r.__row.suggestion ? (
                <SuggestionChipUI
                  suggestion={r.__row.suggestion}
                  onAdopt={() => onAdoptSuggestion(r.__index)}
                />
              ) : null}
            </Stack>
          );
        },
      },
      {
        key: "normalizedKey",
        label: "Normalized key",
        render: (_value, row) => {
          const r = row as TableRow;
          return (
            <TextField
              value={r.__row.normalizedKey}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onChange(r.__index, { normalizedKey: e.target.value })
              }
              size="small"
              fullWidth
              error={!!r.__error}
              helperText={r.__error}
              slotProps={{
                htmlInput: {
                  "aria-invalid": !!r.__error,
                  "aria-label": `Normalized key for ${
                    r.__row.sourceField || "row " + r.__index
                  }`,
                },
              }}
            />
          );
        },
      },
      {
        key: "type",
        label: "Type",
        render: (_value, row) => {
          const r = row as TableRow;
          return (
            <TextField
              select
              value={r.__row.type}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onChange(r.__index, {
                  type: e.target.value as ColumnDataType,
                })
              }
              size="small"
              fullWidth
              slotProps={{
                htmlInput: {
                  "aria-label": `Type for ${
                    r.__row.sourceField || "row " + r.__index
                  }`,
                },
              }}
            >
              {COLUMN_TYPE_OPTIONS.map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>
          );
        },
      },
      {
        key: "required",
        label: "Required",
        render: (_value, row) => {
          const r = row as TableRow;
          return (
            <Checkbox
              checked={r.__row.required}
              onChange={(e) =>
                onChange(r.__index, { required: e.target.checked })
              }
              inputProps={{
                "aria-label": `Required toggle for ${
                  r.__row.sourceField || "row " + r.__index
                }`,
              }}
            />
          );
        },
      },
      {
        key: "sample",
        label: "Sample",
        render: (_value, row) => {
          const r = row as TableRow;
          return (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ wordBreak: "break-word" }}
            >
              {formatSamplePreview(r.__row.samples)}
            </Typography>
          );
        },
      },
      {
        key: "__actions",
        label: "",
        render: (_value, row) => {
          const r = row as TableRow;
          return (
            <IconButton
              size="small"
              onClick={() => onRemoveRow(r.__index)}
              aria-label={`Remove column ${
                r.__row.sourceField || "row " + r.__index
              }`}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          );
        },
      },
    ],
    [onChange, onAdoptSuggestion, onRemoveRow]
  );

  return (
    <Stack spacing={1} sx={{ minWidth: 0 }}>
      <DataTable
        columns={columns}
        rows={tableRows}
        emptyMessage="No columns yet. Click Add column below to add one."
      />

      <Stack direction="row">
        <Button type="button" variant="outlined" size="small" onClick={onAddRow}>
          Add column
        </Button>
      </Stack>
    </Stack>
  );
};
