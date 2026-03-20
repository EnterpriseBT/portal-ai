import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import {
  DataTable,
  useColumnConfig,
  type DataTableColumn,
  type DataTableProps,
} from "../ui/DataTable";

// ── Sample data ─────────────────────────────────────────────────────

const columns: DataTableColumn[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "email", label: "Email", sortable: true },
  {
    key: "age",
    label: "Age",
    sortable: true,
    format: (v) => (v == null ? "—" : `${v} yrs`),
  },
  {
    key: "active",
    label: "Active",
    format: (v) => (v ? "Yes" : "No"),
  },
  {
    key: "joined",
    label: "Joined",
    sortable: true,
    format: (v) =>
      v == null ? "—" : new Date(v as string).toLocaleDateString(),
  },
];

const rows = [
  {
    name: "Alice Johnson",
    email: "alice@example.com",
    age: 32,
    active: true,
    joined: "2024-01-15",
  },
  {
    name: "Bob Smith",
    email: "bob@example.com",
    age: 28,
    active: false,
    joined: "2024-03-22",
  },
  {
    name: "Carol Williams",
    email: "carol@example.com",
    age: 45,
    active: true,
    joined: "2023-11-08",
  },
  {
    name: "David Brown",
    email: "david@example.com",
    age: null,
    active: true,
    joined: "2024-06-01",
  },
  {
    name: "Eve Davis",
    email: "eve@example.com",
    age: 37,
    active: false,
    joined: null,
  },
];

// ── Meta ────────────────────────────────────────────────────────────

const meta = {
  title: "Components/DataTable",
  component: DataTable,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  argTypes: {
    emptyMessage: {
      control: "text",
      description: "Message shown when there are no rows",
    },
    sortColumn: {
      control: "text",
      description: "Currently sorted column key",
    },
    sortDirection: {
      control: "select",
      options: ["asc", "desc"],
      description: "Current sort direction",
    },
  },
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ─────────────────────────────────────────────────────────

export const Default: Story = {
  args: {
    columns,
    rows,
  },
};

export const WithSorting: Story = {
  args: {
    columns,
    rows,
    sortColumn: "name",
    sortDirection: "asc",
    onSort: (column: string) => console.log(`Sort by: ${column}`),
  },
};

export const Empty: Story = {
  args: {
    columns: [],
    rows: [],
    emptyMessage: "No records found",
  },
};

export const EmptyWithColumns: Story = {
  args: {
    columns,
    rows: [],
    emptyMessage: "No records found",
  },
};

export const CustomEmptyMessage: Story = {
  args: {
    columns,
    rows: [],
    emptyMessage: "Import data to get started",
  },
};

// ── Interactive story with column config ────────────────────────────

function DataTableWithConfig(
  props: Omit<DataTableProps, "columnConfig" | "onColumnConfigChange"> & { header?: React.ReactNode }
) {
  const [columnConfig, setColumnConfig] = useColumnConfig(props.columns);

  const [sortColumn, setSortColumn] = React.useState<string | undefined>(
    props.sortColumn
  );
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">(
    props.sortDirection ?? "asc"
  );

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  return (
    <DataTable
      {...props}
      sortColumn={sortColumn}
      sortDirection={sortDirection}
      onSort={handleSort}
      columnConfig={columnConfig}
      onColumnConfigChange={setColumnConfig}
    />
  );
}

export const WithColumnConfig: Story = {
  args: {
    columns,
    rows,
  },
  render: (args) => <DataTableWithConfig columns={args.columns} rows={args.rows} />,
};

export const WithCustomHeader: Story = {
  args: {
    columns,
    rows,
    header: (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <Typography variant="h6">Users</Typography>
        <Typography variant="body2" color="text.secondary">
          5 records
        </Typography>
      </Box>
    ),
  },
};

export const WithCustomHeaderAndConfig: Story = {
  args: {
    columns,
    rows,
  },
  render: (args) => (
    <DataTableWithConfig
      columns={args.columns}
      rows={args.rows}
      header={
        <Typography variant="h6">Users</Typography>
      }
    />
  ),
};

export const FewColumns: Story = {
  args: {
    columns: columns.slice(0, 2),
    rows: rows.map(({ name, email }) => ({ name, email })),
  },
};

export const ClickableRows: Story = {
  args: {
    columns,
    rows,
    onRowClick: (row: Record<string, unknown>, index: number) =>
      console.log(`Row ${index} clicked:`, row),
  },
};

export const CellClick: Story = {
  args: {
    columns: columns.map((col) =>
      col.key === "name" || col.key === "email"
        ? {
            ...col,
            onCellClick: (value: unknown, column: DataTableColumn) =>
              console.log(`Cell clicked — column: ${column.key}, value:`, value),
          }
        : col
    ),
    rows,
    onRowClick: (row: Record<string, unknown>, index: number) =>
      console.log(`Row ${index} clicked (non-clickable cell):`, row),
  },
};
