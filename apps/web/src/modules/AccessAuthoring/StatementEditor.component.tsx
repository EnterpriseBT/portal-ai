import React, { useState, useCallback, useEffect } from "react";

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
  NAV_PAGE_IDS,
  verbsForResource,
  defaultVerbForResource,
  resourceAllowsInstanceScope,
  resourceAllowsOwnership,
  isVerbValidForResource,
} from "@portalai/core/models";
import type {
  PermissionVerb,
  PermissionResourceType,
} from "@portalai/core/models";
import type { PolicyStatementInput } from "@portalai/core/contracts";

/**
 * Resource types whose instances are a **fixed, known set** rather than searched
 * DB objects (#630). `page` ids are the nav pages (`NAV_PAGE_IDS`), so the scope
 * picker offers them directly — without this a `view page:<id>` grant renders an
 * object-search picker that can't resolve the id and shows an empty scope.
 */
const FIXED_OPTIONS: Record<string, SelectOption[]> = {
  page: NAV_PAGE_IDS.map((id) => ({ value: id, label: id })),
};

/**
 * Which (verb × resource × scope) combinations a statement may take is defined
 * **once** by `RESOURCE_CAPABILITIES` in `@portalai/core` (#630). The editor
 * derives every affordance from it, so only valid statements can be constructed:
 * the Verb menu lists exactly `verbsForResource(type)`; the Scope offers "Specific
 * objects" only when `resourceAllowsInstanceScope`; the ownership condition only
 * when `resourceAllowsOwnership`; and changing the resource coerces an orphaned
 * verb to `defaultVerbForResource`. The `view`⟺`page` pairing is not special-cased
 * — `view` is in no verb set but `page`'s, so it falls out of the matrix. The
 * row's current verb is kept in the menu (`verbOptionsFor`) so a legacy statement
 * still renders while it's being corrected.
 */
const verbOptionsFor = (
  resourceType: PermissionResourceType,
  current: string
): string[] => {
  const valid = verbsForResource(resourceType);
  return (valid as readonly string[]).includes(current)
    ? [...valid]
    : [current, ...valid];
};

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
  /** Read-only render (a system policy) — every control is disabled. */
  readOnly?: boolean;
}

export const StatementEditorUI: React.FC<StatementEditorUIProps> = ({
  initialStatements,
  onChange,
  onSearch,
  readOnly = false,
}) => {
  const [rows, setRows] = useState<StatementRow[]>(() =>
    statementsToRows(initialStatements ?? [])
  );

  // Sync the parent with the initially-rendered rows once at mount — a new
  // policy shows a default row and an edit shows its seeded rows, but neither
  // fires onChange until the user touches something. Without this, a Save with
  // no edits sends an empty statement set and the visible row is silently
  // dropped (400 ORGANIZATION_INVALID_PAYLOAD). onChange is a stable setter and
  // rows is mount-seeded, so this runs exactly once.
  useEffect(() => {
    onChange(rowsToStatements(rows));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only sync; see comment above
  }, []);

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
        const fixedOptions = FIXED_OPTIONS[row.resourceType];
        const pickable = resourceAllowsInstanceScope(row.resourceType);
        const ownershipAllowed = resourceAllowsOwnership(row.resourceType);
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
              disabled={readOnly}
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
              // The menu only offers verbs valid for the current resource, so a
              // selection is always in-bounds — no coercion needed here.
              onChange={(e) =>
                patch(i, { verb: e.target.value as StatementRow["verb"] })
              }
              disabled={readOnly}
              sx={{ minWidth: 100 }}
            >
              {verbOptionsFor(row.resourceType, row.verb).map((v) => (
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
              onChange={(e) => {
                const resourceType = e.target
                  .value as StatementRow["resourceType"];
                patch(i, {
                  resourceType,
                  // Changing type resets the instance selection + ownership.
                  scope: "class",
                  objectIds: [],
                  condition: "",
                  // Coerce a now-invalid verb to the new resource's default
                  // (#630 matrix) — this is where `view`⟺`page` falls out.
                  ...(isVerbValidForResource(
                    row.verb as PermissionVerb,
                    resourceType
                  )
                    ? {}
                    : {
                        verb: defaultVerbForResource(
                          resourceType
                        ) as StatementRow["verb"],
                      }),
                });
              }}
              disabled={readOnly}
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
              disabled={readOnly}
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
                label={fixedOptions ? "Pages" : "Objects"}
                placeholder={fixedOptions ? "Select…" : "Search by name…"}
                value={row.objectIds}
                onChange={(objectIds) => patch(i, { objectIds })}
                onSearch={
                  fixedOptions
                    ? async (q) =>
                        fixedOptions.filter((o) =>
                          o.label.toLowerCase().includes(q.toLowerCase())
                        )
                    : (q) => onSearch(row.resourceType, q)
                }
                disabled={readOnly}
                fullWidth
              />
            ) : ownershipAllowed ? (
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
                disabled={readOnly}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="">Any</MenuItem>
                {PERMISSION_CONDITIONS.map((c) => (
                  <MenuItem key={c} value={c}>
                    {c}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}

            <IconButton
              size="small"
              aria-label={`remove statement ${i}`}
              disabled={readOnly || rows.length === 1}
              onClick={() => commit(rows.filter((_, idx) => idx !== i))}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Stack>
        );
      })}

      {!readOnly && (
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
        >
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
      )}
    </Stack>
  );
};
