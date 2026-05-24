/**
 * REST API connector — workflow container.
 *
 * Four steps:
 *   1. Basics — name + baseUrl + auth (none-only in phase 1)
 *   2. Endpoints — add one or more endpoint configs
 *   3. Field mappings — phase-1 placeholder (phase 4 replaces this with
 *      the probe-then-review step)
 *   4. Review — summary + commit
 *
 * Commit flow: create connector_instance via sdk.connectorInstances.create,
 * then POST each endpoint via sdk.apiConnector.endpoints.create. Errors
 * surface inline through `<FormAlert>`; user can fix and retry without
 * losing draft state.
 */

import React, { useMemo, useState } from "react";

import {
  Button,
  Modal,
  Stack,
  StepPanel,
  Stepper,
} from "@portalai/core/ui";
import type { StepConfig } from "@portalai/core/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { sdk, queryKeys } from "../../api/sdk";
import { toServerError, type ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";
import type { ConnectorWorkflowProps } from "../../views/Connector.view";

import { BasicsStep } from "./BasicsStep.component";
import { EndpointsStep } from "./EndpointsStep.component";
import type { EndpointDraft } from "./ApiEndpointForm.component";
import { ProbeReviewStep } from "./ProbeReviewStep.component";
import { ReviewStep } from "./ReviewStep.component";
import {
  EMPTY_CREDENTIALS_DRAFT,
  paginationDraftToConfig,
  validateBasics,
  validateColumnRows,
  validateEndpointsList,
  type AuthMode,
  type ColumnRowDraft,
  type CredentialsDraft,
} from "./utils/rest-api-validation.util";

const STEPS: StepConfig[] = [
  { label: "Basics", description: "Name + base URL" },
  { label: "Endpoints", description: "Add API endpoints" },
  { label: "Probe & review", description: "Inspect + configure columns" },
  { label: "Review", description: "Confirm + commit" },
];

// ── Pure UI ──────────────────────────────────────────────────────────

export interface RestApiConnectorWorkflowUIProps {
  open: boolean;
  onClose: () => void;
  step: number;
  onStepChange: (step: number) => void;
  onCommit: () => void;
  isCommitting: boolean;
  canAdvance: boolean;

  name: string;
  baseUrl: string;
  authMode: AuthMode;
  credentials: CredentialsDraft;
  endpoints: EndpointDraft[];
  onNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onAuthModeChange: (mode: AuthMode) => void;
  onCredentialsChange: <K extends keyof CredentialsDraft>(
    field: K,
    value: CredentialsDraft[K]
  ) => void;
  onEndpointsChange: (next: EndpointDraft[]) => void;
  onBasicsBlur: (field: string) => void;

  /** Per-endpoint column rows the user reviewed/edited. */
  columnsByEndpoint: Record<string, ColumnRowDraft[]>;
  onColumnRowChange: (
    endpointKey: string,
    index: number,
    patch: Partial<ColumnRowDraft>
  ) => void;
  onAdoptSuggestion: (endpointKey: string, index: number) => void;
  onAddColumnRow: (endpointKey: string) => void;
  onRemoveColumnRow: (endpointKey: string, index: number) => void;

  basicsErrors: FormErrors;
  basicsTouched: Record<string, boolean>;
  endpointsErrors: FormErrors;
  columnErrorsByEndpoint: Record<string, FormErrors>;
  serverError: ServerError | null;
}

export const RestApiConnectorWorkflowUI: React.FC<
  RestApiConnectorWorkflowUIProps
> = ({
  open,
  onClose,
  step,
  onStepChange,
  onCommit,
  isCommitting,
  canAdvance,
  name,
  baseUrl,
  authMode,
  credentials,
  endpoints,
  onNameChange,
  onBaseUrlChange,
  onAuthModeChange,
  onCredentialsChange,
  onEndpointsChange,
  onBasicsBlur,
  columnsByEndpoint,
  onColumnRowChange,
  onAdoptSuggestion,
  onAddColumnRow,
  onRemoveColumnRow,
  basicsErrors,
  basicsTouched,
  endpointsErrors,
  columnErrorsByEndpoint,
  serverError,
}) => {
  const isLast = step === STEPS.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect REST API"
      defaultMaximized
      maximizable
      actions={
        <Stack direction="row" spacing={1}>
          <Button
            type="button"
            variant="outlined"
            onClick={onClose}
            disabled={isCommitting}
          >
            Cancel
          </Button>
          {step > 0 ? (
            <Button
              type="button"
              variant="outlined"
              onClick={() => onStepChange(step - 1)}
              disabled={isCommitting}
            >
              Back
            </Button>
          ) : null}
          {isLast ? (
            <Button
              type="button"
              variant="contained"
              onClick={onCommit}
              disabled={!canAdvance || isCommitting}
            >
              {isCommitting ? "Committing…" : "Commit"}
            </Button>
          ) : (
            <Button
              type="button"
              variant="contained"
              onClick={() => onStepChange(step + 1)}
              disabled={!canAdvance}
            >
              Next
            </Button>
          )}
        </Stack>
      }
    >
      <Stack spacing={3}>
        <Stepper steps={STEPS} activeStep={step} alternativeLabel>
          <StepPanel index={0} activeStep={step}>
          <BasicsStep
            name={name}
            baseUrl={baseUrl}
            authMode={authMode}
            credentials={credentials}
            onNameChange={onNameChange}
            onBaseUrlChange={onBaseUrlChange}
            onAuthModeChange={onAuthModeChange}
            onCredentialsChange={onCredentialsChange}
            onBlur={onBasicsBlur}
            errors={basicsErrors}
            touched={basicsTouched}
            serverError={serverError}
          />
        </StepPanel>
        <StepPanel index={1} activeStep={step}>
          <EndpointsStep
            endpoints={endpoints}
            onChange={onEndpointsChange}
            errors={endpointsErrors}
            serverError={serverError}
          />
        </StepPanel>
        <StepPanel index={2} activeStep={step}>
          <ProbeReviewStep
            endpoints={endpoints}
            // Create-mode workflow drafts have no entityId — the SDK
            // probe call can't fire. The step shows manual-entry tables
            // per endpoint with the Re-probe button disabled. An
            // edit-mode workflow (or future detail-view consumer) wires
            // real entityIds + probe responses into these props.
            stateByKey={Object.fromEntries(
              endpoints.map((e) => [e.key, { kind: "idle" as const }])
            )}
            rowsByKey={columnsByEndpoint}
            errorsByKey={columnErrorsByEndpoint}
            onRowChange={onColumnRowChange}
            onAdoptSuggestion={onAdoptSuggestion}
            onAddRow={onAddColumnRow}
            onRemoveRow={onRemoveColumnRow}
            reprobeDisabled
            reprobeDisabledHint="Save the connector to enable probing"
            serverError={serverError}
          />
        </StepPanel>
        <StepPanel index={3} activeStep={step}>
          <ReviewStep
            name={name}
            baseUrl={baseUrl}
            endpoints={endpoints}
            serverError={serverError}
          />
        </StepPanel>
        </Stepper>
      </Stack>
    </Modal>
  );
};

