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
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
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
                onClick={(e) => {
                  e.stopPropagation();
                  onRefresh(tp);
                }}
              >
                <RefreshIcon fontSize="small" />
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
  }, [toolpacks, onSelect, onEdit, onDelete, onRefresh, showActions]);

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

export const Toolpacks: React.FC = () => {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Toolpack | null>(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [editing, setEditing] = useState<Toolpack | null>(null);
  const [deleting, setDeleting] = useState<Toolpack | null>(null);

  const listResult = sdk.toolpacks.list();
  const registerMutation = sdk.toolpacks.register();
  const updateMutation = sdk.toolpacks.update(editing?.id ?? "");
  const refreshMutation = sdk.toolpacks.refresh(editing?.id ?? "");
  const deleteMutation = sdk.toolpacks.remove(deleting?.id ?? "");

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
            onRefresh={(t) => {
              const refresh = sdk.toolpacks.refresh(t.id);
              refresh.mutate(undefined, {
                onSuccess: () => invalidate(),
              });
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
            onSuccess: () => {
              setRegisterOpen(false);
              invalidate();
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
          refreshMutation.mutate(undefined, {
            onSuccess: () => invalidate(),
          });
        }}
        isPending={updateMutation.isPending}
        isRefreshing={refreshMutation.isPending}
        serverError={toServerError(updateMutation.error)}
        refreshError={toServerError(refreshMutation.error)}
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
    </>
  );
};
