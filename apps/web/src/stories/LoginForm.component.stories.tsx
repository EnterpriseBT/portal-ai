import type { Meta, StoryObj } from "@storybook/react";
import { LoginFormUI } from "../components/LoginForm.component";

const meta = {
  title: "Components/LoginFormUI",
  component: LoginFormUI,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
} satisfies Meta<typeof LoginFormUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    onClickGoogleLogin: () => {
      console.log("Google login clicked");
    },
  },
};
