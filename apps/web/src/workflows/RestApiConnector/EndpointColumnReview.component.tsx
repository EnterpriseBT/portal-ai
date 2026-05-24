/**
 * Per-endpoint section in `ProbeReviewStep`. Drives the four states:
 *
 *   - **loading** — probe in flight (spinner)
 *   - **success** — degradation banner + InferredColumnsTable
 *   - **error** — probe failed; FormAlert + "Switch to manual" button
 *     that flips the table to an empty manual state
 *   - **empty** — probe returned 0 records; manual-entry affordance
 *
 * The container is intentionally thin: the parent (ProbeReviewStep)
 * owns the per-endpoint column-row state and the probe trigger. This
 * component renders whatever it's handed.
 */

import React from "react";

import { Button, CircularProgress, Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";
import type { ColumnRowDraft } from "./utils/rest-api-validation.util";

import { DegradationBannerUI } from "./DegradationBanner.component";
import { InferredColumnsTableUI } from "./InferredColumnsTable.component";

export type EndpointReviewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | {
      kind: "success";
      degradation: "llm-failed" | "llm-disabled" | null;
      recordsScanned: number;
    }
  | { kind: "empty" }
  | { kind: "error"; serverError: ServerError };

export interface EndpointColumnReviewUIProps {
  endpointKey: string;
  endpointLabel: string;
  state: EndpointReviewState;
  rows: ColumnRowDraft[];
  errors: FormErrors;
  onChange: (index: number, patch: Partial<ColumnRowDraft>) => void;
  onAdoptSuggestion: (index: number) => void;
  onAddRow: () => void;
  onRemoveRow: (index: number) => void;
  onReprobe?: () => void;
  /** Probe-trigger affordance disabled when no entityId is wired in
   *  the create flow. The label still renders so the affordance is
   *  visible; clicking it does nothing. */
  reprobeDisabled?: boolean;
  reprobeDisabledHint?: string;
}

export const EndpointColumnReviewUI: React.FC<EndpointColumnReviewUIProps> = ({
  endpointKey,
  endpointLabel,
  state,
  rows,
  errors,
  onChange,
  onAdoptSuggestion,
  onAddRow,
  onRemoveRow,
  onReprobe,
  reprobeDisabled,
  reprobeDisabledHint,
}) => (
  <Stack
    spacing={1.5}
    sx={{
      border: 1,
      borderColor: "divider",
      borderRadius: 1,
      p: 2,
    }}
    data-testid={`endpoint-review-${endpointKey}`}
  >
    <Stack direction="row" alignItems="center" spacing={1}>
      <Stack flexGrow={1}>
        <Typography variant="subtitle1">{endpointLabel}</Typography>
        <Typography variant="caption" color="text.secondary">
          {endpointKey}
        </Typography>
      </Stack>
      {onReprobe ? (
        <Button
          type="button"
          size="small"
          variant="outlined"
          onClick={onReprobe}
          disabled={reprobeDisabled || state.kind === "loading"}
          aria-label={`Re-probe ${endpointKey}`}
          title={reprobeDisabled ? reprobeDisabledHint : undefined}
        >
          Re-probe
        </Button>
      ) : null}
    </Stack>

    {state.kind === "loading" ? (
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        aria-live="polite"
      >
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          Probing endpoint…
        </Typography>
      </Stack>
    ) : null}

    {state.kind === "success" ? (
      <>
        <DegradationBannerUI degradation={state.degradation} />
        <Typography variant="caption" color="text.secondary">
          Scanned {state.recordsScanned} record
          {state.recordsScanned === 1 ? "" : "s"}.
        </Typography>
        <InferredColumnsTableUI
          rows={rows}
          onChange={onChange}
          onAdoptSuggestion={onAdoptSuggestion}
          onAddRow={onAddRow}
          onRemoveRow={onRemoveRow}
          errors={errors}
        />
      </>
    ) : null}

    {state.kind === "empty" ? (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          Probe returned no records. Add columns manually below.
        </Typography>
        <InferredColumnsTableUI
          rows={rows}
          onChange={onChange}
          onAdoptSuggestion={onAdoptSuggestion}
          onAddRow={onAddRow}
          onRemoveRow={onRemoveRow}
          errors={errors}
        />
      </Stack>
    ) : null}

    {state.kind === "error" ? (
      <Stack spacing={1}>
        <FormAlert serverError={state.serverError} />
        <Typography variant="body2" color="text.secondary">
          The probe didn&rsquo;t complete. You can still configure columns
          manually below.
        </Typography>
        <InferredColumnsTableUI
          rows={rows}
          onChange={onChange}
          onAdoptSuggestion={onAdoptSuggestion}
          onAddRow={onAddRow}
          onRemoveRow={onRemoveRow}
          errors={errors}
        />
      </Stack>
    ) : null}

    {state.kind === "idle" ? (
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          Probe runs after the connector is saved. Add columns manually
          below; the workflow commits the configuration as field mappings.
        </Typography>
        <InferredColumnsTableUI
          rows={rows}
          onChange={onChange}
          onAdoptSuggestion={onAdoptSuggestion}
          onAddRow={onAddRow}
          onRemoveRow={onRemoveRow}
          errors={errors}
        />
      </Stack>
    ) : null}
  </Stack>
);
