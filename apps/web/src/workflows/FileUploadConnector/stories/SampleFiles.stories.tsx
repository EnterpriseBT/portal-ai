import type { Meta, StoryObj } from "@storybook/react";

import { SampleFiles } from "../SampleFiles.component";

const meta: Meta<typeof SampleFiles> = {
  title: "Workflows/FileUploadConnector/SampleFiles",
  component: SampleFiles,
};

export default meta;

type Story = StoryObj<typeof SampleFiles>;

export const Default: Story = {};
