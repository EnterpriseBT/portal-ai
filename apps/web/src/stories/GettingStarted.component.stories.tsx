import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import {
  GettingStarted,
  type GettingStartedProps,
} from "../components/GettingStarted.component";
import { GETTING_STARTED_STEPS } from "../utils/getting-started.util";

const meta = {
  title: "Components/GettingStarted",
  component: GettingStarted,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
  args: {
    onNavigate: fn(),
  },
} satisfies Meta<typeof GettingStarted>;

export default meta;
type Story = StoryObj<GettingStartedProps>;

export const Default: Story = {
  args: {
    steps: GETTING_STARTED_STEPS,
  },
};
