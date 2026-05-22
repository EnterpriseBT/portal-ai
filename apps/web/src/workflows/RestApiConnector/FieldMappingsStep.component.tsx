/**
 * Step 3 — Field mappings.
 *
 * Phase 1 is intentionally minimal: this step tells the user that
 * field mappings are configured per-endpoint after the connector is
 * created, by navigating to the connector entity's detail view. The
 * existing `FieldMappingsTable` module already supports the workflow.
 *
 * Phase 4 will replace this step entirely with the probe-then-review
 * UI that auto-seeds columns from the endpoint sample.
 */

import React from "react";

import { Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import type { EndpointDraft } from "./ApiEndpointForm.component";

// ── Pure UI ──────────────────────────────────────────────────────────

export interface FieldMappingsStepUIProps {
  endpoints: EndpointDraft[];
  serverError: ServerError | null;
}

export const FieldMappingsStepUI: React.FC<FieldMappingsStepUIProps> = ({
  endpoints,
  serverError,
}) => (
  <Stack spacing={2}>
    <FormAlert serverError={serverError} />
    <Typography variant="body1">
      Field mappings are configured per endpoint after the connector is
      created. Go to each entity&rsquo;s detail view to add column
      mappings, then run a sync.
    </Typography>
    <Typography variant="body2" color="text.secondary">
      You&rsquo;ve configured {endpoints.length}{" "}
      {endpoints.length === 1 ? "endpoint" : "endpoints"}. Phase 4 will
      auto-seed columns from a sample request.
    </Typography>
  </Stack>
);

// ── Container ────────────────────────────────────────────────────────

export interface FieldMappingsStepProps extends FieldMappingsStepUIProps {}

export const FieldMappingsStep: React.FC<FieldMappingsStepProps> = (
  props
) => <FieldMappingsStepUI {...props} />;
