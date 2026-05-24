/**
 * Editable table rendered inside `EndpointColumnReview`. One row per
 * inferred (or manually-added) column with editable `normalizedKey`,
 * `type` (dropdown), `required` (checkbox), and a read-only sample
 * preview. Rows with `suggestion` render a `<SuggestionChipUI>`;
 * Adopt copies the suggestion into the editable fields.
 *
 * Pure UI — the parent owns the rows array and dispatches edit
 * events.
 */

import React from "react";

import Checkbox from "@mui/material/Checkbox";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import CloseIcon from "@mui/icons-material/Close";
import { Button, Stack, Typography } from "@portalai/core/ui";
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
    .map((s) => (s.length > SAMPLE_PREVIEW_MAX ? s.slice(0, SAMPLE_PREVIEW_MAX) + "…" : s))
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

export const InferredColumnsTableUI: React.FC<InferredColumnsTableUIProps> = ({
  rows,
  onChange,
  onAdoptSuggestion,
  onAddRow,
  onRemoveRow,
  errors,
}) => (
  <Stack spacing={1}>
    <Table size="small" aria-label="Inferred columns">
      <TableHead>
        <TableRow>
          <TableCell>Source field</TableCell>
          <TableCell>Normalized key</TableCell>
          <TableCell>Type</TableCell>
          <TableCell>Required</TableCell>
          <TableCell>Sample</TableCell>
          <TableCell aria-label="Row actions" />
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6}>
              <Typography variant="body2" color="text.secondary">
                No columns yet. Click <em>Add column</em> below to start, or
                use the probe button to auto-infer from a sample.
              </Typography>
            </TableCell>
          </TableRow>
        ) : null}
        {rows.map((row, index) => {
          const errorKey = `row-${index}-normalizedKey`;
          const rowError = errors[errorKey];
          return (
            <TableRow key={`${row.sourceField}-${index}`}>
              <TableCell>
                <Typography variant="body2">
                  {row.sourceField || <em>(manual)</em>}
                </Typography>
                {row.suggestion ? (
                  <SuggestionChipUI
                    suggestion={row.suggestion}
                    onAdopt={() => onAdoptSuggestion(index)}
                  />
                ) : null}
              </TableCell>
              <TableCell>
                <TextField
                  value={row.normalizedKey}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onChange(index, { normalizedKey: e.target.value })
                  }
                  size="small"
                  fullWidth
                  error={!!rowError}
                  helperText={rowError}
                  slotProps={{
                    htmlInput: {
                      "aria-invalid": !!rowError,
                      "aria-label": `Normalized key for ${row.sourceField || "row " + index}`,
                    },
                  }}
                />
              </TableCell>
              <TableCell>
                <TextField
                  select
                  value={row.type}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    onChange(index, {
                      type: e.target.value as ColumnDataType,
                    })
                  }
                  size="small"
                  slotProps={{
                    htmlInput: {
                      "aria-label": `Type for ${row.sourceField || "row " + index}`,
                    },
                  }}
                >
                  {COLUMN_TYPE_OPTIONS.map((t) => (
                    <MenuItem key={t} value={t}>
                      {t}
                    </MenuItem>
                  ))}
                </TextField>
              </TableCell>
              <TableCell>
                <Checkbox
                  checked={row.required}
                  onChange={(e) =>
                    onChange(index, { required: e.target.checked })
                  }
                  inputProps={{
                    "aria-label": `Required toggle for ${
                      row.sourceField || "row " + index
                    }`,
                  }}
                />
              </TableCell>
              <TableCell>
                <Typography variant="caption" color="text.secondary">
                  {formatSamplePreview(row.samples)}
                </Typography>
              </TableCell>
              <TableCell>
                <IconButton
                  size="small"
                  onClick={() => onRemoveRow(index)}
                  aria-label={`Remove column ${row.sourceField || "row " + index}`}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>

    <Stack direction="row">
      <Button type="button" variant="outlined" size="small" onClick={onAddRow}>
        Add column
      </Button>
    </Stack>
  </Stack>
);
