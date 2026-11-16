import type { Meta, StoryObj } from "@storybook/react";

import { VisualDataTableUI } from "../components/VisualDataTable.component";

const ROWS = Array.from({ length: 10 }, (_, i) => ({
  month: `2026-${String(i + 1).padStart(2, "0")}`,
  revenue: 1000 + i * 125,
}));

const meta = {
  title: "Components/VisualDataTable",
  component: VisualDataTableUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    label: "Revenue by month data",
    columns: ["month", "revenue"],
    rows: ROWS,
  },
} satisfies Meta<typeof VisualDataTableUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Inline rows: client search, sort and paging. */
export const Inline: Story = {};

/** A staged result paged by the server: no search or sort. */
export const Paged: Story = {
  args: {
    paging: {
      total: 48_210,
      page: 0,
      rowsPerPage: 10,
      onPageChange: () => {},
      onRowsPerPageChange: () => {},
    },
  },
};

/** A result past the row cap says so. */
export const Capped: Story = {
  args: {
    ...Paged.args,
    capNote: "Showing the first 100,000 of 1,234,567 rows.",
  },
};

/** The staged rows aged out. */
export const Expired: Story = {
  args: { columns: [], rows: [], expired: true, onRefresh: () => {} },
};

/** Any other failure reads as an alert. */
export const Failed: Story = {
  args: {
    columns: [],
    rows: [],
    error: {
      message: "You don't have permission to read this station.",
      code: "PERMISSION_DENIED",
    },
  },
};
