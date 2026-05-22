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

import { sdk, queryKeys } from "../../api/sdk";
import { toServerError, type ServerError } from "../../utils/api.util";
import type { FormErrors } from "../../utils/form-validation.util";
import type { ConnectorWorkflowProps } from "../../views/Connector.view";

import { BasicsStep } from "./BasicsStep.component";
import { EndpointsStep } from "./EndpointsStep.component";
import type { EndpointDraft } from "./ApiEndpointForm.component";
import { FieldMappingsStep } from "./FieldMappingsStep.component";
import { ReviewStep } from "./ReviewStep.component";
import {
  validateBasics,
  validateEndpointsList,
} from "./utils/rest-api-validation.util";

const STEPS: StepConfig[] = [
  { label: "Basics", description: "Name + base URL" },
  { label: "Endpoints", description: "Add API endpoints" },
  { label: "Field mappings", description: "Configure after commit (phase 1)" },
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
  endpoints: EndpointDraft[];
  onNameChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onEndpointsChange: (next: EndpointDraft[]) => void;
  onBasicsBlur: (field: "name" | "baseUrl") => void;

  basicsErrors: FormErrors;
  basicsTouched: Record<string, boolean>;
  endpointsErrors: FormErrors;
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
  endpoints,
  onNameChange,
  onBaseUrlChange,
  onEndpointsChange,
  onBasicsBlur,
  basicsErrors,
  basicsTouched,
  endpointsErrors,
  serverError,
}) => {
  const isLast = step === STEPS.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect REST API"
      maxWidth="md"
      fullWidth
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
            onNameChange={onNameChange}
            onBaseUrlChange={onBaseUrlChange}
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
          <FieldMappingsStep
            endpoints={endpoints}
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

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [endpoints, setEndpoints] = useState<EndpointDraft[]>([]);
  const [basicsTouched, setBasicsTouched] = useState<Record<string, boolean>>(
    {}
  );
  const [serverError, setServerError] = useState<ServerError | null>(null);

  const basicsErrors = useMemo(
    () => validateBasics({ name, baseUrl }),
    [name, baseUrl]
  );
  const endpointsErrors = useMemo(
    () => validateEndpointsList(endpoints),
    [endpoints]
  );

  const canAdvance = useMemo(() => {
    if (step === 0) return Object.keys(basicsErrors).length === 0;
    if (step === 1) return Object.keys(endpointsErrors).length === 0;
    return true;
  }, [step, basicsErrors, endpointsErrors]);

  const createInstance = sdk.connectorInstances.create();

  const [isCommitting, setIsCommitting] = useState(false);

  const onCommit = async () => {
    setServerError(null);
    setIsCommitting(true);
    try {
      const created = await createInstance.mutateAsync({
        organizationId,
        connectorDefinitionId,
        name,
        status: "active",
        config: { baseUrl, auth: { mode: "none" } },
      } as never);
      // sdk.connectorInstances.create returns
      // `{ connectorInstance: { id, ... } }`.
      const instanceId = (created as { connectorInstance: { id: string } })
        .connectorInstance.id;

      // Per-endpoint POST. We can't reuse `createEndpointInstance`'s URL
      // because it was bound to the placeholder; instead we re-use the
      // mutateAsync over a fresh hook scoped to the actual id. Easier
      // path: imperatively fire fetchWithAuth — but the sdk hook needs
      // a stable instanceId so we just re-mount the workflow's commit
      // logic with a tiny imperative call here.
      for (const ep of endpoints) {
        const url = `/api/connector-instances/${encodeURIComponent(
          instanceId
        )}/api-endpoints`;
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: ep.key,
            label: ep.label,
            config: {
              path: ep.path,
              method: ep.method,
              recordsPath: ep.recordsPath,
              idField: ep.idField || null,
            },
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw {
            status: res.status,
            code: body.code ?? "REST_API_OPERATION_FAILED",
            message:
              body.message ?? `Failed to create endpoint "${ep.key}"`,
          };
        }
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
      onClose();
    } catch (err) {
      setServerError(toServerError(err as never));
    } finally {
      setIsCommitting(false);
    }
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
      endpoints={endpoints}
      onNameChange={setName}
      onBaseUrlChange={setBaseUrl}
      onEndpointsChange={setEndpoints}
      onBasicsBlur={(field) =>
        setBasicsTouched((t) => ({ ...t, [field]: true }))
      }
      basicsErrors={basicsErrors}
      basicsTouched={basicsTouched}
      endpointsErrors={endpointsErrors}
      serverError={serverError}
    />
  );
};
