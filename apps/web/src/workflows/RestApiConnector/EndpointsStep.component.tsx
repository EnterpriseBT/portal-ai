/**
 * Step 2 — Endpoints. Renders the current list + an "Add endpoint"
 * button that opens `ApiEndpointForm` in a modal. Phase 4 will
 * decorate each row with a probe-driven column-preview chip.
 *
 * Phase 2 (slice 6): each row gains a Test button. The button is
 * functional only when the row has an `entityId` (i.e. the endpoint
 * has been persisted) AND the step is given an `instanceId`. In the
 * create-mode workflow neither is set, so the button shows as disabled
 * with a tooltip explaining the constraint. Edit-mode workflows and
 * the connector-instance detail view can pass the missing context to
 * enable it.
 */

import React, { useState } from "react";

import Tooltip from "@mui/material/Tooltip";
import { Button, IconButton, Stack, Typography } from "@portalai/core/ui";
import type { IconName } from "@portalai/core/ui";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";
import {
  ApiEndpointForm,
  type EndpointDraft,
} from "./ApiEndpointForm.component";
import { EndpointTestDialog } from "./EndpointTestDialog.component";

// ── Endpoint row shape ───────────────────────────────────────────────

/**
 * A row in the endpoints list. The base shape is the user-facing draft
 * (`EndpointDraft`). When the endpoint has been persisted, the row
 * carries the connector_entity row id so the Test button can target it
 * through the test-connection route.
 */
export interface EndpointRow extends EndpointDraft {
  entityId?: string;
}

// ── Pure UI ──────────────────────────────────────────────────────────

export interface EndpointsStepUIProps {
  endpoints: EndpointRow[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onTest: (index: number) => void;
  onRemove: (index: number) => void;
  errors: FormErrors;
  serverError: ServerError | null;
  /**
   * Connector instance ID — required for the Test button to be
   * functional. Undefined in the create-mode workflow; set in
   * edit-mode and on the detail-view consumer.
   */
  instanceId?: string;
}

export const EndpointsStepUI: React.FC<EndpointsStepUIProps> = ({
  endpoints,
  onAdd,
  onEdit,
  onTest,
  onRemove,
  errors,
  serverError,
  instanceId,
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
        {endpoints.map((ep, i) => {
          const canTest = !!instanceId && !!ep.entityId;
          const testButton = (
            <Button
              type="button"
              size="small"
              variant="outlined"
              onClick={() => onTest(i)}
              disabled={!canTest}
              aria-label={`Test endpoint ${ep.key}`}
            >
              Test
            </Button>
          );
          return (
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
              {canTest ? (
                testButton
              ) : (
                <Tooltip title="Save the connector first to test endpoints">
                  <span>{testButton}</span>
                </Tooltip>
              )}
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
          );
        })}
      </Stack>
    )}

    <Button type="button" variant="outlined" onClick={onAdd}>
      Add endpoint
    </Button>
  </Stack>
);

// ── Container ────────────────────────────────────────────────────────

export interface EndpointsStepProps {
  endpoints: EndpointRow[];
  onChange: (endpoints: EndpointRow[]) => void;
  errors: FormErrors;
  serverError: ServerError | null;
  /** When set, the Test button on rows with `entityId` becomes functional. */
  instanceId?: string;
  /**
   * Preview callback the workflow container supplies. Fires the
   * preview-endpoint-page SDK call against the current draft +
   * instance config. Forwarded to ApiEndpointForm so the Preview pane
   * inside the modal can render the raw response.
   */
  onPreview?: (draft: EndpointDraft) => Promise<{
    body: unknown;
    truncated: boolean;
  }>;
  /**
   * Suggest-transform callback. Fires the suggest-transform SDK call
   * against the captured `sampleResponse` + an optional `promptHint`.
   * Forwarded to ApiEndpointForm so the AI-assist affordance inside
   * the modal can populate the transform textarea.
   */
  onSuggest?: (input: {
    promptHint: string | undefined;
    sampleResponse: unknown;
  }) => Promise<{
    expression: string;
    warning: { kind: "validation-failed"; message: string } | null;
  }>;
}

export const EndpointsStep: React.FC<EndpointsStepProps> = ({
  endpoints,
  onChange,
  errors,
  serverError,
  instanceId,
  onPreview,
  onSuggest,
}) => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [testingIndex, setTestingIndex] = useState<number | null>(null);

  const onAdd = () => {
    setEditingIndex(null);
    setFormOpen(true);
  };
  const onEdit = (index: number) => {
    setEditingIndex(index);
    setFormOpen(true);
  };
  const onTest = (index: number) => {
    setTestingIndex(index);
  };
  const onRemove = (index: number) => {
    onChange(endpoints.filter((_, i) => i !== index));
  };
  const onSubmitDraft = (draft: EndpointDraft) => {
    if (editingIndex !== null) {
      const next = [...endpoints];
      // Preserve the existing entityId on edit so the Test button stays
      // functional for persisted endpoints.
      next[editingIndex] = { ...draft, entityId: endpoints[editingIndex].entityId };
      onChange(next);
    } else {
      onChange([...endpoints, draft]);
    }
    setFormOpen(false);
    setEditingIndex(null);
  };

  const testingRow = testingIndex !== null ? endpoints[testingIndex] : null;

  return (
    <>
      <EndpointsStepUI
        endpoints={endpoints}
        onAdd={onAdd}
        onEdit={onEdit}
        onTest={onTest}
        onRemove={onRemove}
        errors={errors}
        serverError={serverError}
        instanceId={instanceId}
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
        onPreview={onPreview}
        onSuggest={onSuggest}
      />
      {testingRow && testingRow.entityId && instanceId ? (
        <EndpointTestDialog
          open={testingIndex !== null}
          instanceId={instanceId}
          endpointEntityId={testingRow.entityId}
          endpointLabel={testingRow.label}
          onClose={() => setTestingIndex(null)}
        />
      ) : null}
    </>
  );
};
