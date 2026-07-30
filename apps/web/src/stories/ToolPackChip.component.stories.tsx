import type { Meta, StoryObj } from "@storybook/react";
import Stack from "@mui/material/Stack";

import { ToolPackChip } from "../components/ToolPackChip.component";

const meta = {
  title: "Components/ToolPackChip",
  component: ToolPackChip,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof ToolPackChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { pack: "data_query" },
};

export const Custom: Story = {
  args: { pack: "org:abc-123", label: "customer_intel" },
};

/**
 * A pack the organization's plan does not include (#284). Muted and dashed,
 * still named, with the reason on hover and on an `aria-label`. A station can
 * legitimately carry such a pack after a downgrade — it goes inert, never
 * hidden.
 */
export const Unentitled: Story = {
  args: { pack: "entity_management", entitled: false },
};

/** Entitled and unentitled side by side — the contrast is the affordance. */
export const Comparison: Story = {
  args: { pack: "data_query" },
  render: () => (
    <Stack direction="row" spacing={1}>
      <ToolPackChip pack="data_query" />
      <ToolPackChip pack="entity_management" entitled={false} />
    </Stack>
  ),
};
