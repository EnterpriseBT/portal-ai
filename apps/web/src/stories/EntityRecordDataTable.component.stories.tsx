import type { Meta, StoryObj } from "@storybook/react";
import { EntityRecordDataTableUI } from "../components/EntityRecordDataTable.component";

const meta = {
  title: "Components/EntityRecordDataTableUI",
  component: EntityRecordDataTableUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof EntityRecordDataTableUI>;

export default meta;
type Story = StoryObj<typeof meta>;

const columns = [
  { key: "name", label: "Name", type: "string" as const },
  { key: "active", label: "Active", type: "boolean" as const },
  { key: "score", label: "Score", type: "number" as const },
  { key: "meta", label: "Meta", type: "json" as const },
  { key: "tags", label: "Tags", type: "array" as const },
];

const rows = [
  { name: "Alice", active: true, score: 98, meta: { tier: "gold" }, tags: ["admin", "editor"] },
  { name: "Bob", active: false, score: 42, meta: { tier: "silver", notes: "pending review" }, tags: ["viewer"] },
  { name: "Carol", active: true, score: 75, meta: null, tags: [] },
];

export const Default: Story = {
  args: {
    connectorEntityId: "entity-1",
    rows,
    columns,
    source: "cache",
  },
};

export const LiveSource: Story = {
  args: {
    connectorEntityId: "entity-1",
    rows,
    columns,
    source: "live",
  },
};

export const WithRowClick: Story = {
  args: {
    connectorEntityId: "entity-1",
    rows,
    columns,
    source: "cache",
    onRowClick: (row: Record<string, unknown>) => console.log("Row clicked:", row),
  },
};

export const Empty: Story = {
  args: {
    connectorEntityId: "entity-1",
    rows: [],
    columns: [],
    source: "cache",
  },
};