// ── Container ────────────────────────────────────────────────────────

export const RestApiConnectorWorkflow: React.FC<ConnectorWorkflowProps> = ({
  open,
  onClose,
  organizationId,
  connectorDefinitionId,
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("none");
  const [credentials, setCredentials] = useState<CredentialsDraft>(
    EMPTY_CREDENTIALS_DRAFT
  );
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>([]);
  const [columnsByEndpoint, setColumnsByEndpoint] = useState<
    Record<string, ColumnRowDraft[]>
  >({});
  const [basicsTouched, setBasicsTouched] = useState<Record<string, boolean>>(
    {}
  );
  const [serverError, setServerError] = useState<ServerError | null>(null);

  const basicsErrors = useMemo(
    () => validateBasics({ name, baseUrl, authMode, credentials }),
    [name, baseUrl, authMode, credentials]
  );
  const endpointsErrors = useMemo(
    () => validateEndpointsList(endpoints),
    [endpoints]
  );
  const columnErrorsByEndpoint = useMemo<Record<string, FormErrors>>(() => {
    const out: Record<string, FormErrors> = {};
    for (const ep of endpoints) {
      out[ep.key] = validateColumnRows(columnsByEndpoint[ep.key] ?? []);
    }
    return out;
  }, [endpoints, columnsByEndpoint]);

  const canAdvance = useMemo(() => {
    if (step === 0) return Object.keys(basicsErrors).length === 0;
    if (step === 1) return Object.keys(endpointsErrors).length === 0;
    if (step === 2) {
      return Object.values(columnErrorsByEndpoint).every(
        (errs) => Object.keys(errs).length === 0
      );
    }
    return true;
  }, [step, basicsErrors, endpointsErrors, columnErrorsByEndpoint]);

  const createInstance = sdk.connectorInstances.create();
  const createEndpoint = sdk.apiConnector.endpoints.createForInstance();

  const [isCommitting, setIsCommitting] = useState(false);

  const onCommit = async () => {
    setServerError(null);
    setIsCommitting(true);
    try {
      const { auth, credentialsPayload } = buildAuthPayload(authMode, credentials);
      const created = await createInstance.mutateAsync({
        organizationId,
        connectorDefinitionId,
        name,
        status: "active",
        config: { baseUrl, auth },
        ...(credentialsPayload ? { credentials: credentialsPayload } : {}),
      } as never);
      // sdk.connectorInstances.create returns
      // `{ connectorInstance: { id, ... } }`.
      const instanceId = (created as { connectorInstance: { id: string } })
        .connectorInstance.id;

      // Per-endpoint POST via the SDK so the Bearer token + standard
      // ApiError handling apply. `createForInstance` takes the
      // instanceId as a mutation variable, which is what we need —
      // the standard `endpoints.create(instanceId)` hook binds the
      // URL at mount time, before we know the id.
      for (const ep of endpoints) {
        await createEndpoint.mutateAsync({
          instanceId,
          body: {
            key: ep.key,
            label: ep.label,
            config: {
              path: ep.path,
              method: ep.method,
              recordsPath: ep.recordsPath,
              idField: ep.idField || null,
              ...(ep.method === "POST" && ep.bodyTemplate
                ? { bodyTemplate: ep.bodyTemplate }
                : {}),
              pagination: paginationDraftToConfig(ep.pagination),
            } as never,
          },
        });
      }

      await queryClient.invalidateQueries({
        queryKey: queryKeys.connectorInstances.root,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.apiEndpoints.root,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.connectorEntities.root,
      });
      // Land the user on the new connector's detail page so they can
      // see what got created (instance + endpoints + draft column
      // mappings). Matches the GoogleSheetsConnector workflow's
      // post-commit handoff.
      navigate({
        to: "/connectors/$connectorInstanceId",
        params: { connectorInstanceId: instanceId },
      });
      onClose();
    } catch (err) {
      setServerError(toServerError(err as never));
    } finally {
      setIsCommitting(false);
    }
  };

  const handleAuthModeChange = (mode: AuthMode) => {
    setAuthMode(mode);
    // Reset the credentials draft on mode switch so a stale bearer
    // token can't leak into the apiKey form on re-toggle. Keeping the
    // placement default in sync with the empty-draft constant.
    setCredentials(EMPTY_CREDENTIALS_DRAFT);
    setBasicsTouched((t) => {
      const next = { ...t };
      for (const field of [
        "keyName",
        "placement",
        "value",
        "token",
        "username",
        "password",
      ]) {
        delete next[field];
      }
      return next;
    });
  };

  const handleCredentialsChange = <K extends keyof CredentialsDraft>(
    field: K,
    value: CredentialsDraft[K]
  ) => {
    setCredentials((c) => ({ ...c, [field]: value }));
  };

  const onColumnRowChange = (
    endpointKey: string,
    index: number,
    patch: Partial<ColumnRowDraft>
  ) => {
    setColumnsByEndpoint((m) => {
      const current = m[endpointKey] ?? [];
      const next = current.map((row, i) =>
        i === index ? { ...row, ...patch } : row
      );
      return { ...m, [endpointKey]: next };
    });
  };

  const onAdoptSuggestion = (endpointKey: string, index: number) => {
    setColumnsByEndpoint((m) => {
      const current = m[endpointKey] ?? [];
      const row = current[index];
      if (!row?.suggestion) return m;
      const next = current.map((r, i) =>
        i === index
          ? {
              ...r,
              normalizedKey: r.suggestion!.suggestedNormalizedKey,
              type: r.suggestion!.suggestedSemanticType,
              columnDefinitionId: r.suggestion!.columnDefinitionId,
            }
          : r
      );
      return { ...m, [endpointKey]: next };
    });
  };

  const onAddColumnRow = (endpointKey: string) => {
    setColumnsByEndpoint((m) => {
      const current = m[endpointKey] ?? [];
      const next: ColumnRowDraft[] = [
        ...current,
        {
          sourceField: "",
          normalizedKey: "",
          type: "string",
          required: false,
          samples: [],
        },
      ];
      return { ...m, [endpointKey]: next };
    });
  };

  const onRemoveColumnRow = (endpointKey: string, index: number) => {
    setColumnsByEndpoint((m) => {
      const current = m[endpointKey] ?? [];
      return { ...m, [endpointKey]: current.filter((_, i) => i !== index) };
    });
  };

  return (
    <RestApiConnectorWorkflowUI
      open={open}
      onClose={onClose}
      step={step}
      onStepChange={setStep}
      onCommit={onCommit}
      isCommitting={isCommitting}
      canAdvance={canAdvance}
      name={name}
      baseUrl={baseUrl}
      authMode={authMode}
      credentials={credentials}
      endpoints={endpoints}
      onNameChange={setName}
      onBaseUrlChange={setBaseUrl}
      onAuthModeChange={handleAuthModeChange}
      onCredentialsChange={handleCredentialsChange}
      onEndpointsChange={setEndpoints}
      onBasicsBlur={(field) =>
        setBasicsTouched((t) => ({ ...t, [field]: true }))
      }
      columnsByEndpoint={columnsByEndpoint}
      onColumnRowChange={onColumnRowChange}
      onAdoptSuggestion={onAdoptSuggestion}
      onAddColumnRow={onAddColumnRow}
      onRemoveColumnRow={onRemoveColumnRow}
      basicsErrors={basicsErrors}
      basicsTouched={basicsTouched}
      endpointsErrors={endpointsErrors}
      columnErrorsByEndpoint={columnErrorsByEndpoint}
      serverError={serverError}
    />
  );
};

/**
 * Project the flat workflow state into the `(auth, credentials)` pair
 * the create-connector-instance endpoint expects. `none` mode commits
 * `credentials: undefined` (the API stores null); the other three modes
 * carry the secret payload alongside the non-secret auth config.
 */
function buildAuthPayload(
  authMode: AuthMode,
  credentials: CredentialsDraft
): {
  auth: Record<string, unknown>;
  credentialsPayload: Record<string, unknown> | null;
} {
  switch (authMode) {
    case "none":
      return { auth: { mode: "none" }, credentialsPayload: null };
    case "apiKey":
      return {
        auth: {
          mode: "apiKey",
          keyName: credentials.keyName,
          placement: credentials.placement,
        },
        credentialsPayload: {
          mode: "apiKey",
          value: credentials.apiKeyValue,
        },
      };
    case "bearer":
      return {
        auth: { mode: "bearer" },
        credentialsPayload: {
          mode: "bearer",
          token: credentials.bearerToken,
        },
      };
    case "basic":
      return {
        auth: { mode: "basic" },
        credentialsPayload: {
          mode: "basic",
          username: credentials.basicUsername,
          password: credentials.basicPassword,
        },
      };
  }
}
