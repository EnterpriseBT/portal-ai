import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import {
  RenameOrganizationDialogUI,
  RenameOrganizationDialogUIProps,
} from "../components/RenameOrganizationDialog.component";

const meta = {
  title: "Components/RenameOrganizationDialog",
  component: RenameOrganizationDialogUI,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  args: {
    open: true,
    onClose: fn(),
    onSubmit: fn(),
    isPending: false,
    currentName: "Acme Corp",
    serverError: null,
  },
} satisfies Meta<typeof RenameOrganizationDialogUI>;

export default meta;
type Story = StoryObj<RenameOrganizationDialogUIProps>;

export const Default: Story = {
  args: {},
};

export const Saving: Story = {
  args: {
    isPending: true,
  },
};

export const PermissionDenied: Story = {
  args: {
    serverError: {
      message: "You don't have permission to edit the organization.",
      code: "PERMISSION_DENIED",
    },
  },
};
