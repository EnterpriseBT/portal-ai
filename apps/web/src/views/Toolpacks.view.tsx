import React, { useEffect, useMemo, useState } from "react";

import type { Toolpack } from "@portalai/core/contracts";
import {
  Box,
  Button,
  DataTable,
  Icon,
  IconName,
  PageHeader,
  Stack,
  type DataTableColumn,
} from "@portalai/core/ui";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";

import DataResult from "../components/DataResult.component";
import {
  PaginationToolbar,
  usePagination,
} from "../components/PaginationToolbar.component";
import { ToolpackMetadataModalUI } from "../components/ToolpackMetadataModal.component";
import { RegisterToolpackDialogUI } from "../components/RegisterToolpackDialog.component";
import { EditToolpackDialogUI } from "../components/EditToolpackDialog.component";
import { DeleteToolpackDialogUI } from "../components/DeleteToolpackDialog.component";
import { SigningSecretRevealDialogUI } from "../components/SigningSecretRevealDialog.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";

// ── Helpers ─────────────────────────────────────────────────────────

function formatLastRefreshed(toolpack: Toolpack): string {
  if (toolpack.kind !== "custom") return "—";
  return new Date(toolpack.schemaFetchedAt).toLocaleString();
}

interface ToolpackRow {
  id: string;
  name: string;
  kind: "builtin" | "custom";
  description: string;
  toolCount: number;
  lastRefreshed: string;
}

// ── Pure UI ─────────────────────────────────────────────────────────

export interface ToolpacksUIProps {
  toolpacks: Toolpack[];
  selected: Toolpack | null;
  onSelect: (toolpack: Toolpack) => void;
  onCloseModal: () => void;
  /** Optional — when set, the page renders a "Register toolpack" button. */
  onRegister?: () => void;
  /** Optional — fires when the Edit action on a custom row is clicked. */
  onEdit?: (toolpack: Toolpack) => void;
  /** Optional — fires when the Delete action on a custom row is clicked. */
  onDelete?: (toolpack: Toolpack) => void;
  /** Optional — fires when the Refresh action on a custom row is clicked. */
  onRefresh?: (toolpack: Toolpack) => void;
  /**
   * Id of the toolpack whose refresh is currently in flight, if any.
   * The row-level refresh button disables itself and renders a
   * spinner in place of the refresh icon while this matches its id.
   */
  refreshingId?: string | null;
}

