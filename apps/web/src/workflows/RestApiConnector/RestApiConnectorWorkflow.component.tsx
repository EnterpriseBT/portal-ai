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

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  Button,
  Modal,
  Stack,
  StepPanel,
  Stepper,
} from "@portalai/core/ui";
import type { StepConfig } from "@portalai/core/ui";
import type {
  ApiAuthConfig,
  ApiCredentials,
} from "@portalai/core/models";
import type { DiscoverColumnsResult } from "@portalai/core/contracts";
import { probeInputHash } from "@portalai/core/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { sdk, queryKeys } from "../../api/sdk";
import { toServerError, type ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";
import type { ConnectorWorkflowProps } from "../../views/Connector.view";

import type { EndpointReviewState } from "./EndpointColumnReview.component";

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
  /** Per-endpoint probe state (idle/loading/success/empty/error). */
  probeStateByKey: Record<string, EndpointReviewState>;
  /** Manual re-probe trigger — fires the probe with forceRefresh: true. */
  onReprobe: (endpointKey: string) => void;
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
  probeStateByKey,
  onReprobe,
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
            stateByKey={probeStateByKey}
            rowsByKey={columnsByEndpoint}
            errorsByKey={columnErrorsByEndpoint}
            onRowChange={onColumnRowChange}
            onAdoptSuggestion={onAdoptSuggestion}
            onAddRow={onAddColumnRow}
            onRemoveRow={onRemoveColumnRow}
            onReprobe={onReprobe}
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
  const probeDraft = sdk.apiConnector.endpoints.probeDraft();
  const { mutateAsync: probeDraftMutate } = probeDraft;
  // Initial-sync kick on commit so the user lands on the detail view
  // with records already flowing in, not an empty wide table.
  const syncForInstance = sdk.connectorInstances.syncForInstance();

  const [isCommitting, setIsCommitting] = useState(false);

  // ── Probe state machine (slice 7) ───────────────────────────────────
  //
  // `probeInputHashByKey[ep.key]` is the canonical hash of the inputs
  // that drive a probe right now (recomputed when endpoints / instance
  // config / credentials change). `probeStateByKey[ep.key]` is what
  // was last probed — including the hash it ran with. The auto-fire
  // effect re-probes any endpoint whose state hash drifts from the
  // current target hash.
  //
  // Per-row tracking is keyed by `endpoint.key`; both maps are wiped
  // on workflow close via local state (`useState` resets when the
  // Modal unmounts).

  type ProbeStateEntry =
    | { kind: "idle" }
    | { kind: "loading"; hash: string }
    | { kind: "success"; hash: string; result: DiscoverColumnsResult }
    | { kind: "error"; hash: string; serverError: ServerError };

  const [probeInputHashByKey, setProbeInputHashByKey] = useState<
    Record<string, string>
  >({});
  const [probeStateByKey, setProbeStateByKey] = useState<
    Record<string, ProbeStateEntry>
  >({});

  // Recompute target hashes whenever an input changes. Drops stale
  // results once the user navigates back to step 2 and edits — the
  // step-3 auto-fire effect picks up the difference and re-probes.
  useEffect(() => {
    let cancelled = false;
    const compute = async () => {
      const { auth, credentialsPayload } = buildAuthPayload(authMode, credentials);
      const pairs = await Promise.all(
        endpoints.map(async (ep) => {
          const endpointConfig = projectEndpointForHash(ep);
          const hash = await probeInputHash({
            organizationId,
            baseUrl,
            auth: auth as unknown as ApiAuthConfig,
            credentials: credentialsPayload as unknown as ApiCredentials | null,
            endpoint: endpointConfig as never,
          });
          return [ep.key, hash] as const;
        })
      );
      if (cancelled) return;
      setProbeInputHashByKey(Object.fromEntries(pairs));
    };
    void compute();
    return () => {
      cancelled = true;
    };
  }, [endpoints, organizationId, baseUrl, authMode, credentials]);

  // Keep a ref to the latest mutate function so the auto-fire effect
  // doesn't redirect-loop on render. The mutate identity changes per
  // render but the call shape doesn't.
  const probeMutateRef = useRef(probeDraftMutate);
  probeMutateRef.current = probeDraftMutate;

  const firePending = useRef<Set<string>>(new Set());

  const fireProbe = async (
    endpoint: EndpointDraft,
    targetHash: string,
    forceRefresh: boolean
  ) => {
    // Avoid double-firing the same hash for the same endpoint.
    const fireKey = `${endpoint.key}:${targetHash}:${forceRefresh}`;
    if (firePending.current.has(fireKey)) return;
    firePending.current.add(fireKey);

    setProbeStateByKey((m) => ({
      ...m,
      [endpoint.key]: { kind: "loading", hash: targetHash },
    }));

    const { auth, credentialsPayload } = buildAuthPayload(authMode, credentials);
    try {
      const result = await probeMutateRef.current({
        baseUrl,
        auth: auth as never,
        credentials: credentialsPayload as never,
        endpoint: projectEndpointForHash(endpoint) as never,
        forceRefresh,
      } as never);
      setProbeStateByKey((m) => ({
        ...m,
        [endpoint.key]: { kind: "success", hash: targetHash, result },
      }));
      hydrateColumnRowsFromProbe(endpoint.key, result.columns);
    } catch (err) {
      const serverError =
        toServerError(err as never) ??
        ({ code: "REST_API_OPERATION_FAILED", message: "Probe failed" } as ServerError);
      setProbeStateByKey((m) => ({
        ...m,
        [endpoint.key]: {
          kind: "error",
          hash: targetHash,
          serverError,
        },
      }));
    } finally {
      firePending.current.delete(fireKey);
    }
  };

  // Auto-fire on step-2 (probe-review) entry + on hash divergence.
  useEffect(() => {
    if (step !== 2) return;
    for (const ep of endpoints) {
      const targetHash = probeInputHashByKey[ep.key];
      if (!targetHash) continue;
      const current = probeStateByKey[ep.key];
      if (current && current.kind !== "idle" && current.hash === targetHash) {
        continue; // already loading / succeeded / errored against this hash
      }
      void fireProbe(ep, targetHash, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, probeInputHashByKey, endpoints]);

  const onReprobe = (endpointKey: string) => {
    const ep = endpoints.find((e) => e.key === endpointKey);
    if (!ep) return;
    const targetHash = probeInputHashByKey[endpointKey];
    if (!targetHash) return;
    void fireProbe(ep, targetHash, true);
  };

  /**
   * Map raw probe results into ColumnRowDraft rows for the inferred
   * columns table. Overwrites any existing rows for the endpoint — the
   * probe is authoritative when it returns columns. Empty results
   * leave the table empty so the user can add rows manually.
   */
  const hydrateColumnRowsFromProbe = (
    endpointKey: string,
    columns: DiscoverColumnsResult["columns"]
  ) => {
    setColumnsByEndpoint((m) => ({
      ...m,
      [endpointKey]: columns.map((c) => ({
        sourceField: c.sourceField,
        normalizedKey: c.suggestion?.suggestedNormalizedKey ?? c.key,
        type: c.suggestion?.suggestedSemanticType ?? c.type,
        required: c.required,
        samples: c.samples,
        columnDefinitionId: c.suggestion?.columnDefinitionId ?? null,
        ...(c.suggestion ? { suggestion: c.suggestion } : {}),
      })),
    }));
  };

  // Map ProbeStateEntry → EndpointReviewState (the shape ProbeReviewStep expects).
  const reviewStateByKey = useMemo<Record<string, EndpointReviewState>>(() => {
    const out: Record<string, EndpointReviewState> = {};
    for (const ep of endpoints) {
      const entry = probeStateByKey[ep.key];
      if (!entry || entry.kind === "idle") {
        out[ep.key] = { kind: "idle" };
        continue;
      }
      if (entry.kind === "loading") {
        out[ep.key] = { kind: "loading" };
        continue;
      }
      if (entry.kind === "error") {
        out[ep.key] = { kind: "error", serverError: entry.serverError };
        continue;
      }
      // success
      if (entry.result.recordsScanned === 0 && !entry.result.transformError) {
        out[ep.key] = { kind: "empty" };
        continue;
      }
      out[ep.key] = {
        kind: "success",
        degradation: entry.result.degradation,
        recordsScanned: entry.result.recordsScanned,
        transformError: entry.result.transformError ?? null,
      };
    }
    return out;
  }, [endpoints, probeStateByKey]);

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
        const rows = columnsByEndpoint[ep.key] ?? [];
        await createEndpoint.mutateAsync({
          instanceId,
          body: {
            key: ep.key,
            label: ep.label,
            config: {
              path: ep.path,
              method: ep.method,
              recordsPath: ep.recordsPath,
              ...(ep.transform && ep.transform.trim().length > 0
                ? { transform: ep.transform }
                : {}),
              idField: ep.idField || null,
              ...(ep.method === "POST" && ep.bodyTemplate
                ? { bodyTemplate: ep.bodyTemplate }
                : {}),
              pagination: paginationDraftToConfig(ep.pagination),
            } as never,
            // Materialize the workflow's per-endpoint column drafts as
            // column_definitions + field_mappings server-side, in the
            // same route handler that creates the endpoint. Drops the
            // sourceField default to normalizedKey when the user added
            // a manual row that didn't carry a sourceField.
            ...(rows.length > 0
              ? {
                  columns: rows.map((row) => ({
                    sourceField:
                      row.sourceField.trim() || row.normalizedKey,
                    normalizedKey: row.normalizedKey,
                    type: row.type,
                    required: row.required,
                    columnDefinitionId: row.columnDefinitionId ?? null,
                  })),
                }
              : {}),
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
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fieldMappings.root,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.columnDefinitions.root,
      });

      // Kick an initial sync so the user doesn't land on an empty
      // detail view. Fire-and-tolerate-failure — the connector +
      // endpoints are already persisted by this point, so a sync
      // failure (e.g. upstream API unreachable) is not a commit
      // failure. The detail view's running-jobs alert will pick the
      // job up from here.
      try {
        await syncForInstance.mutateAsync({ instanceId });
      } catch {
        // Non-blocking — the connector + endpoints are committed.
        // User can re-trigger from the detail view.
      }

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
      probeStateByKey={reviewStateByKey}
      onReprobe={onReprobe}
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
 * Project an EndpointDraft into the ApiEndpointConfig shape the
 * probe-hash + probe-draft route accept. The form keeps a flat draft
 * with separate per-pagination-strategy fields; this helper assembles
 * the discriminated `PaginationConfig` and drops mutually-exclusive
 * fields the route doesn't need (e.g. an empty bodyTemplate on GET).
 *
 * Transform is forward-compat — slice 8 wires the editor; slice 7
 * just passes through whatever the draft carries.
 */
function projectEndpointForHash(ep: EndpointDraft): Record<string, unknown> {
  return {
    path: ep.path,
    method: ep.method,
    recordsPath: ep.recordsPath,
    ...(ep.transform ? { transform: ep.transform } : {}),
    idField: ep.idField || null,
    ...(ep.method === "POST" && ep.bodyTemplate
      ? { bodyTemplate: ep.bodyTemplate }
      : {}),
    pagination: paginationDraftToConfig(ep.pagination),
  };
}

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
