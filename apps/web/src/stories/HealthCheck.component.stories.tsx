import type { Meta, StoryObj } from "@storybook/react";
import { HealthCheckUI } from "../components/HealthCheck.component";

const meta = {
  title: "Components/HealthCheckUI",
  component: HealthCheckUI,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof HealthCheckUI>;

export default meta;
type Story = StoryObj<typeof HealthCheckUI>;

export const Healthy: Story = {
  args: {
    data: { timestamp: new Date().toISOString() },
  },
};

export const UnknownTimestamp: Story = {
  args: {
    data: { timestamp: "" },
  },
};
