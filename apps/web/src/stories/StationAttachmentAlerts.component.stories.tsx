import type { Meta, StoryObj } from "@storybook/react";

import { StationAttachmentAlertsUI } from "../components/StationAttachmentAlerts.component";

const meta = {
  title: "Components/StationAttachmentAlerts",
  component: StationAttachmentAlertsUI,
  tags: ["autodocs"],
} satisfies Meta<typeof StationAttachmentAlertsUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** #674: one combined alert when neither kind is attached. */
export const NothingAttached: Story = {
  args: { viewCount: 0, connectorCount: 0 },
};

export const NoViews: Story = {
  args: { viewCount: 0, connectorCount: 2 },
};

export const NoConnectors: Story = {
  args: { viewCount: 3, connectorCount: 0 },
};

/** Both kinds attached: renders nothing. */
export const FullyAttached: Story = {
  args: { viewCount: 1, connectorCount: 1 },
};
