import React, { useMemo, useState } from "react";

import type {
  CuratedViewGetResponsePayload,
  CuratedViewRecordsResponsePayload,
} from "@portalai/core/contracts";
import {
  Box,
  Button,
  Icon,
  IconName,
  MetadataList,
  PageEmptyState,
  PageHeader,
  Stack,
} from "@portalai/core/ui";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useNavigate, useParams } from "@tanstack/react-router";

import { EmptyResults } from "../components/EmptyResults.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { CuratedViewEditorDialog } from "../components/CuratedViewEditorDialog.component";
import { DeleteCuratedViewDialog } from "../components/DeleteCuratedViewDialog.component";
import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { useQueryClient } from "@tanstack/react-query";
import { useCapabilities } from "../utils/use-capabilities.util";
import { useToast } from "../utils/toast.context";
import { toServerError } from "../utils/api.util";

type CuratedView = CuratedViewGetResponsePayload["curatedView"];
type RecordRow = CuratedViewRecordsResponsePayload["records"][number];

/** Row keys that are internal identifiers rather than projected data columns. */
const META_RECORD_KEYS = new Set(["_record_id", "source_id"]);

// ── Pure UI ──────────────────────────────────────────────────────────

export interface CuratedViewDetailUIProps {
  view: CuratedView;
  records: RecordRow[];
  recordsLoading: boolean;
  recordsError: boolean;
  /** Whether the caller may edit/delete the view (admin). */
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onNavigate: (href: string) => void;
}

export const CuratedViewDetailUI: React.FC<CuratedViewDetailUIProps> = ({
  view,
  records,
  recordsLoading,
  recordsError,
  canManage,
  onEdit,
  onDelete,
  onNavigate,
}) => {
  // Derive the column set from the returned rows (the records endpoint returns
  // rows keyed by wide-column name; a richer columns-in-response payload is a
  // follow-up). Stable order: first-seen across the page, data columns first.
  const columns = useMemo(() => {
    const seen: string[] = [];
    for (const row of records) {
      for (const key of Object.keys(row)) {
        if (META_RECORD_KEYS.has(key)) continue;
        if (!seen.includes(key)) seen.push(key);
      }
    }
    return seen;
  }, [records]);

  let body: React.ReactNode;
  if (recordsError) {
    body = <EmptyResults />;
  } else if (!recordsLoading && records.length === 0) {
    body = (
      <PageEmptyState
        icon={<Icon name={IconName.ViewColumn} />}
        title="No rows"
        description="This view currently returns no rows for you."
      />
    );
  } else {
    body = (
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label="View records">
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c}>{c}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((row, i) => (
              <TableRow key={(row._record_id as string) ?? i}>
                {columns.map((c) => (
                  <TableCell key={c}>
                    {row[c] === null || row[c] === undefined
                      ? ""
                      : String(row[c])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Views", href: "/views" },
            { label: view.label },
          ]}
          onNavigate={onNavigate}
          title={view.label}
          icon={<Icon name={IconName.ViewColumn} />}
          primaryAction={
            canManage ? (
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  startIcon={<EditIcon />}
                  onClick={onEdit}
                >
                  Edit
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={onDelete}
                >
                  Delete
                </Button>
              </Stack>
            ) : undefined
          }
        >
          Curated slice of connector data.
        </PageHeader>

        <MetadataList
          items={[
            { label: "Key", value: view.key },
            {
              label: "Description",
              value: view.description ?? "",
              hidden: !view.description,
            },
            {
              label: "Row filter",
              value: view.filter ? "Filtered" : "All rows",
            },
            {
              label: "Columns",
              value: view.fieldMappingIds.length
                ? `${view.fieldMappingIds.length} selected`
                : "All columns",
            },
          ]}
        />

        {body}
      </Stack>
    </Box>
  );
};

// ── Container ────────────────────────────────────────────────────────

export const CuratedViewDetail: React.FC = () => {
  const { viewId } = useParams({ from: "/views/$viewId" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { canOnResource } = useCapabilities();
  const canManage = canOnResource("curated_view", "write");

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const viewResult = sdk.curatedViews.get(viewId);
  const pagination = usePagination({
    sortFields: [],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
  });
  const recordsResult = sdk.curatedViews.records(
    viewId,
    pagination.queryParams as Parameters<typeof sdk.curatedViews.records>[1]
  );

  React.useEffect(() => {
    if (recordsResult.data?.total !== undefined) {
      pagination.setTotal(recordsResult.data.total);
    }
  }, [recordsResult.data?.total, pagination]);

  const {
    mutate: removeView,
    isPending: isDeleting,
    error: deleteError,
  } = sdk.curatedViews.delete(viewId);

  const view = viewResult.data?.curatedView;
  if (!view) {
    if (viewResult.isError) {
      return (
        <PageEmptyState
          icon={<Icon name={IconName.ViewColumn} />}
          title="View not found"
          description="This view does not exist or is not available to you."
        />
      );
    }
    return null;
  }

  const handleDelete = () => {
    removeView(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.curatedViews.root,
        });
        toast.success(`Deleted "${view.label}"`);
        navigate({ to: "/views" });
      },
    });
  };

  return (
    <Stack spacing={4}>
      <PaginationToolbar {...pagination.toolbarProps} />
      <CuratedViewDetailUI
        view={view}
        records={recordsResult.data?.records ?? []}
        recordsLoading={recordsResult.isLoading}
        recordsError={recordsResult.isError}
        canManage={canManage}
        onEdit={() => setEditOpen(true)}
        onDelete={() => setDeleteOpen(true)}
        onNavigate={(href) => navigate({ to: href })}
      />
      <CuratedViewEditorDialog
        open={editOpen}
        mode="edit"
        view={view}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false);
          queryClient.invalidateQueries({
            queryKey: queryKeys.curatedViews.root,
          });
        }}
      />
      <DeleteCuratedViewDialog
        open={deleteOpen}
        viewLabel={view.label}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        isPending={isDeleting}
        serverError={toServerError(deleteError as never)}
      />
    </Stack>
  );
};
