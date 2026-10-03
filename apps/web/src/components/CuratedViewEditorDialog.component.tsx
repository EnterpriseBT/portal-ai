import React, { useMemo, useState } from "react";

import {
  CuratedViewCreateRequestBodySchema,
  CuratedViewUpdateRequestBodySchema,
  type CuratedViewCreateRequestBody,
  type CuratedViewUpdateRequestBody,
  type CuratedViewWithProjection,
  type FilterExpression,
  type ResolvedColumn,
} from "@portalai/core/contracts";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import Typography from "@mui/material/Typography";
import { Button, Modal, Stack } from "@portalai/core/ui";

import { FormAlert } from "./FormAlert.component";
import { AdvancedFilterBuilder } from "./AdvancedFilterBuilder.component";
import { createEmptyGroup } from "../utils/advanced-filter-builder.util";
import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { useQueryClient } from "@tanstack/react-query";
import { toServerError, type ServerError } from "../utils/api.util";
import {
  validateWithSchema,
  focusFirstInvalidField,
  type FormErrors,
} from "../utils/form-validation.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";

/** A FilterExpression carries a real predicate only when it has conditions. */
function filterOrNull(f: FilterExpression): FilterExpression | null {
  return f.conditions.length > 0 ? f : null;
}

interface FieldMappingOption {
  id: string;
  label: string;
}

// ── Pure form UI ─────────────────────────────────────────────────────

export interface CuratedViewEditorUIProps {
  mode: "create" | "edit";
  onClose: () => void;
  /** Entity picker (create mode, when no entity is preset). */
  showEntitySelect: boolean;
  entityOptions: FieldMappingOption[];
  selectedEntityId: string;
  onEntityChange: (id: string) => void;
  /** Field-mapping options for the projection picker (the entity's columns). */
  fieldMappingOptions: FieldMappingOption[];
  /** Column definitions driving the row-filter builder. */
  columnDefinitions: ResolvedColumn[];
  // Controlled fields
  label: string;
  onLabelChange: (v: string) => void;
  keyValue: string;
  onKeyChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  selectedFieldMappingIds: string[];
  onSelectedFieldMappingIdsChange: (ids: string[]) => void;
  filter: FilterExpression;
  onFilterChange: (f: FilterExpression) => void;
  errors: FormErrors;
  touched: Record<string, boolean>;
  onLabelBlur: () => void;
  onKeyBlur: () => void;
  onSubmit: () => void;
  isPending?: boolean;
  serverError?: ServerError | null;
  /** Disabled when the entity (and thus its columns) isn't resolved yet. */
  columnsReady: boolean;
}

export const CuratedViewEditorUI: React.FC<CuratedViewEditorUIProps> = ({
  mode,
  onClose,
  showEntitySelect,
  entityOptions,
  selectedEntityId,
  onEntityChange,
  fieldMappingOptions,
  columnDefinitions,
  label,
  onLabelChange,
  keyValue,
  onKeyChange,
  description,
  onDescriptionChange,
  selectedFieldMappingIds,
  onSelectedFieldMappingIdsChange,
  filter,
  onFilterChange,
  errors,
  touched,
  onLabelBlur,
  onKeyBlur,
  onSubmit,
  isPending,
  serverError,
  columnsReady,
}) => {
  const labelRef = useDialogAutoFocus(true);
  const selectedOptions = fieldMappingOptions.filter((o) =>
    selectedFieldMappingIds.includes(o.id)
  );

  return (
    <Modal
      submitDisabled={isPending || !columnsReady}
      open
      onClose={onClose}
      title={mode === "create" ? "Create View" : "Edit View"}
      maxWidth="md"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            onSubmit();
          },
        } as object,
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            type="button"
            variant="outlined"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="contained"
            onClick={onSubmit}
            disabled={isPending || !columnsReady}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </Stack>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {showEntitySelect && (
          <Autocomplete
            options={entityOptions}
            getOptionLabel={(o) => o.label}
            value={entityOptions.find((o) => o.id === selectedEntityId) ?? null}
            onChange={(_e, next) => onEntityChange(next?.id ?? "")}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Entity"
                required
                helperText="The connector entity this view exposes."
              />
            )}
          />
        )}
        <TextField
          inputRef={labelRef}
          label="Label"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          onBlur={onLabelBlur}
          error={touched.label && !!errors.label}
          helperText={touched.label && errors.label}
          slotProps={{
            htmlInput: { "aria-invalid": touched.label && !!errors.label },
          }}
          required
          fullWidth
        />
        {mode === "create" && (
          <TextField
            label="Key"
            value={keyValue}
            onChange={(e) => onKeyChange(e.target.value)}
            onBlur={onKeyBlur}
            error={touched.key && !!errors.key}
            helperText={
              (touched.key && errors.key) ||
              "The queryable name for this view (unique per organization)."
            }
            slotProps={{
              htmlInput: { "aria-invalid": touched.key && !!errors.key },
            }}
            required
            fullWidth
          />
        )}
        <TextField
          label="Description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          fullWidth
          multiline
          rows={2}
        />

        <Autocomplete
          multiple
          options={fieldMappingOptions}
          getOptionLabel={(o) => o.label}
          value={selectedOptions}
          onChange={(_e, next) =>
            onSelectedFieldMappingIdsChange(next.map((o) => o.id))
          }
          disabled={!columnsReady}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Columns"
              helperText="Leave empty to include all of the entity's columns."
            />
          )}
        />

        <Stack spacing={1}>
          <Typography variant="subtitle2">Row filter</Typography>
          <AdvancedFilterBuilder
            expression={filter}
            onChange={onFilterChange}
            columnDefinitions={columnDefinitions}
          />
        </Stack>

        <FormAlert serverError={serverError ?? null} />
      </Stack>
    </Modal>
  );
};

