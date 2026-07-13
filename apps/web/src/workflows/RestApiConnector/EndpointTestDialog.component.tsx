/**
 * Per-endpoint dry-run dialog rendered from `EndpointsStep` (and any
 * future surface that wants to test a saved endpoint, e.g. the
 * connector-instance detail view).
 *
 * Calls `POST /api/connector-instances/:id/test-connection` via the
 * `sdk.connectorInstances.testConnection` mutation. The response is a
 * `TestConnectionResult` — `ok: true` carries the first 5 records as a
 * preview; `ok: false` carries an error code + message + details for
 * the user to act on (typically "edit the endpoint and try again").
 */

import React, { useEffect, useState } from "react";

import Alert from "@mui/material/Alert";
import {
  Button,
  CircularProgress,
  Modal,
  Stack,
  Typography,
} from "@portalai/core/ui";

import { sdk } from "../../api/sdk";
import type {
  TestConnectionResult,
  TestConnectionRequestBody,
} from "../../api/connector-instances.api";
import { toServerError, type ServerError } from "../../utils/api.util";
import { FormAlert } from "../../components/FormAlert.component";

// ── Pure UI ──────────────────────────────────────────────────────────

export interface EndpointTestDialogUIProps {
  open: boolean;
  endpointLabel: string;
  isPending: boolean;
  result: TestConnectionResult | null;
  serverError: ServerError | null;
  onClose: () => void;
  /**
   * Called when the user clicks "Edit endpoint" on a failure result.
   * The parent typically closes this dialog and re-opens the endpoint
   * form pre-populated with the failing endpoint. Optional — when
   * unset, the link is hidden.
   */
  onEditEndpoint?: () => void;
}

export const EndpointTestDialogUI: React.FC<EndpointTestDialogUIProps> = ({
  open,
  endpointLabel,
  isPending,
  result,
  serverError,
  onClose,
  onEditEndpoint,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title={`Test endpoint — ${endpointLabel}`}
    maxWidth="md"
    fullWidth
    actions={
      <Stack direction="row" spacing={1}>
        <Button type="button" variant="outlined" onClick={onClose}>
          Close
        </Button>
      </Stack>
    }
  >
    <Stack spacing={2}>
      <FormAlert serverError={serverError} />

      {isPending ? (
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          aria-live="polite"
        >
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">
            Calling endpoint…
          </Typography>
        </Stack>
      ) : null}

      {!isPending && result && result.ok ? (
        <Stack spacing={1} data-testid="endpoint-test-success">
          <Alert severity="success">
            Endpoint returned {result.sample.length} record
            {result.sample.length === 1 ? "" : "s"} (showing up to 5).
          </Alert>
          <Typography variant="caption" color="text.secondary">
            Preview
          </Typography>
          <Stack
            component="pre"
            sx={{
              m: 0,
              p: 2,
              fontFamily: "monospace",
              fontSize: 12,
              backgroundColor: "background.default",
              border: 1,
              borderColor: "divider",
              borderRadius: 1,
              maxHeight: 320,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
            aria-label="Sample records"
          >
            {JSON.stringify(result.sample, null, 2)}
          </Stack>
        </Stack>
      ) : null}

      {!isPending && result && !result.ok ? (
        <Stack spacing={1} data-testid="endpoint-test-failure">
          <FormAlert
            serverError={{ code: result.code, message: result.message }}
          />
          {result.details ? (
            <Stack
              component="pre"
              sx={{
                m: 0,
                p: 2,
                fontFamily: "monospace",
                fontSize: 12,
                backgroundColor: "background.default",
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
                maxHeight: 200,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
              aria-label="Failure details"
            >
              {JSON.stringify(result.details, null, 2)}
            </Stack>
          ) : null}
          {onEditEndpoint ? (
            <Button
              type="button"
              variant="text"
              onClick={onEditEndpoint}
              aria-label="Edit endpoint to fix the failure"
            >
              Edit endpoint
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Stack>
  </Modal>
);

// ── Container ────────────────────────────────────────────────────────

export interface EndpointTestDialogProps {
  open: boolean;
  instanceId: string;
  endpointEntityId: string;
  endpointLabel: string;
  onClose: () => void;
  onEditEndpoint?: () => void;
}

export const EndpointTestDialog: React.FC<EndpointTestDialogProps> = ({
  open,
  instanceId,
  endpointEntityId,
  endpointLabel,
  onClose,
  onEditEndpoint,
}) => {
  const { mutateAsync, isPending } =
    sdk.connectorInstances.testConnection(instanceId);
  const [result, setResult] = useState<TestConnectionResult | null>(null);
  const [serverError, setServerError] = useState<ServerError | null>(null);

  // Fire the test on each open. Resets prior state so re-opening for a
  // different endpoint doesn't show stale results.
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setServerError(null);
    const body: TestConnectionRequestBody = { endpointEntityId };
    void mutateAsync(body)
      .then((res) => setResult(res))
      .catch((err) => setServerError(toServerError(err as never)));
    // We intentionally don't include `mutateAsync` in deps — it's a
    // stable mutation handle and including it triggers a re-fire loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, endpointEntityId, instanceId]);

  return (
    <EndpointTestDialogUI
      open={open}
      endpointLabel={endpointLabel}
      isPending={isPending}
      result={result}
      serverError={serverError}
      onClose={onClose}
      onEditEndpoint={onEditEndpoint}
    />
  );
};
