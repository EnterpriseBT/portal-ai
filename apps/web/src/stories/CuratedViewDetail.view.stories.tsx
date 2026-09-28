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
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const records = [
  { _record_id: "r1", source_id: "s1", c_name: "Acme", c_region: "NE" },
  { _record_id: "r2", source_id: "s2", c_name: "Globex", c_region: "NE" },
];

const meta = {
  title: "Views/CuratedViewDetail",
  component: CuratedViewDetailUI,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  args: {
    view,
    records,
    recordsLoading: false,
    recordsError: false,
    canManage: true,
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
