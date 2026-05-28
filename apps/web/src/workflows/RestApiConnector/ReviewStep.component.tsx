/**
 * Step 4 — Review + commit. Lists what's about to be created and lets
 * the user trigger the final API calls (create instance → POST each
 * endpoint). Commit handling lives in the parent workflow container.
 */

import React from "react";

import { Stack, Typography } from "@portalai/core/ui";

import { FormAlert } from "../../components/FormAlert.component";
import type { ServerError } from "../../utils/api.util";
import type { EndpointDraft } from "./ApiEndpointForm.component";

// ── Pure UI ──────────────────────────────────────────────────────────

export interface ReviewStepUIProps {
  name: string;
  baseUrl: string;
  endpoints: EndpointDraft[];
  serverError: ServerError | null;
}

export const ReviewStepUI: React.FC<ReviewStepUIProps> = ({
  name,
  baseUrl,
  endpoints,
  serverError,
}) => (
  <Stack spacing={2}>
    <FormAlert serverError={serverError} />
    <Stack spacing={1}>
      <Typography variant="subtitle2">Connector</Typography>
      <Typography variant="body2">Name: {name}</Typography>
      <Typography variant="body2">Base URL: {baseUrl}</Typography>
      <Typography variant="body2">Auth: none (phase 1)</Typography>
    </Stack>
    <Stack spacing={1}>
      <Typography variant="subtitle2">
        Endpoints ({endpoints.length})
      </Typography>
      {endpoints.map((ep, i) => (
        <Typography key={i} variant="body2">
          {ep.label} — <code>{ep.method} {ep.path}</code>
          {ep.recordsPath ? <> · records at <code>{ep.recordsPath}</code></> : null}
          {ep.idField ? <> · idField <code>{ep.idField}</code></> : null}
        </Typography>
      ))}
    </Stack>
    <Typography variant="caption" color="text.secondary">
      Clicking Commit creates the connector instance and configures every
      endpoint above. You&rsquo;ll add field mappings + run the first
      sync from each entity&rsquo;s detail view after commit.
    </Typography>
  </Stack>
);

// ── Container ────────────────────────────────────────────────────────

export interface ReviewStepProps extends ReviewStepUIProps {}

export const ReviewStep: React.FC<ReviewStepProps> = (props) => (
  <ReviewStepUI {...props} />
);
