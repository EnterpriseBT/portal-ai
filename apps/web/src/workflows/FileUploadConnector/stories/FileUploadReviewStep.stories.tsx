import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { FileUploadReviewStepUI } from "../FileUploadReviewStep.component";
import { POST_INTERPRET_REGIONS } from "../utils/file-upload-fixtures.util";
import type { RegionDraft } from "../../../modules/RegionEditor";

const ALL_GREEN_REGIONS: RegionDraft[] = [
  {
    ...POST_INTERPRET_REGIONS[0],
    confidence: 0.94,
    columnBindings: POST_INTERPRET_REGIONS[0].columnBindings!.map((b) => ({
      ...b,
      confidence: 0.92,
    })),
    warnings: undefined,
  },
];

const BLOCKER_REGIONS: RegionDraft[] = [
  {
    ...POST_INTERPRET_REGIONS[0],
    confidence: 0.56,
    warnings: [
      {
        code: "IDENTITY_COLUMN_HAS_BLANKS",
        severity: "blocker",
        message: "Identity column 'Region' has 2 blank rows.",
        suggestedFix:
          "Fill the blanks in the source file or choose a different identity column.",
      },
    ],
  },
];

const meta = {
  title: "Workflows/FileUploadConnector/FileUploadReviewStepUI",
  component: FileUploadReviewStepUI,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ padding: 16 }}>
        <Story />
      </div>
    ),
  ],
  args: {
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    onCommit: fn(),
    onBack: fn(),
  },
} satisfies Meta<typeof FileUploadReviewStepUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllGreen: Story = {
  name: "All green — high confidence, commit enabled",
  args: {
    regions: ALL_GREEN_REGIONS,
    overallConfidence: 0.93,
    serverError: null,
  },
};

export const MixedConfidence: Story = {
  name: "Mixed confidence — yellow binding with warning",
  args: {
    regions: POST_INTERPRET_REGIONS,
    overallConfidence: 0.81,
    serverError: null,
  },
};

export const BlockerPresent: Story = {
  name: "Blocker present — commit disabled",
  args: {
    regions: BLOCKER_REGIONS,
    overallConfidence: 0.56,
    serverError: null,
  },
};

export const Committing: Story = {
  name: "Committing — spinner label, commit disabled",
  args: {
    regions: POST_INTERPRET_REGIONS,
    overallConfidence: 0.85,
    isCommitting: true,
    serverError: null,
  },
};

export const ServerError: Story = {
  name: "Server error — commit failed",
  args: {
    regions: POST_INTERPRET_REGIONS,
    overallConfidence: 0.85,
    serverError: {
      message:
        "Commit failed — the downstream service is temporarily unavailable.",
      code: "COMMIT_UNAVAILABLE",
    },
  },
};
