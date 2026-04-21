import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { UploadStep } from "../UploadStep.component";
import type { FileUploadProgress } from "../utils/file-upload-workflow.util";
import {
  SAMPLE_FILE,
  SPREADSHEET_FILE_EXTENSIONS,
} from "../utils/file-upload-fixtures.util";

const SECOND_FILE = new File(
  [new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
  "regional-sales.xlsx",
  {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }
);

function progressMap(
  entries: Array<[string, FileUploadProgress]>
): Map<string, FileUploadProgress> {
  return new Map(entries);
}

const meta = {
  title: "Workflows/FileUploadConnector/UploadStep",
  component: UploadStep,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          `Upload step for the revised FileUploadConnector workflow. Accepts ` +
          SPREADSHEET_FILE_EXTENSIONS.join(", ") +
          `. Pure UI; the container drives phase transitions and server errors.`,
      },
    },
  },
  args: {
    onFilesChange: fn(),
    onRetry: fn(),
  },
  tags: ["autodocs"],
} satisfies Meta<typeof UploadStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  name: "Idle — no files selected",
  args: {
    files: [],
    uploadPhase: "idle",
    fileProgress: new Map(),
    overallUploadPercent: 0,
    serverError: null,
  },
};

export const OneFileSelected: Story = {
  name: "One file staged",
  args: {
    files: [SAMPLE_FILE],
    uploadPhase: "idle",
    fileProgress: new Map(),
    overallUploadPercent: 0,
    serverError: null,
  },
};

export const Uploading: Story = {
  name: "Uploading — per-file progress",
  args: {
    files: [SAMPLE_FILE, SECOND_FILE],
    uploadPhase: "uploading",
    overallUploadPercent: 46,
    serverError: null,
    fileProgress: progressMap([
      [
        SAMPLE_FILE.name,
        {
          fileName: SAMPLE_FILE.name,
          loaded: 820_000,
          total: 1_200_000,
          percent: 68,
        },
      ],
      [
        SECOND_FILE.name,
        {
          fileName: SECOND_FILE.name,
          loaded: 300_000,
          total: 1_500_000,
          percent: 20,
        },
      ],
    ]),
  },
};

export const Parsing: Story = {
  name: "Parsing — server-side",
  args: {
    files: [SAMPLE_FILE],
    uploadPhase: "parsing",
    overallUploadPercent: 72,
    serverError: null,
    fileProgress: progressMap([
      [
        SAMPLE_FILE.name,
        {
          fileName: SAMPLE_FILE.name,
          loaded: 1_200_000,
          total: 1_200_000,
          percent: 100,
        },
      ],
    ]),
  },
};

export const ErrorState: Story = {
  name: "Error — server rejected upload",
  args: {
    files: [SAMPLE_FILE],
    uploadPhase: "error",
    overallUploadPercent: 0,
    fileProgress: new Map(),
    serverError: {
      message:
        "We couldn't read that spreadsheet — it looks truncated or password protected.",
      code: "UPLOAD_PARSE_ERROR",
    },
  },
};

export const ValidationError: Story = {
  name: "Validation — no files selected after submit",
  args: {
    files: [],
    uploadPhase: "idle",
    overallUploadPercent: 0,
    fileProgress: new Map(),
    serverError: null,
    errors: { files: "Please select at least one spreadsheet to continue." },
  },
};
