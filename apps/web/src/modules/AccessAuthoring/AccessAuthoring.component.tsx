import React, { useState } from "react";

import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";
import { useQueryClient } from "@tanstack/react-query";

import { Stack, Button, Typography } from "@portalai/core/ui";
import type { PolicyView, RoleView, GroupView } from "@portalai/core/contracts";

import { sdk } from "../../api/sdk";
import { queryKeys } from "../../api/keys";
import { useToast } from "../../utils/toast.context";
import { toServerError } from "../../utils/api.util";
import { PolicyEditorDialog } from "./PolicyEditorDialog.component";
import { RoleEditorDialog } from "./RoleEditorDialog.component";
import { GroupEditorDialog } from "./GroupEditorDialog.component";
import {
  DeleteAccessItemDialogUI,
  type AccessItemKind,
} from "../../components/DeleteAccessItemDialog.component";

type Section = "policies" | "roles" | "groups";

/** Singular of each section for the "New <singular>" button — `slice(0, -1)`
 *  would mangle "policies" → "policie". */
const SECTION_SINGULAR: Record<Section, string> = {
  policies: "policy",
  roles: "role",
  groups: "group",
};

/** "1 policy" / "3 policies" — natural singular/plural, no "(s)" parenthetical. */
const pluralize = (n: number, singular: string, plural: string): string =>
  `${n} ${n === 1 ? singular : plural}`;

interface Row {
  id: string;
  name: string;
  system: boolean;
  detail: string;
}

// ── UI (pure) ────────────────────────────────────────────────────────────

