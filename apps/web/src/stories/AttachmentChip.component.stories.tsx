import type { Meta, StoryObj } from "@storybook/react";
import Stack from "@mui/material/Stack";

import { AttachmentChipUI } from "../components/AttachmentChip.component";

const meta = {
  title: "Components/AttachmentChip",
  component: AttachmentChipUI,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof AttachmentChipUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReadableView: Story = {
  args: { kind: "view", label: "Q3 orders", canRead: true },
};

export const ReadableConnector: Story = {
  args: { kind: "connector", label: "CRM", canRead: true },
};

/**
 * #674: an attachment the viewer can't read keeps its real name, outlined in
 * the error colour with a lock and a tooltip, and is not clickable.
 */
export const NoAccess: Story = {
  args: { kind: "view", label: "Payroll", canRead: false },
};

export const Comparison: Story = {
  args: { kind: "view", label: "Q3 orders", canRead: true },
  render: () => (
    <Stack direction="row" spacing={1}>
      <AttachmentChipUI kind="view" label="Q3 orders" canRead />
      <AttachmentChipUI kind="view" label="Payroll" canRead={false} />
      <AttachmentChipUI kind="connector" label="CRM" canRead />
      <AttachmentChipUI kind="connector" label="HR system" canRead={false} />
    </Stack>
  ),
};
