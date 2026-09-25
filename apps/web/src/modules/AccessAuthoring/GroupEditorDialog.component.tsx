import React, { useState } from "react";

import TextField from "@mui/material/TextField";
import { useQueryClient } from "@tanstack/react-query";

import {
  Button,
  Modal,
  Stack,
  Typography,
  MultiSearchableSelect,
} from "@portalai/core/ui";
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
  /** Editing: the group's current members are still loading — Save is blocked
   *  so a submit can't diff [] against the real set and wipe it (#637). */
  membersLoading?: boolean;
  /** Editing: the members read failed — a save will leave membership unchanged. */
  membersError?: boolean;
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
  membersLoading = false,
  membersError = false,
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
          disabled={isPending || !name.trim() || membersLoading}
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
        placeholder={membersLoading ? "Loading members…" : "Add members…"}
        options={memberOptions}
        value={memberIds}
        onChange={onMemberIdsChange}
        disabled={membersLoading}
        fullWidth
      />
      {membersError && (
        <Typography variant="caption" color="error">
          Couldn’t load the current members — saving will leave membership
          unchanged.
        </Typography>
      )}
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
  // The group's current members (#637) — fetched only when editing (never for a
  // new group), so the group list stays lean at hundreds-of-users scale.
  const groupMembersQuery = sdk.groups.members(group?.id ?? "", {
    enabled: open && !!group,
  });
  const create = sdk.groups.create();
  const update = sdk.groups.update(group?.id ?? "");
  const setMembers = sdk.groups.setMembers();
  const toast = useToast();
  const queryClient = useQueryClient();
  // Seed the Members field from the fetched membership once per open, so a later
  // user edit isn't clobbered when the query resolves.
  const membersSeededRef = React.useRef(false);

  React.useEffect(() => {
    if (open) {
      setName(group?.name ?? "");
      setDescription(group?.description ?? "");
      setPolicyIds(group?.policyIds ?? []);
      setMemberIds([]);
      membersSeededRef.current = false;
    }
  }, [open, group]);

  React.useEffect(() => {
    if (open && group && !membersSeededRef.current && groupMembersQuery.data) {
      setMemberIds(groupMembersQuery.data.userIds);
      membersSeededRef.current = true;
    }
  }, [open, group, groupMembersQuery.data]);

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
          // Only (re)write membership when `memberIds` is authoritative: on create
          // always; on edit only after the roster has actually seeded (#637). If a
          // save somehow reaches here before the seed (Save is disabled during
          // load, but this is the safety net), skip it — else setGroupMembers would
          // diff the initial [] against the real members and wipe them. Skipping
          // leaves membership untouched; the name/policy update still lands.
          if (!group || membersSeededRef.current) {
            setMembers
              .mutateAsync({ id: data.group.id, userIds: memberIds })
              .then(invalidate)
              .catch(() => invalidate());
          } else {
            invalidate();
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
      membersLoading={!!group && groupMembersQuery.isLoading}
      membersError={!!group && groupMembersQuery.isError}
      serverError={toServerError(upsert.error)}
    />
  );
};