// ── Container ────────────────────────────────────────────────────────

export interface CuratedViewEditorDialogProps {
  open: boolean;
  mode: "create" | "edit";
  /** The view being edited (edit mode). */
  view?: CuratedViewWithProjection;
  /** Preselected entity for create mode (e.g. from an entity's page). */
  connectorEntityId?: string;
  onClose: () => void;
  onSaved: () => void;
}

export const CuratedViewEditorDialog: React.FC<
  CuratedViewEditorDialogProps
> = ({ open, mode, view, connectorEntityId, onClose, onSaved }) => {
  if (!open) return null;
  return (
    <EditorContainer
      key={view?.id ?? "create"}
      mode={mode}
      view={view}
      connectorEntityId={connectorEntityId}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
};

const EditorContainer: React.FC<{
  mode: "create" | "edit";
  view?: CuratedViewWithProjection;
  connectorEntityId?: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ mode, view, connectorEntityId, onClose, onSaved }) => {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState(view?.label ?? "");
  const [keyValue, setKeyValue] = useState(view?.key ?? "");
  const [description, setDescription] = useState(view?.description ?? "");
  const [selectedFieldMappingIds, setSelectedFieldMappingIds] = useState<
    string[]
  >(view?.fieldMappingIds ?? []);
  const [filter, setFilter] = useState<FilterExpression>(
    (view?.filter as FilterExpression | null) ?? createEmptyGroup()
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [selectedEntityId, setSelectedEntityId] = useState(
    connectorEntityId ?? ""
  );

  const entityId = view?.connectorEntityId ?? selectedEntityId;
  // Entity picker options (create mode without a preset entity).
  const showEntitySelect = mode === "create" && !connectorEntityId;
  const entitiesResult = sdk.connectorEntities.list(undefined, {
    enabled: showEntitySelect,
  });
  const entityOptions: FieldMappingOption[] = useMemo(
    () =>
      (
        (entitiesResult.data?.connectorEntities ?? []) as Array<{
          id: string;
          label: string;
        }>
      ).map((e) => ({ id: e.id, label: e.label })),
    [entitiesResult.data]
  );

  // Field mappings (projection picker) + columns (filter builder) for the entity.
  const fieldMappingsResult = sdk.fieldMappings.list(
    {
      connectorEntityId: entityId,
      limit: 100,
      offset: 0,
      sortBy: "created",
      sortOrder: "asc",
    },
    { enabled: !!entityId }
  );
  const columnsResult = sdk.entityRecords.list(
    entityId,
    { limit: 1, offset: 0, sortBy: "created", sortOrder: "asc" },
    { enabled: !!entityId }
  );

  const fieldMappingOptions: FieldMappingOption[] = useMemo(
    () =>
      (fieldMappingsResult.data?.fieldMappings ?? []).map((fm) => ({
        id: fm.id,
        label: fm.normalizedKey,
      })),
    [fieldMappingsResult.data]
  );
  const columnDefinitions: ResolvedColumn[] = columnsResult.data?.columns ?? [];
  const columnsReady = !!entityId && !columnsResult.isLoading;

  const createMut = sdk.curatedViews.create();
  const updateMut = view ? sdk.curatedViews.update(view.id) : undefined;
  const isPending = createMut.isPending || (updateMut?.isPending ?? false);
  const serverError = toServerError(
    (createMut.error ?? updateMut?.error) as never
  );

  const handleSubmit = () => {
    setTouched({ label: true, key: true });
    const nextFilter = filterOrNull(filter);

    if (mode === "create") {
      const body: CuratedViewCreateRequestBody = {
        connectorEntityId: entityId,
        key: keyValue.trim(),
        label: label.trim(),
        description: description.trim() || undefined,
        filter: nextFilter,
        fieldMappingIds: selectedFieldMappingIds,
      };
      const result = validateWithSchema(
        CuratedViewCreateRequestBodySchema,
        body
      );
      if (!result.success) {
        setErrors(result.errors);
        requestAnimationFrame(() => focusFirstInvalidField());
        return;
      }
      createMut.mutate(body, {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.curatedViews.root,
          });
          onSaved();
        },
      });
      return;
    }

    const body: CuratedViewUpdateRequestBody = {
      label: label.trim(),
      description: description.trim() || null,
      filter: nextFilter,
      fieldMappingIds: selectedFieldMappingIds,
    };
    const result = validateWithSchema(CuratedViewUpdateRequestBodySchema, body);
    if (!result.success) {
      setErrors(result.errors);
      requestAnimationFrame(() => focusFirstInvalidField());
      return;
    }
    updateMut?.mutate(body, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.curatedViews.root,
        });
        onSaved();
      },
    });
  };

  return (
    <CuratedViewEditorUI
      mode={mode}
      onClose={onClose}
      showEntitySelect={showEntitySelect}
      entityOptions={entityOptions}
      selectedEntityId={selectedEntityId}
      onEntityChange={setSelectedEntityId}
      fieldMappingOptions={fieldMappingOptions}
      columnDefinitions={columnDefinitions}
      label={label}
      onLabelChange={setLabel}
      keyValue={keyValue}
      onKeyChange={setKeyValue}
      description={description}
      onDescriptionChange={setDescription}
      selectedFieldMappingIds={selectedFieldMappingIds}
      onSelectedFieldMappingIdsChange={setSelectedFieldMappingIds}
      filter={filter}
      onFilterChange={setFilter}
      errors={errors}
      touched={touched}
      onLabelBlur={() => setTouched((p) => ({ ...p, label: true }))}
      onKeyBlur={() => setTouched((p) => ({ ...p, key: true }))}
      onSubmit={handleSubmit}
      isPending={isPending}
      serverError={serverError}
      columnsReady={columnsReady}
    />
  );
};
