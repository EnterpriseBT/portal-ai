import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import {
  CuratedViewDetailUI,
  type CuratedViewDetailUIProps,
} from "../views/CuratedViewDetail.view";

const view = {
  id: "cv-1",
  organizationId: "org-1",
  connectorEntityId: "ent-1",
  key: "ne_accounts",
  label: "NE Accounts",
  description: "North-east accounts",
  filter: null,
  fieldMappingIds: ["fm-1", "fm-2"],
  filtered: false,
  projected: true,
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// #678: ResolvedColumns keyed by normalizedKey, as the records endpoint
// returns them; `alias` shares the "Name" definition (distinct headers).
const col = (normalizedKey: string, key: string, label: string) => ({
  key,
  normalizedKey,
  label,
  type: "string" as const,
  required: false,
  enumValues: null,
  defaultValue: null,
  format: null,
  validationPattern: null,
  canonicalFormat: null,
});
const columns = [
  col("name", "name", "Name"),
  col("region", "region", "Region"),
  col("alias", "name", "Name"),
];

const records = [
  {
    _record_id: "r1",
    _source_id: "s1",
    name: "Acme",
    region: "NE",
    alias: "ACME Co",
  },
  {
    _record_id: "r2",
    _source_id: "s2",
    name: "Globex",
    region: "NE",
    alias: "Globex Corp",
  },
];

const meta = {
  title: "Views/CuratedViewDetail",
  component: CuratedViewDetailUI,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: {
    view,
    columns,
    records,
    recordsLoading: false,
    recordsError: false,
    canManage: true,
    paginationToolbar: null,
    sortColumn: "name",
    sortDirection: "asc",
    onSort: fn(),
    onEdit: fn(),
    onDelete: fn(),
    onNavigate: fn(),
  },
} satisfies Meta<typeof CuratedViewDetailUI>;

export default meta;
type Story = StoryObj<CuratedViewDetailUIProps>;

export const Admin: Story = { args: {} };
export const Member: Story = { args: { canManage: false } };
export const Empty: Story = { args: { records: [] } };
