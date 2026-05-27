/**
 * Step 3 — Probe & review columns. Replaces phase-1's
 * `FieldMappingsStep`. One section per configured endpoint, each
 * driving its own `EndpointColumnReview`.
 *
 * In the *create* workflow, endpoints don't have `entityId`s yet, so
 * the probe SDK call can't fire. The step degrades to per-endpoint
 * manual-entry tables (the spec's "fallback to manual" path), and the
 * Re-probe button is rendered disabled with a tooltip pointing at the
 * limitation. The infrastructure (SuggestionChip, DegradationBanner,
 * InferredColumnsTable) is fully populated when an edit-mode workflow
 * (or future detail-view consumer) supplies entityIds + probe results.
 */

import React from "react";

import { Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";
import type { EndpointDraft } from "./ApiEndpointForm.component";
import {
  EndpointColumnReviewUI,
  type EndpointReviewState,
} from "./EndpointColumnReview.component";
import type { ColumnRowDraft } from "./utils/rest-api-validation.util";
import type { SearchResult } from "../../api/types";

// ── Pure UI ──────────────────────────────────────────────────────────

export interface ProbeReviewStepUIProps {
  endpoints: EndpointDraft[];
  /** Per-endpoint review state, keyed by `endpoint.key`. */
  stateByKey: Record<string, EndpointReviewState>;
  /** Per-endpoint column rows (the table contents), keyed by `endpoint.key`. */
  rowsByKey: Record<string, ColumnRowDraft[]>;
  /** Per-endpoint field-level errors, keyed by `endpoint.key`. */
  errorsByKey: Record<string, FormErrors>;
  onRowChange: (
    endpointKey: string,
    index: number,
    patch: Partial<ColumnRowDraft>
  ) => void;
  onAdoptSuggestion: (endpointKey: string, index: number) => void;
  onAddRow: (endpointKey: string) => void;
  onRemoveRow: (endpointKey: string, index: number) => void;
  onReprobe?: (endpointKey: string) => void;
  reprobeDisabled?: boolean;
  reprobeDisabledHint?: string;
  serverError: ServerError | null;
  /** Forwarded into each endpoint's InferredColumnsTableUI. */
  columnDefinitionSearch: SearchResult;
}

export const ProbeReviewStepUI: React.FC<ProbeReviewStepUIProps> = ({
  endpoints,
  stateByKey,
  rowsByKey,
  errorsByKey,
  onRowChange,
  onAdoptSuggestion,
  onAddRow,
  onRemoveRow,
  onReprobe,
  reprobeDisabled,
  reprobeDisabledHint,
  serverError,
  columnDefinitionSearch,
}) => (
  <Stack spacing={2}>
    <FormAlert serverError={serverError} />

    {endpoints.length === 0 ? (
      <Typography variant="body2" color="text.secondary">
        Add at least one endpoint in the previous step to review its columns.
      </Typography>
    ) : null}

    {endpoints.map((ep) => (
      <EndpointColumnReviewUI
        key={ep.key}
        endpointKey={ep.key}
        endpointLabel={ep.label}
        state={stateByKey[ep.key] ?? { kind: "idle" }}
        rows={rowsByKey[ep.key] ?? []}
        errors={errorsByKey[ep.key] ?? {}}
        onChange={(index, patch) => onRowChange(ep.key, index, patch)}
        onAdoptSuggestion={(index) => onAdoptSuggestion(ep.key, index)}
        onAddRow={() => onAddRow(ep.key)}
        onRemoveRow={(index) => onRemoveRow(ep.key, index)}
        onReprobe={onReprobe ? () => onReprobe(ep.key) : undefined}
        reprobeDisabled={reprobeDisabled}
        reprobeDisabledHint={reprobeDisabledHint}
        columnDefinitionSearch={columnDefinitionSearch}
      />
    ))}
  </Stack>
);

// ── Container ────────────────────────────────────────────────────────

export interface ProbeReviewStepProps extends ProbeReviewStepUIProps {}

export const ProbeReviewStep: React.FC<ProbeReviewStepProps> = (props) => (
  <ProbeReviewStepUI {...props} />
);
