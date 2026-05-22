/**
 * Step 2 — Endpoints. Renders the current list + an "Add endpoint"
 * button that opens `ApiEndpointForm` in a modal. Phase 4 will
 * decorate each row with a probe-driven column-preview chip.
 */

import React, { useState } from "react";

import { Button, IconButton, Stack, Typography } from "@portalai/core/ui";
import type { IconName } from "@portalai/core/ui";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";
import {
  ApiEndpointForm,
  type EndpointDraft,
} from "./ApiEndpointForm.component";

// ── Pure UI ──────────────────────────────────────────────────────────

export interface EndpointsStepUIProps {
  endpoints: EndpointDraft[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  errors: FormErrors;
  serverError: ServerError | null;
}

export const EndpointsStepUI: React.FC<EndpointsStepUIProps> = ({
  endpoints,
  onAdd,
  onEdit,
  onRemove,
  errors,
  serverError,
}) => (
  <Stack spacing={2}>
    <FormAlert serverError={serverError} />
    {errors.endpoints ? (
      <Typography variant="body2" color="error">
        {errors.endpoints}
      </Typography>
    ) : null}

    {endpoints.length === 0 ? (
      <Typography variant="body2" color="text.secondary">
        No endpoints yet. Add one to continue.
      </Typography>
    ) : (
      <Stack spacing={1}>
        {endpoints.map((ep, i) => (
          <Stack
            key={`${ep.key}-${i}`}
            direction="row"
            alignItems="center"
            spacing={1}
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              p: 1,
            }}
          >
            <Stack flexGrow={1}>
              <Typography variant="body1">{ep.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {ep.method} {ep.path}
                {ep.recordsPath ? ` → ${ep.recordsPath}` : ""}
              </Typography>
            </Stack>
            <Button
              type="button"
              size="small"
              variant="outlined"
              onClick={() => onEdit(i)}
              aria-label={`Edit endpoint ${ep.key}`}
            >
              Edit
            </Button>
            <IconButton
              type="button"
              size="small"
              icon={"close" as IconName}
              onClick={() => onRemove(i)}
              aria-label={`Remove endpoint ${ep.key}`}
            />

          </Stack>
        ))}
      </Stack>
    )}

    <Button type="button" variant="outlined" onClick={onAdd}>
      Add endpoint
    </Button>
  </Stack>
);

// ── Container ────────────────────────────────────────────────────────

export interface EndpointsStepProps {
  endpoints: EndpointDraft[];
  onChange: (endpoints: EndpointDraft[]) => void;
  errors: FormErrors;
  serverError: ServerError | null;
}

export const EndpointsStep: React.FC<EndpointsStepProps> = ({
  endpoints,
  onChange,
  errors,
  serverError,
}) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const onAdd = () => {
    setEditingIndex(null);
    setFormOpen(true);
  };
  const onEdit = (index: number) => {
    setEditingIndex(index);
    setFormOpen(true);
  };
  const onRemove = (index: number) => {
    onChange(endpoints.filter((_, i) => i !== index));
  };
  const onSubmitDraft = (draft: EndpointDraft) => {
    if (editingIndex !== null) {
      const next = [...endpoints];
      next[editingIndex] = draft;
      onChange(next);
    } else {
      onChange([...endpoints, draft]);
    }
    setFormOpen(false);
    setEditingIndex(null);
  };

  return (
    <>
      <EndpointsStepUI
        endpoints={endpoints}
        onAdd={onAdd}
        onEdit={onEdit}
        onRemove={onRemove}
        errors={errors}
        serverError={serverError}
      />
      <ApiEndpointForm
        open={formOpen}
        initial={
          editingIndex !== null ? endpoints[editingIndex] : undefined
        }
        onSubmit={onSubmitDraft}
        onClose={() => {
          setFormOpen(false);
          setEditingIndex(null);
        }}
      />
    </>
  );
};