export const ToolpacksUI: React.FC<ToolpacksUIProps> = ({
  toolpacks,
  selected,
  onSelect,
  onCloseModal,
  onRegister,
  onEdit,
  onDelete,
  onRefresh,
  refreshingId,
}) => {
  const navigate = useNavigate();

  const pagination = usePagination({
    sortFields: [
      { field: "name", label: "Name" },
      { field: "kind", label: "Kind" },
      { field: "toolCount", label: "# Tools" },
    ],
    defaultSortBy: "name",
    defaultSortOrder: "asc",
    limit: 20,
  });

  const filtered = useMemo(() => {
    const q = pagination.search.trim().toLowerCase();
    if (!q) return toolpacks;
    return toolpacks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q)
    );
  }, [toolpacks, pagination.search]);

  const showActions = Boolean(onEdit || onDelete || onRefresh);

  const columns: DataTableColumn[] = useMemo(() => {
    const base: DataTableColumn[] = [
      {
        key: "name",
        label: "Name",
        sortable: true,
        onCellClick: (_v, _c, row) => {
          const tp = toolpacks.find((t) => t.id === row.id);
          if (tp) onSelect(tp);
        },
      },
      {
        key: "kind",
        label: "Kind",
        sortable: true,
        render: (value) => (
          <Chip
            size="small"
            variant="outlined"
            label={value === "builtin" ? "Built-in" : "Custom"}
          />
        ),
      },
      {
        key: "description",
        label: "Description",
        render: (value) => {
          const text = String(value ?? "");
          return text.length > 90 ? `${text.slice(0, 90)}…` : text;
        },
      },
      {
        key: "toolCount",
        label: "# Tools",
        sortable: true,
      },
      {
        key: "lastRefreshed",
        label: "Last refreshed",
      },
    ];

    if (!showActions) return base;

    base.push({
      key: "actions",
      label: "Actions",
      render: (_value, row) => {
        const tp = toolpacks.find((t) => t.id === row.id);
        if (!tp || tp.kind !== "custom") return null;
        return (
          <Stack direction="row" spacing={0.5}>
            {onRefresh && (
              <IconButton
                size="small"
                aria-label="Refresh toolpack schema"
                disabled={refreshingId === tp.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onRefresh(tp);
                }}
              >
                {refreshingId === tp.id ? (
                  <CircularProgress
                    size={16}
                    data-testid={`toolpack-refresh-spinner-${tp.id}`}
                  />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            )}
            {onEdit && (
              <IconButton
                size="small"
                aria-label="Edit toolpack"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(tp);
                }}
              >
                <EditIcon fontSize="small" />
              </IconButton>
            )}
            {onDelete && (
              <IconButton
                size="small"
                color="error"
                aria-label="Delete toolpack"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(tp);
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
        );
      },
    });
    return base;
  }, [toolpacks, onSelect, onEdit, onDelete, onRefresh, refreshingId, showActions]);

  const rows: ToolpackRow[] = useMemo(
    () =>
      filtered.map(
        (t): ToolpackRow => ({
          id: t.id,
          name: t.name,
          kind: t.kind,
          description: t.description ?? "",
          toolCount: t.tools.length,
          lastRefreshed: formatLastRefreshed(t),
        })
      ),
    [filtered]
  );

  const sortedRows = useMemo(() => {
    if (!pagination.sortBy) return rows;
    const dir = pagination.sortOrder === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[pagination.sortBy as keyof ToolpackRow];
      const vb = b[pagination.sortBy as keyof ToolpackRow];
      if (va === vb) return 0;
      if (va == null) return -dir;
      if (vb == null) return dir;
      return va < vb ? -dir : dir;
    });
  }, [rows, pagination.sortBy, pagination.sortOrder]);

  // Client-side pagination — the toolpacks list is small but the
  // toolbar still drives offset/limit for consistency with other views.
  const pagedRows = useMemo(
    () =>
      sortedRows.slice(
        pagination.offset,
        pagination.offset + pagination.limit
      ),
    [sortedRows, pagination.offset, pagination.limit]
  );

  // Keep the toolbar's "X of Y" count in sync with the filtered set.
  useEffect(() => {
    pagination.setTotal(sortedRows.length);
  }, [sortedRows.length, pagination]);

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Toolpacks" },
          ]}
          onNavigate={(href) => navigate({ to: href })}
          title="Toolpacks"
          icon={<Icon name={IconName.Extension} />}
          primaryAction={
            onRegister ? (
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={onRegister}
              >
                Register toolpack
              </Button>
            ) : undefined
          }
        />

        <PaginationToolbar {...pagination.toolbarProps} />

        <DataTable
          columns={columns}
          rows={pagedRows as unknown as Record<string, unknown>[]}
          sortColumn={pagination.sortBy}
          sortDirection={pagination.sortOrder}
          onSort={pagination.setSortBy}
          onRowClick={(row) => {
            const tp = toolpacks.find((t) => t.id === row.id);
            if (tp) onSelect(tp);
          }}
          emptyMessage="No toolpacks match your filter"
        />
      </Stack>

      <ToolpackMetadataModalUI
        toolpack={selected}
        open={selected !== null}
        onClose={onCloseModal}
      />
    </Box>
  );
};

// ── Container ───────────────────────────────────────────────────────

interface RefreshToast {
  severity: "success" | "error";
  message: string;
}

