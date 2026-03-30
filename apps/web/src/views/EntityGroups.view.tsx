import React, { useState, useCallback } from "react";

import {
  EntityGroupCreateRequestBodySchema,
  type EntityGroupCreateRequestBody,
  type EntityGroupListRequestQuery,
  type EntityGroupListResponsePayload,
} from "@portalai/core/contracts";
import {
  Box,
  Breadcrumbs,
  Button,
  Stack,
  Typography,
  IconName,
} from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";
import AddIcon from "@mui/icons-material/Add";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { FormAlert } from "../components/FormAlert.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError, type ServerError } from "../utils/api.util";
import { useDialogAutoFocus } from "../utils/use-dialog-autofocus.util";
import { validateWithSchema, type FormErrors } from "../utils/form-validation.util";

// ── Data list component ─────────────────────────────────────────────

interface EntityGroupDataListProps {
  query: EntityGroupListRequestQuery;
  children: (
    data: ReturnType<typeof sdk.entityGroups.list>
  ) => React.ReactNode;
}

const EntityGroupDataList: React.FC<EntityGroupDataListProps> = ({
  query,
  children,
}) => {
  const res = sdk.entityGroups.list(query);
  return <>{children(res)}</>;
};

const dates = new DateFactory("UTC");

// ── Entity Group card ────────────────────────────────────────────────

interface EntityGroupCardProps {
  group: EntityGroupListResponsePayload["entityGroups"][number];
  onClick: () => void;
}

const EntityGroupCard: React.FC<EntityGroupCardProps> = ({ group, onClick }) => (
  <Card variant="outlined">
    <CardActionArea onClick={onClick}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {group.name}
            </Typography>
            {group.description && (
              <Typography variant="caption" color="text.secondary">
                {group.description}
              </Typography>
            )}
            <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Created on {dates.format(group.created, "MM/dd/yyyy")}
              </Typography>
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </CardActionArea>
  </Card>
);

// ── Entity Groups list view (pure UI) ──────────────────────────────

export interface EntityGroupsViewUIProps {
  onCreateGroup: () => void;
}

export const EntityGroupsViewUI: React.FC<EntityGroupsViewUIProps> = ({
  onCreateGroup,
}) => {
  const navigate = useNavigate();

  const pagination = usePagination({
    sortFields: [
      { field: "name", label: "Name" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "name",
    defaultSortOrder: "asc",
  });

  const handleRowClick = (groupId: string) => {
    navigate({
      to: `/entity-groups/${groupId}`,
    });
  };

  return (
    <Box>
      <Stack spacing={4}>
        <Box>
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/", icon: IconName.Home },
              { label: "Entity Groups" },
            ]}
            onNavigate={(href) => navigate({ to: href })}
          />

          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h1">Entity Groups</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onCreateGroup}
            >
              Create Group
            </Button>
          </Stack>
        </Box>

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <EntityGroupDataList
            query={{
              ...pagination.queryParams,
              include: "memberCount",
            } as EntityGroupListRequestQuery}
          >
            {(listResult) => (
              <SyncTotal
                total={listResult.data?.total}
                setTotal={pagination.setTotal}
              >
                <DataResult results={{ list: listResult }}>
                  {(data) => {
                    const list =
                      data.list as unknown as EntityGroupListResponsePayload;
                    if (list.entityGroups.length === 0) {
                      return (
                        <Typography
                          variant="body1"
                          color="text.secondary"
                          sx={{ py: 4, textAlign: "center" }}
                        >
                          No entity groups found
                        </Typography>
                      );
                    }

                    return (
                      <Stack spacing={1}>
                        {list.entityGroups.map((group) => (
                          <EntityGroupCard
                            key={group.id}
                            group={group}
                            onClick={() => handleRowClick(group.id)}
                          />
                        ))}
                      </Stack>
                    );
                  }}
                </DataResult>
              </SyncTotal>
            )}
          </EntityGroupDataList>
        </Box>
      </Stack>
    </Box>
  );
};

// ── Create Group Dialog ─────────────────────────────────────────────

interface CreateGroupDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: EntityGroupCreateRequestBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
}

const CreateGroupDialog: React.FC<CreateGroupDialogProps> = ({
  open,
  onClose,
  onSubmit,
  isPending,
  serverError,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const nameRef = useDialogAutoFocus(open);

  const validate = (data: { name: string }) => {
    const result = validateWithSchema(EntityGroupCreateRequestBodySchema, data);
    return result.success ? {} : result.errors;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ name: true });
    const body = {
      name: name.trim(),
      description: description.trim() || undefined,
    };
    const formErrors = validate({ name: body.name });
    setErrors(formErrors);
    if (Object.keys(formErrors).length > 0) return;
    onSubmit(body);
  };

  const handleClose = () => {
    setName("");
    setDescription("");
    setErrors({});
    setTouched({});
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Create Entity Group</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              inputRef={nameRef}
              label="Name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (touched.name) {
                  const errs = validate({ name: e.target.value.trim() });
                  setErrors(errs);
                }
              }}
              onBlur={() => {
                setTouched((prev) => ({ ...prev, name: true }));
                setErrors(validate({ name: name.trim() }));
              }}
              error={touched.name && !!errors.name}
              helperText={touched.name && errors.name}
              required
              fullWidth
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              rows={3}
            />
            <FormAlert serverError={serverError} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button type="button" variant="outlined" onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isPending}
          >
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

// ── Container (wires hooks) ─────────────────────────────────────────

export const EntityGroupsView: React.FC = () => {
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);

  const createMutation = sdk.entityGroups.create();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.entityGroups.root });
  }, [queryClient]);

  const handleOpenCreate = useCallback(() => {
    setCreateOpen(true);
  }, []);

  const handleCreateClose = useCallback(() => {
    setCreateOpen(false);
  }, []);

  const handleCreateSubmit = useCallback(
    (body: EntityGroupCreateRequestBody) => {
      createMutation.mutate(body, {
        onSuccess: () => {
          handleCreateClose();
          invalidate();
        },
      });
    },
    [createMutation, handleCreateClose, invalidate]
  );

  return (
    <>
      <EntityGroupsViewUI onCreateGroup={handleOpenCreate} />

      <CreateGroupDialog
        open={createOpen}
        onClose={handleCreateClose}
        onSubmit={handleCreateSubmit}
        isPending={createMutation.isPending}
        serverError={toServerError(createMutation.error)}
      />
    </>
  );
};