export interface AccessAuthoringUIProps {
  section: Section;
  onSectionChange: (s: Section) => void;
  rows: Row[];
  isLoading: boolean;
  onNew: () => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export const AccessAuthoringUI: React.FC<AccessAuthoringUIProps> = ({
  section,
  onSectionChange,
  rows,
  isLoading,
  onNew,
  onEdit,
  onDelete,
}) => (
  <Stack spacing={2}>
    <Stack
      direction="row"
      justifyContent="space-between"
      alignItems="center"
      flexWrap="wrap"
    >
      <Tabs
        value={section}
        onChange={(_e, v) => onSectionChange(v as Section)}
        aria-label="Access sections"
      >
        <Tab label="Policies" value="policies" />
        <Tab label="Roles" value="roles" />
        <Tab label="Groups" value="groups" />
      </Tabs>
      <Button
        variant="contained"
        size="small"
        startIcon={<AddIcon />}
        onClick={onNew}
      >
        New {SECTION_SINGULAR[section]}
      </Button>
    </Stack>

    {isLoading ? (
      <Typography variant="body2" color="text.secondary">
        Loading…
      </Typography>
    ) : rows.length === 0 ? (
      <Typography variant="body2" color="text.secondary">
        No {section} yet.
      </Typography>
    ) : (
      <List dense data-testid={`access-list-${section}`}>
        {rows.map((row) => (
          <ListItem
            key={row.id}
            secondaryAction={
              <Stack direction="row" spacing={0.5}>
                <Tooltip title={row.system ? "View" : "Edit"}>
                  <IconButton
                    size="small"
                    aria-label={`${row.system ? "view" : "edit"} ${row.name}`}
                    onClick={() => onEdit(row.id)}
                  >
                    {row.system ? (
                      <VisibilityIcon fontSize="small" />
                    ) : (
                      <EditIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
                {!row.system && (
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={`delete ${row.name}`}
                      onClick={() => onDelete(row.id)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            }
          >
            <ListItemText primary={row.name} secondary={row.detail} />
            {row.system && <Chip size="small" label="system" sx={{ mr: 6 }} />}
          </ListItem>
        ))}
      </List>
    )}
  </Stack>
);

// ── Container ────────────────────────────────────────────────────────────

/**
 * The "Access" tab's authoring module (#622) — lists custom + system policies /
 * roles / groups and drives their create/edit/delete dialogs. Context-agnostic:
 * embedded by `Settings.view` behind the capability + entitlement gate.
 */
export const AccessAuthoring: React.FC = () => {
  const [section, setSection] = useState<Section>("policies");
  const [policyEdit, setPolicyEdit] = useState<{
    open: boolean;
    policy: PolicyView | null;
  }>({ open: false, policy: null });
  const [roleEdit, setRoleEdit] = useState<{
    open: boolean;
    role: RoleView | null;
  }>({ open: false, role: null });
  const [groupEdit, setGroupEdit] = useState<{
    open: boolean;
    group: GroupView | null;
  }>({ open: false, group: null });
  // #691: a delete asks first. The target keeps its kind so a section switch
  // while the dialog is open can't retarget it.
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: AccessItemKind;
    id: string;
    name: string;
  } | null>(null);

  const policiesQuery = sdk.policies.list();
  const rolesQuery = sdk.roles.list();
  const groupsQuery = sdk.groups.list();
  const removePolicy = sdk.policies.remove();
  const removeRole = sdk.roles.remove();
  const removeGroup = sdk.groups.remove();
  const toast = useToast();
  const queryClient = useQueryClient();

  const policies = policiesQuery.data?.policies ?? [];
  const roles = rolesQuery.data?.roles ?? [];
  const groups = groupsQuery.data?.groups ?? [];

  const rows: Row[] =
    section === "policies"
      ? policies.map((p) => ({
          id: p.id,
          name: p.name,
          system: p.kind === "system",
          detail: pluralize(p.statements.length, "statement", "statements"),
        }))
      : section === "roles"
        ? roles.map((r) => ({
            id: r.id,
            name: r.name,
            system: r.kind === "system",
            detail: pluralize(r.policyIds.length, "policy", "policies"),
          }))
        : groups.map((g) => ({
            id: g.id,
            name: g.name,
            system: false,
            detail: `${pluralize(g.memberCount, "member", "members")}, ${pluralize(
              g.policyIds.length,
              "policy",
              "policies"
            )}`,
          }));

  const isLoading =
    section === "policies"
      ? policiesQuery.isLoading
      : section === "roles"
        ? rolesQuery.isLoading
        : groupsQuery.isLoading;

  const onNew = () => {
    if (section === "policies") setPolicyEdit({ open: true, policy: null });
    else if (section === "roles") setRoleEdit({ open: true, role: null });
    else setGroupEdit({ open: true, group: null });
  };

  const onEdit = (id: string) => {
    if (section === "policies")
      setPolicyEdit({
        open: true,
        policy: policies.find((p) => p.id === id) ?? null,
      });
    else if (section === "roles")
      setRoleEdit({ open: true, role: roles.find((r) => r.id === id) ?? null });
    else
      setGroupEdit({
        open: true,
        group: groups.find((g) => g.id === id) ?? null,
      });
  };

  const onDelete = (id: string) => {
    const kind: AccessItemKind =
      section === "policies"
        ? "policy"
        : section === "roles"
          ? "role"
          : "group";
    removeMutationFor(kind).reset();
    setDeleteTarget({
      kind,
      id,
      name: rows.find((r) => r.id === id)?.name ?? "",
    });
  };

  const removeMutationFor = (kind: AccessItemKind) =>
    kind === "policy"
      ? removePolicy
      : kind === "role"
        ? removeRole
        : removeGroup;
  const deleteMutation = deleteTarget
    ? removeMutationFor(deleteTarget.kind)
    : null;

  const confirmDelete = () => {
    if (!deleteTarget || deleteMutation?.isPending) return;
    const target = deleteTarget;
    const key =
      target.kind === "policy"
        ? queryKeys.policies.root
        : target.kind === "role"
          ? queryKeys.roles.root
          : queryKeys.groups.root;
    // The error stays in the dialog (FormAlert); success closes it.
    removeMutationFor(target.kind).mutate(
      { id: target.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: key });
          toast.success(
            `${target.kind[0].toUpperCase()}${target.kind.slice(1)} deleted`
          );
          setDeleteTarget(null);
        },
      }
    );
  };

  return (
    <>
      <AccessAuthoringUI
        section={section}
        onSectionChange={setSection}
        rows={rows}
        isLoading={isLoading}
        onNew={onNew}
        onEdit={onEdit}
        onDelete={onDelete}
      />
      <PolicyEditorDialog
        open={policyEdit.open}
        onClose={() => setPolicyEdit({ open: false, policy: null })}
        policy={policyEdit.policy}
      />
      <RoleEditorDialog
        open={roleEdit.open}
        onClose={() => setRoleEdit({ open: false, role: null })}
        role={roleEdit.role}
      />
      <GroupEditorDialog
        open={groupEdit.open}
        onClose={() => setGroupEdit({ open: false, group: null })}
        group={groupEdit.group}
      />
      <DeleteAccessItemDialogUI
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        kind={deleteTarget?.kind ?? "policy"}
        itemName={deleteTarget?.name ?? ""}
        isPending={deleteMutation?.isPending ?? false}
        serverError={toServerError(deleteMutation?.error ?? null)}
      />
    </>
  );
};
