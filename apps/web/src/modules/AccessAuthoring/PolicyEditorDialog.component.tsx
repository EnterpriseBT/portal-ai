import React, { useState } from "react";

import TextField from "@mui/material/TextField";
import { useQueryClient } from "@tanstack/react-query";

import { Button, Modal, Stack } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import type {
  PolicyView,
  PolicyStatementInput,
} from "@portalai/core/contracts";

import { sdk } from "../../api/sdk";
import { queryKeys } from "../../api/keys";
import { useRbacObjectSearch } from "../../api/rbac-objects.api";
import { useToast } from "../../utils/toast.context";
import { FormAlert } from "../../components/FormAlert.component";
import { toServerError, type ServerError } from "../../utils/api.util";
import { StatementEditorUI } from "./StatementEditor.component";

// ── UI (pure) ────────────────────────────────────────────────────────────

export interface PolicyEditorDialogUIProps {
  open: boolean;
  onClose: () => void;
  /** The policy being edited, or null when creating. System policies render
   *  read-only (no save). */
  policy: PolicyView | null;
  name: string;
  onNameChange: (name: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  onStatementsChange: (statements: PolicyStatementInput[]) => void;
  onSearch: (resourceType: string, query: string) => Promise<SelectOption[]>;
  onSubmit: () => void;
  isPending?: boolean;
  serverError: ServerError | null;
}

export const PolicyEditorDialogUI: React.FC<PolicyEditorDialogUIProps> = ({
  open,
  onClose,
  policy,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  onStatementsChange,
  onSearch,
  onSubmit,
  isPending = false,
  serverError,
}) => {
  const readOnly = policy?.kind === "system";
  const title = policy
    ? readOnly
      ? `Policy “${policy.name}” (system)`
      : `Edit “${policy.name}”`
    : "New policy";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="md"
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
        <TextField
          label="Description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          disabled={readOnly}
          fullWidth
        />
        <FormAlert serverError={serverError} />
        <StatementEditorUI
          key={policy?.id ?? "new"}
          initialStatements={policy?.statements}
          onChange={onStatementsChange}
          onSearch={onSearch}
        />
      </Stack>
    </Modal>
  );
};

// ── Container ────────────────────────────────────────────────────────────

export interface PolicyEditorDialogProps {
  open: boolean;
  onClose: () => void;
  policy: PolicyView | null;
}

/** Policy create/edit dialog (#622) — wires `sdk.policies` + the object search
 *  and delegates rendering to {@link PolicyEditorDialogUI}. */
export const PolicyEditorDialog: React.FC<PolicyEditorDialogProps> = ({
  open,
  onClose,
  policy,
}) => {
  const [name, setName] = useState(policy?.name ?? "");
  const [description, setDescription] = useState(policy?.description ?? "");
  const [statements, setStatements] = useState<PolicyStatementInput[]>(
    policy?.statements ?? []
  );
  const create = sdk.policies.create();
  const update = sdk.policies.update(policy?.id ?? "");
  const search = useRbacObjectSearch();
  const toast = useToast();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (open) {
      setName(policy?.name ?? "");
      setDescription(policy?.description ?? "");
      setStatements(policy?.statements ?? []);
    }
  }, [open, policy]);

  const mutation = policy ? update : create;

  const handleSubmit = () => {
    mutation.mutate(
      { name: name.trim(), description: description || null, statements },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.policies.root });
          toast.success(policy ? "Policy updated" : "Policy created");
          onClose();
        },
      }
    );
  };

  return (
    <PolicyEditorDialogUI
      open={open}
      onClose={onClose}
      policy={policy}
      name={name}
      onNameChange={setName}
      description={description}
      onDescriptionChange={setDescription}
      onStatementsChange={setStatements}
      onSearch={search}
      onSubmit={handleSubmit}
      isPending={mutation.isPending}
      serverError={toServerError(mutation.error)}
    />
  );
};
