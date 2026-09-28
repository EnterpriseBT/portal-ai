import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import {
  DeleteCuratedViewDialog,
  type DeleteCuratedViewDialogProps,
} from "../components/DeleteCuratedViewDialog.component";

const meta = {
  title: "Components/DeleteCuratedViewDialog",
  component: DeleteCuratedViewDialog,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: fn(),
    onConfirm: fn(),
    viewLabel: "NE Accounts",
    isPending: false,
    serverError: null,
  },
} satisfies Meta<typeof DeleteCuratedViewDialog>;

export default meta;
type Story = StoryObj<DeleteCuratedViewDialogProps>;

export const Default: Story = { args: {} };
export const Deleting: Story = { args: { isPending: true } };
export const WithError: Story = {
  args: { serverError: { message: "Could not delete the view", code: "X" } },
};
