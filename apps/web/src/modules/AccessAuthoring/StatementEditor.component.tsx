import React, { useState, useCallback } from "react";

import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

import {
  Stack,
  Button,
  Typography,
  MultiAsyncSearchableSelect,
} from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import {
  PERMISSION_EFFECTS,
  PERMISSION_VERBS,
  PERMISSION_RESOURCE_TYPES,
  PERMISSION_CONDITIONS,
} from "@portalai/core/models";
import type { PolicyStatementInput } from "@portalai/core/contracts";

/** Object types the instance picker can search (management-plane; the rest are
 *  class-level only — mirrors the server's `RbacObjectSearchService`). */
const PICKABLE_TYPES = new Set([
  "station",
  "pin",
  "portal",
  "connector_instance",
  "entity",
]);

/** An editor row — an instance row carries N picked object ids that flatten to
 *  N statements on submit; a class row carries an optional ownership condition. */
export interface StatementRow {
  effect: (typeof PERMISSION_EFFECTS)[number];
  verb: (typeof PERMISSION_VERBS)[number];
  resourceType: (typeof PERMISSION_RESOURCE_TYPES)[number];
  scope: "class" | "instance";
  condition: (typeof PERMISSION_CONDITIONS)[number] | "";
  objectIds: string[];
}

const emptyRow = (): StatementRow => ({
  effect: "allow",
  verb: "read",
  resourceType: "station",
  scope: "class",
  condition: "",
  objectIds: [],
});

/** Flatten editor rows to the wire statements (instance rows fan out per id). */
export const rowsToStatements = (
  rows: StatementRow[]
): PolicyStatementInput[] =>
  rows.flatMap((r): PolicyStatementInput[] =>
    r.scope === "instance"
      ? r.objectIds.map(
          (resourceId): PolicyStatementInput => ({
            effect: r.effect,
            verb: r.verb,
            resourceType: r.resourceType,
            resourceId,
            condition: null,
          })
        )
      : [
          {
            effect: r.effect,
            verb: r.verb,
            resourceType: r.resourceType,
            resourceId: null,
            condition: r.condition === "" ? null : r.condition,
          },
        ]
  );

/** Seed editor rows from existing statements (each becomes a single row;
 *  instance rows aren't re-collapsed — one row per statement is fine to edit). */
export const statementsToRows = (
  statements: PolicyStatementInput[]
): StatementRow[] =>
  statements.length === 0
    ? [emptyRow()]
    : statements.map((s) => ({
        effect: s.effect,
        verb: s.verb,
        resourceType: s.resourceType,
        scope: s.resourceId ? "instance" : "class",
        condition: s.condition ?? "",
        objectIds: s.resourceId ? [s.resourceId] : [],
      }));

export interface StatementEditorUIProps {
  /** Seed rows (from an existing policy) — read once at mount. */
  initialStatements?: PolicyStatementInput[];
  /** Emits the flattened wire statements on every change. */
  onChange: (statements: PolicyStatementInput[]) => void;
  /** Per-resourceType object search feeding the instance picker. */
  onSearch: (resourceType: string, query: string) => Promise<SelectOption[]>;
}

export const StatementEditorUI: React.FC<StatementEditorUIProps> = ({
  initialStatements,
  onChange,
  onSearch,
}) => {
  const [rows, setRows] = useState<StatementRow[]>(() =>
    statementsToRows(initialStatements ?? [])
  );

  const commit = useCallback(
    (next: StatementRow[]) => {
      setRows(next);
      onChange(rowsToStatements(next));
    },
    [onChange]
  );

  const patch = (i: number, p: Partial<StatementRow>) =>
    commit(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  return (
    <Stack spacing={2}>
      {rows.map((row, i) => {
        const pickable = PICKABLE_TYPES.has(row.resourceType);
        return (
          <Stack
            key={i}
            direction="row"
            spacing={1}
            alignItems="flex-start"
            data-testid={`statement-row-${i}`}
          >
            <TextField
              select
              size="small"
              label="Effect"
              value={row.effect}
              onChange={(e) =>
                patch(i, { effect: e.target.value as StatementRow["effect"] })
              }
              sx={{ minWidth: 100 }}
            >
              {PERMISSION_EFFECTS.map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Verb"
              value={row.verb}
              onChange={(e) =>
                patch(i, { verb: e.target.value as StatementRow["verb"] })
              }
              sx={{ minWidth: 100 }}
            >
              {PERMISSION_VERBS.map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Resource"
              value={row.resourceType}
              onChange={(e) =>
                patch(i, {
                  resourceType: e.target.value as StatementRow["resourceType"],
                  // Leaving a pickable type resets an instance selection.
                  scope: "class",
                  objectIds: [],
                })
              }
              sx={{ minWidth: 140 }}
            >
              {PERMISSION_RESOURCE_TYPES.map((v) => (
                <MenuItem key={v} value={v}>
                  {v}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Scope"
              value={row.scope}
              onChange={(e) =>
                patch(i, { scope: e.target.value as StatementRow["scope"] })
              }
              sx={{ minWidth: 120 }}
              slotProps={{ htmlInput: { "aria-label": `scope-${i}` } }}
            >
              <MenuItem value="class">All of type</MenuItem>
              <MenuItem value="instance" disabled={!pickable}>
                Specific objects
              </MenuItem>
            </TextField>

            {row.scope === "instance" ? (
              <MultiAsyncSearchableSelect
                label="Objects"
                placeholder="Search by name…"
                value={row.objectIds}
                onChange={(objectIds) => patch(i, { objectIds })}
                onSearch={(q) => onSearch(row.resourceType, q)}
                fullWidth
              />
            ) : (
              <TextField
                select
                size="small"
                label="Ownership"
                value={row.condition}
                onChange={(e) =>
                  patch(i, {
                    condition: e.target.value as StatementRow["condition"],
                  })
                }
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="">Any</MenuItem>
                {PERMISSION_CONDITIONS.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <IconButton
              size="small"
              aria-label={`remove statement ${i}`}
              disabled={rows.length === 1}
              onClick={() => commit(rows.filter((_, idx) => idx !== i))}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Stack>
        );
      })}

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => commit([...rows, emptyRow()])}
        >
          Add statement
        </Button>
        <Typography variant="caption" color="text.secondary">
          Bounded to your own access — you can’t grant more than you hold.
        </Typography>
      </Stack>
    </Stack>
  );
};
