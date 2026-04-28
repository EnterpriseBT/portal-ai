import React from "react";
import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";
import MuiPopover from "@mui/material/Popover";
import MuiChip from "@mui/material/Chip";
import {
  AsyncSearchableSelect,
  Box,
  Button,
  Checkbox,
  Divider,
  Select,
  Stack,
  TextInput,
  Typography,
} from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import type { ColumnDataType } from "@portalai/core/models";
import { sourceLocatorToNormalizedKey } from "@portalai/core/contracts";

import type { ColumnBindingDraft } from "./utils/region-editor.types";
import type { SearchResult } from "../../api/types";
import type { ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";
import { FormAlert } from "../../components/FormAlert.component";

export interface BindingEditorPopoverUIProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  /** The original binding — currently-committed values, used for comparison display. */
  binding: ColumnBindingDraft;
  /** Live edit buffer the parent controls. Every field edit fires `onChange` with a partial. */
  draft: ColumnBindingDraft;
  /** Resolved ColumnDefinition type for the bound definition — gates per-type editors. */
  columnDefinitionType?: ColumnDataType;
  /** Resolved ColumnDefinition description (for the read-only metadata line). */
  columnDefinitionDescription?: string | null;
  /** Search hook result for the ColumnDefinition rebind picker. */
  columnDefinitionSearch: SearchResult<SelectOption>;
  /**
   * Reference-target entity options, prepared by the container. Typically a
   * mix of staged sibling entities ("this import") and existing org entities.
   */
  referenceEntityOptions?: SelectOption[];
  /**
   * Normalized-key options on the currently-selected reference target. When
   * the caller can't resolve these synchronously (e.g. DB target whose
   * mappings haven't loaded yet), pass `undefined` to disable the select.
   */
  referenceFieldOptions?: SelectOption[];
  errors: FormErrors;
  serverError: ServerError | null;
  /**
   * Optional override for the popover header. Callers building synthetic
   * `ColumnBindingDraft`s for non-locator-derived sources (review-step
   * pivot / cellValueField chips) supply this so the header renders the
   * underlying axisName / cellValueField.name + a meaningful kind chip
   * instead of the opaque sourceLocator string.
   */
  titleOverride?: { primary: string; kind: string };
  /**
   * Optional override for the normalizedKey input's "Defaults to …" hint.
   * Synthetic locators (`pivot:<segId>` / `cellValueField`) don't encode
   * the underlying source name in the locator string, so the parent
   * derives the default from `seg.axisName` / `cellValueField.name` and
   * passes it here. Falls back to `sourceLocatorToNormalizedKey` when
   * unset (existing behavior for static columnBindings).
   */
  derivedNormalizedKey?: string;
  /**
   * Synthetic-locator-only: configures a "Name" input rendered at the top
   * of the form (autofocused on open). Pivot chips show "Axis name"
   * binding to `segment.axisName`; cellValueField chips show "Field name"
   * binding to `cellValueField.name`. Edits live in `draft.sourceField`;
   * static columnBindings omit this prop because their source name is
   * baked into the locator string and not user-editable.
   */
  nameField?: { label: string; helperText?: string };
  onChange: (patch: Partial<ColumnBindingDraft>) => void;
  onApply: () => void;
  onCancel: () => void;
}

function parseLocator(
  sourceLocator: string
): { kind: "header"; name: string } | { kind: "column"; col: number } | null {
  if (sourceLocator.startsWith("header:")) {
    return { kind: "header", name: sourceLocator.slice("header:".length) };
  }
  if (sourceLocator.startsWith("col:")) {
    const col = Number(sourceLocator.slice("col:".length));
    if (Number.isFinite(col)) return { kind: "column", col };
  }
  return null;
}

function locatorTitle(sourceLocator: string): { primary: string; kind: string } {
  const parsed = parseLocator(sourceLocator);
  if (!parsed) return { primary: sourceLocator, kind: "Source" };
  if (parsed.kind === "header") {
    return { primary: parsed.name, kind: "Header" };
  }
  return { primary: `Column ${parsed.col}`, kind: "Column" };
}

const REFERENCE_TYPES: ReadonlySet<ColumnDataType> = new Set([
  "reference",
  "reference-array",
]);

