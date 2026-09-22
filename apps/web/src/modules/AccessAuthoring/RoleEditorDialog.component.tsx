import React, { useState } from "react";

import TextField from "@mui/material/TextField";
import { useQueryClient } from "@tanstack/react-query";

import { Button, Modal, Stack, MultiSearchableSelect } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import type { RoleView } from "@portalai/core/contracts";

import { sdk } from "../../api/sdk";
import { queryKeys } from "../../api/keys";
import { useToast } from "../../utils/toast.context";
import { FormAlert } from "../../components/FormAlert.component";
import { toServerError, type ServerError } from "../../utils/api.util";

// ── UI (pure) ────────────────────────────────────────────────────────────

export interface RoleEditorDialogUIProps {
  open: boolean;
  onClose: () => void;
  role: RoleView | null;
  name: string;
  onNameChange: (name: string) => void;
  policyIds: string[];
  onPolicyIdsChange: (ids: string[]) => void;
  policyOptions: SelectOption[];
  onSubmit: () => void;
  isPending?: boolean;
  serverError: ServerError | null;
}

export const RoleEditorDialogUI: React.FC<RoleEditorDialogUIProps> = ({
  open,
  onClose,
  role,
  name,
  onNameChange,
  policyIds,
  onPolicyIdsChange,
  policyOptions,
  onSubmit,
  isPending = false,
  serverError,
}) => {
  const readOnly = role?.kind === "system";
  const title = role
    ? readOnly
      ? `Role “${role.name}” (system)`
      : `Edit “${role.name}”`
    : "New role";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          component: "form",
          onSubmit: (e: React.FormEvent) => {
            e.preventDefault();
            if (!readOnly) onSubmit();
          },
        } as object,
      }}
      actions={
        <Stack direction="row" spacing={1}>
          <Button type="button" variant="outlined" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button
              type="button"
              variant="contained"
              onClick={onSubmit}
              disabled={isPending || !name.trim()}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </Stack>
      }
    >
      <Stack spacing={2.5} sx={{ pt: 1 }}>
        <TextField
          label="Name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          required
          disabled={readOnly}
          fullWidth
          autoFocus
        />
        <MultiSearchableSelect
          label="Policies"
          placeholder="Bundle policies into this role…"
          options={policyOptions}
          value={policyIds}
          onChange={onPolicyIdsChange}
          disabled={readOnly}
          fullWidth
        />
        <FormAlert serverError={serverError} />
      </Stack>
    </Modal>
  );
};

// ── Container ────────────────────────────────────────────────────────────

export interface RoleEditorDialogProps {
  open: boolean;
  onClose: () => void;
  role: RoleView | null;
}

export const RoleEditorDialog: React.FC<RoleEditorDialogProps> = ({
  open,
  onClose,
  role,
}) => {
  const [name, setName] = useState(role?.name ?? "");
  const [policyIds, setPolicyIds] = useState<string[]>(role?.policyIds ?? []);
  const policiesQuery = sdk.policies.list({ enabled: open });
  const create = sdk.roles.create();
  const update = sdk.roles.update(role?.id ?? "");
  const toast = useToast();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (open) {
      setName(role?.name ?? "");
      setPolicyIds(role?.policyIds ?? []);
    }
  }, [open, role]);

  const policyOptions: SelectOption[] = (
    policiesQuery.data?.policies ?? []
  ).map((p) => ({ value: p.id, label: `${p.name} (${p.kind})` }));

  const mutation = role ? update : create;

  const handleSubmit = () => {
    mutation.mutate(
      { name: name.trim(), policyIds },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.roles.root });
          toast.success(role ? "Role updated" : "Role created");
          onClose();
        },
      }
    );
  };

  return (
    <RoleEditorDialogUI
      open={open}
      onClose={onClose}
      role={role}
      name={name}
      onNameChange={setName}
      policyIds={policyIds}
      onPolicyIdsChange={setPolicyIds}
      policyOptions={policyOptions}
      onSubmit={handleSubmit}
      isPending={mutation.isPending}
      serverError={toServerError(mutation.error)}
    />
  );
};
