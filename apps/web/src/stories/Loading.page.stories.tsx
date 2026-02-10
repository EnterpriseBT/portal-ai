import type { Meta, StoryObj } from "@storybook/react";
import { LoadingPage } from "../pages/Loading.page";

const meta = {
  title: "Pages/LoadingPage",
  component: LoadingPage,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LoadingPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
