import React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";

import { newKeyValueRow, type KeyValueRow } from "../utils/key-value-rows.util";
import { blurUnlessDialogControl } from "../utils/dialog-blur.util";

export interface KeyValueTableUIProps {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  /** A row's key field lost focus (marks it touched). */
  onKeyBlur?: (index: number) => void;
  /** Per-row key error, already filtered to touched rows; index-aligned. */
  keyErrors?: Array<string | undefined>;
  /** What one row is, for the button and accessible names ("parameter"). */
  itemNoun?: string;
  keyLabel?: string;
  valueLabel?: string;
  /** One line shown when there are no rows. */
  emptyHint?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

/**
 * An editable two-column key/value table (#808): one row per entry, a remove
 * button per row and an add button below. Query params today, request
 * headers next (#809). Fully controlled; the caller validates.
 */
export const KeyValueTableUI: React.FC<KeyValueTableUIProps> = ({
  rows,
  onChange,
  onKeyBlur,
  keyErrors = [],
  itemNoun = "parameter",
  keyLabel = "Key",
  valueLabel = "Value",
  emptyHint,
  keyPlaceholder,
  valuePlaceholder,
}) => {
  const update = (index: number, patch: Partial<KeyValueRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const remove = (index: number) =>
    onChange(rows.filter((_, i) => i !== index));
  const add = () => onChange([...rows, newKeyValueRow()]);

  return (
    <Box>
      {rows.length === 0 ? (
        emptyHint ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {emptyHint}
          </Typography>
        ) : null
      ) : (
        <Table size="small" sx={{ mb: 1 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ pl: 0 }}>{keyLabel}</TableCell>
              <TableCell>{valueLabel}</TableCell>
              <TableCell padding="checkbox">
                <Box component="span" sx={visuallyHidden}>
                  Actions
                </Box>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, i) => {
              const error = keyErrors[i];
              const n = i + 1;
              return (
                <TableRow key={row.id}>
                  <TableCell sx={{ pl: 0, verticalAlign: "top" }}>
                    <TextField
                      size="small"
                      fullWidth
                      value={row.key}
                      placeholder={keyPlaceholder}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        update(i, { key: e.target.value })
                      }
                      onBlur={blurUnlessDialogControl(() => onKeyBlur?.(i))}
                      error={!!error}
                      helperText={error}
                      slotProps={{
                        htmlInput: {
                          "aria-label": `${keyLabel} ${n}`,
                          "aria-invalid": !!error,
                        },
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "top" }}>
                    <TextField
                      size="small"
                      fullWidth
                      value={row.value}
                      placeholder={valuePlaceholder}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        update(i, { value: e.target.value })
                      }
                      slotProps={{
                        htmlInput: { "aria-label": `${valueLabel} ${n}` },
                      }}
                    />
                  </TableCell>
                  <TableCell padding="checkbox" sx={{ verticalAlign: "top" }}>
                    <IconButton
                      type="button"
                      size="small"
                      onClick={() => remove(i)}
                      aria-label={`Remove ${itemNoun} ${row.key.trim() || n}`}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <Button type="button" size="small" startIcon={<AddIcon />} onClick={add}>
        Add {itemNoun}
      </Button>
    </Box>
  );
};

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
} as const;
