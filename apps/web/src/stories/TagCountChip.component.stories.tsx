import type { Meta, StoryObj } from "@storybook/react";

import { TagCountChipUI } from "../components/TagCountChip.component";

/** #1123: a tag with its count, linking to the tag's page. */
const meta = {
  title: "Dashboard/TagCountChip",
  component: TagCountChipUI,
  parameters: { layout: "padded" },
  args: { tag: { id: "t1", name: "Finance", color: "#2e7d32" }, count: 14 },
} satisfies Meta<typeof TagCountChipUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NoColor: Story = {
  args: { tag: { id: "t4", name: "Draft", color: null }, count: 2 },
};
