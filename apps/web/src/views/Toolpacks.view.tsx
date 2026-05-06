import React, { useMemo, useState } from "react";

import type { Toolpack } from "@portalai/core/contracts";
import {
  Box,
  DataTable,
  Icon,
  IconName,
  PageHeader,
  Stack,
  type DataTableColumn,
} from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import { useNavigate } from "@tanstack/react-router";

import DataResult from "../components/DataResult.component";
import { ToolpackMetadataModalUI } from "../components/ToolpackMetadataModal.component";
import { sdk } from "../api/sdk";

// ── Pure UI ─────────────────────────────────────────────────────────

export interface ToolpacksUIProps {
  toolpacks: Toolpack[];
  search: string;
  onSearchChange: (next: string) => void;
  selected: Toolpack | null;
  onSelect: (toolpack: Toolpack) => void;
  onCloseModal: () => void;
}

export const ToolpacksUI: React.FC<ToolpacksUIProps> = ({
  toolpacks,
  search,
  onSearchChange,
  selected,
  onSelect,
  onCloseModal,
}) => {
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return toolpacks;
    return toolpacks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q)
    );
  }, [toolpacks, search]);

  const columns: DataTableColumn[] = useMemo(
    () => [
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
        render: () => "—",
      },
    ],
    [toolpacks, onSelect]
  );

  const rows = useMemo(
    () =>
      filtered.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        description: t.description,
        toolCount: t.tools.length,
        lastRefreshed: null,
      })),
    [filtered]
  );

  const [sortColumn, setSortColumn] = useState<string | undefined>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const sortedRows = useMemo(() => {
    if (!sortColumn) return rows;
    const dir = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = a[sortColumn as keyof typeof a];
      const vb = b[sortColumn as keyof typeof b];
      if (va === vb) return 0;
      if (va == null) return -dir;
      if (vb == null) return dir;
      return va < vb ? -dir : dir;
    });
  }, [rows, sortColumn, sortDirection]);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };

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
        />

        <TextField
          size="small"
          placeholder="Filter by name, description, or slug"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          inputProps={{ "aria-label": "Filter toolpacks" }}
        />

        <DataTable
          columns={columns}
          rows={sortedRows}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
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
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Toolpack | null>(null);

  const listResult = sdk.toolpacks.list();

  return (
    <DataResult results={{ list: listResult }}>
      {({ list }) => (
        <ToolpacksUI
          toolpacks={list.toolpacks as Toolpack[]}
          search={search}
          onSearchChange={setSearch}
          selected={selected}
          onSelect={setSelected}
          onCloseModal={() => setSelected(null)}
        />
      )}
    </DataResult>
  );
};
