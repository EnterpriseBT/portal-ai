import React, { useState } from "react";

import TextField from "@mui/material/TextField";
import { useQueryClient } from "@tanstack/react-query";

import { Button, Modal, Stack, MultiSearchableSelect } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import type { GroupView } from "@portalai/core/contracts";

import { sdk } from "../../api/sdk";
import { queryKeys } from "../../api/keys";
import { useToast } from "../../utils/toast.context";
import { FormAlert } from "../../components/FormAlert.component";
import { toServerError, type ServerError } from "../../utils/api.util";

// ── UI (pure) ────────────────────────────────────────────────────────────

export interface GroupEditorDialogUIProps {
  open: boolean;
  onClose: () => void;
  group: GroupView | null;
  name: string;
  onNameChange: (name: string) => void;
  description: string;
  onDescriptionChange: (description: string) => void;
  policyIds: string[];
  onPolicyIdsChange: (ids: string[]) => void;
  policyOptions: SelectOption[];
  memberIds: string[];
  onMemberIdsChange: (ids: string[]) => void;
  memberOptions: SelectOption[];
  onSubmit: () => void;
  isPending?: boolean;
  serverError: ServerError | null;
}

export const GroupEditorDialogUI: React.FC<GroupEditorDialogUIProps> = ({
  open,
  onClose,
  group,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  policyIds,
  onPolicyIdsChange,
  policyOptions,
  memberIds,
  onMemberIdsChange,
  memberOptions,
  onSubmit,
  isPending = false,
  serverError,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title={group ? `Edit “${group.name}”` : "New group"}
    maxWidth="sm"
    fullWidth
    slotProps={{
      paper: {
        component: "form",
        onSubmit: (e: React.FormEvent) => {
          e.preventDefault();
          onSubmit();
        },
      } as object,
    }}
    actions={
      <Stack direction="row" spacing={1}>
        <Button type="button" variant="outlined" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="contained"
          onClick={onSubmit}
          disabled={isPending || !name.trim()}
        >
          {isPending ? "Saving…" : "Save"}
        </Button>
      </Stack>
    }
  >
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      <TextField
        label="Name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        required
        fullWidth
        autoFocus
      />
      <TextField
        label="Description"
        value={description}
        onChange={(e) => onDescriptionChange(e.target.value)}
        fullWidth
      />
      <MultiSearchableSelect
        label="Policies"
        placeholder="Bundle policies into this group…"
        options={policyOptions}
        value={policyIds}
        onChange={onPolicyIdsChange}
        fullWidth
      />
      <MultiSearchableSelect
        label="Members"
        placeholder="Add members…"
        options={memberOptions}
        value={memberIds}
        onChange={onMemberIdsChange}
        fullWidth
      />
      <FormAlert serverError={serverError} />
    </Stack>
  </Modal>
);

// ── Container ────────────────────────────────────────────────────────────

export interface GroupEditorDialogProps {
  open: boolean;
  onClose: () => void;
  group: GroupView | null;
}

export const GroupEditorDialog: React.FC<GroupEditorDialogProps> = ({
  open,
  onClose,
  group,
}) => {
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [policyIds, setPolicyIds] = useState<string[]>(group?.policyIds ?? []);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const policiesQuery = sdk.policies.list({ enabled: open });
  const membersQuery = sdk.members.list({ enabled: open });
  const create = sdk.groups.create();
  const update = sdk.groups.update(group?.id ?? "");
  const setMembers = sdk.groups.setMembers();
  const toast = useToast();
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setDescription(group?.description ?? "");
      setPolicyIds(group?.policyIds ?? []);
      setMemberIds([]);
    }
  }, [open, group]);

  const policyOptions: SelectOption[] = (
    policiesQuery.data?.policies ?? []
  ).map((p) => ({ value: p.id, label: `${p.name} (${p.kind})` }));
  const memberOptions: SelectOption[] = (membersQuery.data?.members ?? []).map(
    (m) => ({ value: m.userId, label: m.email ?? m.name ?? m.userId })
  );

  const upsert = group ? update : create;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.groups.root });
    toast.success(group ? "Group updated" : "Group created");
    onClose();
  };

  const handleSubmit = () => {
    upsert.mutate(
      { name: name.trim(), description: description || null, policyIds },
      {
        onSuccess: (data) => {
          // Membership is a second, group-centric call — targets the returned
          // id (fresh on create, existing on edit). On edit we don't re-drive
          // membership from this dialog (kept simple), so only set on create.
          if (group) {
            invalidate();
          } else {
            setMembers
              .mutateAsync({ id: data.group.id, userIds: memberIds })
              .then(invalidate)
              .catch(() => invalidate());
          }
        },
      }
    );
  };

  return (
    <GroupEditorDialogUI
      open={open}
      onClose={onClose}
      group={group}
      name={name}
      onNameChange={setName}
      description={description}
      onDescriptionChange={setDescription}
      policyIds={policyIds}
      onPolicyIdsChange={setPolicyIds}
      policyOptions={policyOptions}
      memberIds={memberIds}
      onMemberIdsChange={setMemberIds}
      memberOptions={memberOptions}
      onSubmit={handleSubmit}
      isPending={upsert.isPending}
      serverError={toServerError(upsert.error)}
    />
  );
};