export const BindingEditorPopoverUI: React.FC<BindingEditorPopoverUIProps> = ({
  open,
  anchorEl,
  draft,
  columnDefinitionType,
  columnDefinitionDescription,
  columnDefinitionSearch,
  referenceEntityOptions,
  referenceFieldOptions,
  errors,
  serverError,
  titleOverride,
  derivedNormalizedKey: derivedNormalizedKeyProp,
  nameField,
  onChange,
  onApply,
  onCancel,
}) => {
  // Autofocus the source-name input on open. Popover transitions are
  // similar enough to MUI Dialog's that the same delay-and-focus helper
  // works — using it instead of native `autoFocus` avoids React's
  // aria-hidden focus-trap conflict during the transition.
  const nameInputRef = useDialogAutoFocus<HTMLInputElement>(
    open && nameField !== undefined
  );
  const title = titleOverride ?? locatorTitle(draft.sourceLocator);
  const isExcluded = draft.excluded === true;
  const isReference = columnDefinitionType
    ? REFERENCE_TYPES.has(columnDefinitionType)
    : false;
  const hasErrors = Object.keys(errors).length > 0;
  // Default normalized key derives from the source field name. Commit uses
  // the same derivation when no override is set, so what the user sees here
  // is what gets written unless they edit it.
  const derivedNormalizedKey =
    derivedNormalizedKeyProp ??
    sourceLocatorToNormalizedKey(draft.sourceLocator);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasErrors) return;
    onApply();
  };

  return (
    <MuiPopover
      open={open}
      anchorEl={anchorEl}
      onClose={onCancel}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{
        paper: {
          component: "form",
          role: "dialog",
          "aria-label": "Edit column binding",
          onSubmit: handleSubmit,
          sx: { width: 380, maxWidth: "95vw", p: 2 },
        } as object,
      }}
    >
      <Stack spacing={1.5}>
        {/* Header — source locator */}
        <Stack direction="row" spacing={1} alignItems="center">
          <MuiChip size="small" label={title.kind} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {title.primary}
          </Typography>
        </Stack>

        {/* Synthetic-locator name input — pivot's `axisName` /
            cellValueField's `name`. Static columnBindings have their
            source name baked into the locator and don't render this. */}
        {nameField && (
          <TextInput
            inputRef={nameInputRef}
            label={nameField.label}
            value={draft.sourceField ?? ""}
            onChange={(e) => onChange({ sourceField: e.target.value })}
            disabled={isExcluded}
            helperText={nameField.helperText}
            fullWidth
          />
        )}

        {/* Server-error banner (outside the per-field errors) */}
        {serverError && <FormAlert serverError={serverError} />}

        {/* Excluded notice */}
        {isExcluded && (
          <Alert severity="info">
            Excluded — no field mapping will be created for this column.
          </Alert>
        )}

        {/* ColumnDefinition picker */}
        <AsyncSearchableSelect
          label="Column Definition"
          value={draft.columnDefinitionId}
          onChange={(value) => onChange({ columnDefinitionId: value })}
          onSearch={columnDefinitionSearch.onSearch}
          loadSelectedOption={columnDefinitionSearch.getById}
          disabled={isExcluded}
          error={!!errors.columnDefinitionId}
          helperText={errors.columnDefinitionId}
          fullWidth
        />

        {/* Read-only ColumnDefinition metadata */}
        {(columnDefinitionType || columnDefinitionDescription) && (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            {columnDefinitionType && (
              <MuiChip
                size="small"
                variant="outlined"
                label={columnDefinitionType}
              />
            )}
            {columnDefinitionDescription && (
              <Typography variant="caption" color="text.secondary">
                {columnDefinitionDescription}
              </Typography>
            )}
          </Stack>
        )}

        {/* Omit toggle */}
        <Checkbox
          label="Omit this column from the entity"
          checked={isExcluded}
          onChange={(checked) => onChange({ excluded: checked })}
        />

        <Divider />

        {/* Normalized key — pre-populated by the parent with the derived
            source-name default. The field is always a real string so clearing
            actually clears; the parent's Apply diff treats "matches derived
            default" as "no override" so commit falls back to the derived
            default without persisting a spurious user override. */}
        <TextInput
          label="Normalized key"
          value={draft.normalizedKey ?? ""}
          onChange={(e) => onChange({ normalizedKey: e.target.value })}
          disabled={isExcluded}
          error={!!errors.normalizedKey}
          helperText={
            errors.normalizedKey ??
            `Defaults to the normalised source name ("${derivedNormalizedKey}"). Edit to override.`
          }
          slotProps={{
            htmlInput: {
              "aria-invalid": !!errors.normalizedKey,
            },
          }}
          fullWidth
        />

        {/* Reference editor */}
        {!isExcluded && isReference && (
          <>
            <Select
              label="Ref entity"
              value={draft.refEntityKey ?? ""}
              onChange={(e) =>
                onChange({ refEntityKey: e.target.value || null })
              }
              options={referenceEntityOptions ?? []}
              error={!!errors.refEntityKey}
              helperText={errors.refEntityKey}
              fullWidth
            />
            <Select
              label="Ref field"
              value={draft.refNormalizedKey ?? ""}
              onChange={(e) =>
                onChange({ refNormalizedKey: e.target.value || null })
              }
              options={referenceFieldOptions ?? []}
              disabled={!draft.refEntityKey}
              error={!!errors.refNormalizedKey}
              helperText={errors.refNormalizedKey}
              fullWidth
            />
          </>
        )}

        {/* Enum values */}
        {!isExcluded && columnDefinitionType === "enum" && (
          <TextInput
            label="Enum values"
            value={draft.enumValues?.join(", ") ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              const values = raw
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean);
              onChange({
                enumValues: values.length > 0 ? values : null,
              });
            }}
            helperText="Comma-separated list of allowed values."
            fullWidth
          />
        )}

        {/* Default + format + required */}
        {!isExcluded && (
          <>
            <TextInput
              label="Default value"
              value={draft.defaultValue ?? ""}
              onChange={(e) =>
                onChange({ defaultValue: e.target.value || null })
              }
              fullWidth
            />
            <TextInput
              label="Format"
              value={draft.format ?? ""}
              onChange={(e) =>
                onChange({ format: e.target.value || null })
              }
              helperText="How to parse the raw source values (optional)."
              fullWidth
            />
            <Checkbox
              label="Required"
              checked={draft.required === true}
              onChange={(checked) => onChange({ required: checked })}
            />
          </>
        )}

        {/* Footer actions */}
        <Box sx={{ pt: 0.5 }}>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button type="button" variant="text" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={hasErrors}>
              Apply
            </Button>
          </Stack>
        </Box>
      </Stack>
    </MuiPopover>
  );
};