export const Toolpacks: React.FC = () => {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Toolpack | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editing, setEditing] = useState<Toolpack | null>(null);
  const [deleting, setDeleting] = useState<Toolpack | null>(null);
  const [refreshToast, setRefreshToast] = useState<RefreshToast | null>(null);

  const listResult = sdk.toolpacks.list();
  const registerMutation = sdk.toolpacks.register();
  const updateMutation = sdk.toolpacks.update(editing?.id ?? "");
  const refreshMutation = sdk.toolpacks.refresh();
  const deleteMutation = sdk.toolpacks.remove(deleting?.id ?? "");
  const rotateSecretMutation = sdk.toolpacks.rotateSigningSecret(
    editing?.id ?? ""
  );

  // Phase 6: signing secret revealed once after registration or
  // rotation. The reveal dialog lifts state up so both flows share
  // the same UI; null hides the dialog.
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.toolpacks.root });
  };

  return (
    <>
      <DataResult results={{ list: listResult }}>
        {({ list }) => (
          <ToolpacksUI
            toolpacks={list.toolpacks as Toolpack[]}
            selected={selected}
            onSelect={setSelected}
            onCloseModal={() => setSelected(null)}
            onRegister={() => setRegisterOpen(true)}
            onEdit={(t) => setEditing(t)}
            onDelete={(t) => setDeleting(t)}
            refreshingId={
              refreshMutation.isPending
                ? refreshMutation.variables?.id ?? null
                : null
            }
            onRefresh={(t) => {
              refreshMutation.mutate(
                { id: t.id },
                {
                  onSuccess: () => {
                    invalidate();
                    setRefreshToast({
                      severity: "success",
                      message: `Refreshed "${t.name}".`,
                    });
                  },
                  onError: (err) => {
                    setRefreshToast({
                      severity: "error",
                      message: `Failed to refresh "${t.name}": ${err.message}`,
                    });
                  },
                }
              );
            }}
          />
        )}
      </DataResult>

      <RegisterToolpackDialogUI
        open={registerOpen}
        onClose={() => {
          setRegisterOpen(false);
          registerMutation.reset();
        }}
        onSubmit={(body) => {
          registerMutation.mutate(body, {
            onSuccess: (data) => {
              setRegisterOpen(false);
              invalidate();
              if (data.signingSecret) {
                setRevealedSecret(data.signingSecret);
              }
            },
          });
        }}
        isPending={registerMutation.isPending}
        serverError={toServerError(registerMutation.error)}
      />

      <EditToolpackDialogUI
        open={editing !== null}
        toolpack={editing}
        onClose={() => {
          setEditing(null);
          updateMutation.reset();
          refreshMutation.reset();
          rotateSecretMutation.reset();
        }}
        onSubmit={(body) => {
          updateMutation.mutate(body, {
            onSuccess: () => {
              setEditing(null);
              invalidate();
            },
          });
        }}
        onRefresh={() => {
          if (!editing) return;
          const target = editing;
          refreshMutation.mutate(
            { id: target.id },
            {
              onSuccess: () => {
                invalidate();
                setRefreshToast({
                  severity: "success",
                  message: `Refreshed "${target.name}".`,
                });
              },
              onError: (err) => {
                setRefreshToast({
                  severity: "error",
                  message: `Failed to refresh "${target.name}": ${err.message}`,
                });
              },
            }
          );
        }}
        onRotateSecret={() => {
          rotateSecretMutation.mutate(undefined, {
            onSuccess: (data) => {
              invalidate();
              setEditing(null);
              setRevealedSecret(data.signingSecret);
            },
          });
        }}
        isPending={updateMutation.isPending}
        isRefreshing={refreshMutation.isPending}
        isRotatingSecret={rotateSecretMutation.isPending}
        serverError={toServerError(updateMutation.error)}
        refreshError={toServerError(refreshMutation.error)}
      />

      <SigningSecretRevealDialogUI
        open={revealedSecret !== null}
        signingSecret={revealedSecret}
        onClose={() => setRevealedSecret(null)}
      />

      <DeleteToolpackDialogUI
        open={deleting !== null}
        toolpackName={deleting?.name ?? ""}
        onClose={() => {
          setDeleting(null);
          deleteMutation.reset();
        }}
        onConfirm={() => {
          deleteMutation.mutate(undefined, {
            onSuccess: () => {
              setDeleting(null);
              invalidate();
              queryClient.invalidateQueries({
                queryKey: queryKeys.stations.root,
              });
            },
          });
        }}
        isPending={deleteMutation.isPending}
        serverError={toServerError(deleteMutation.error)}
      />

      <Snackbar
        open={refreshToast !== null}
        autoHideDuration={refreshToast?.severity === "success" ? 4000 : null}
        onClose={(_evt, reason) => {
          // Don't dismiss errors via clickaway — only the explicit
          // close button — so users have time to read the message.
          if (reason === "clickaway" && refreshToast?.severity === "error") {
            return;
          }
          setRefreshToast(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {refreshToast ? (
          <Alert
            severity={refreshToast.severity}
            variant="filled"
            onClose={() => setRefreshToast(null)}
            sx={{ minWidth: 320 }}
            data-testid={`toolpack-refresh-toast-${refreshToast.severity}`}
          >
            {refreshToast.message}
          </Alert>
        ) : (
          <span />
        )}
      </Snackbar>
    </>
  );
};
