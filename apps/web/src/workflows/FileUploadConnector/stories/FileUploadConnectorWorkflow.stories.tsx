import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import MuiButton from "@mui/material/Button";

import { FileUploadConnectorWorkflowUI } from "../FileUploadConnectorWorkflow.component";
import type { FileUploadConnectorWorkflowUIProps } from "../FileUploadConnectorWorkflow.component";
import {
  DEMO_WORKBOOK,
  ENTITY_OPTIONS,
  POST_INTERPRET_REGIONS,
  SAMPLE_FILE,
  SAMPLE_REGIONS,
} from "../utils/file-upload-fixtures.util";
import {
  FILE_UPLOAD_WORKFLOW_STEPS,
  useFileUploadWorkflow,
} from "../utils/file-upload-workflow.util";
import type { FileUploadProgress } from "../utils/file-upload-workflow.util";
import type { RegionDraft } from "../../../modules/RegionEditor";

// ---------------------------------------------------------------------------
// Base args shared across non-interactive stories
// ---------------------------------------------------------------------------

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

const BASE_ARGS: FileUploadConnectorWorkflowUIProps = {
  open: true,
  onClose: fn(),
  step: 0,
  stepConfigs: FILE_UPLOAD_WORKFLOW_STEPS,

  files: [],
  onFilesChange: fn(),
  uploadPhase: "idle",
  fileProgress: new Map(),
  overallUploadPercent: 0,
  onStartParse: fn(),

  workbook: null,
  regions: [],
  selectedRegionId: null,
  activeSheetId: null,
  entityOptions: ENTITY_OPTIONS,
  onActiveSheetChange: fn(),
  onSelectRegion: fn(),
  onRegionDraft: fn(),
  onRegionUpdate: fn(),
  onRegionResize: fn(),
  onRegionDelete: fn(),
  onInterpret: fn(),

  overallConfidence: undefined,
  onJumpToRegion: fn(),
  onEditBinding: fn(),
  onCommit: fn(),

  onBack: fn(),

  serverError: null,
  isInterpreting: false,
  isCommitting: false,
};

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta = {
  title: "Workflows/FileUploadConnector",
  component: FileUploadConnectorWorkflowUI,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
} satisfies Meta<typeof FileUploadConnectorWorkflowUI>;

export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Step 0 — Upload
// ---------------------------------------------------------------------------

export const Step0_Idle: Story = {
  name: "Step 0 — Idle (modal open, no files)",
  args: { ...BASE_ARGS },
};

export const Step0_FilesSelected: Story = {
  name: "Step 0 — Files staged",
  args: {
    ...BASE_ARGS,
    files: [SAMPLE_FILE, SECOND_FILE],
  },
};

export const Step0_Uploading: Story = {
  name: "Step 0 — Uploading",
  args: {
    ...BASE_ARGS,
    files: [SAMPLE_FILE],
    uploadPhase: "uploading",
    overallUploadPercent: 62,
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
    ]),
  },
};

// ---------------------------------------------------------------------------
// Step 1 — Region drawing
// ---------------------------------------------------------------------------

export const Step1_Empty: Story = {
  name: "Step 1 — Parsed workbook, no regions drawn",
  args: {
    ...BASE_ARGS,
    step: 1,
    files: [SAMPLE_FILE],
    uploadPhase: "parsed",
    workbook: DEMO_WORKBOOK,
    activeSheetId: DEMO_WORKBOOK.sheets[0].id,
  },
};

export const Step1_RegionsDrawn_Valid: Story = {
  name: "Step 1 — Regions drawn and bound, Interpret enabled",
  args: {
    ...BASE_ARGS,
    step: 1,
    files: [SAMPLE_FILE],
    uploadPhase: "parsed",
    workbook: DEMO_WORKBOOK,
    regions: SAMPLE_REGIONS,
    activeSheetId: SAMPLE_REGIONS[0].sheetId,
    selectedRegionId: SAMPLE_REGIONS[0].id,
  },
};

const invalidRegion: RegionDraft = {
  id: "r_invalid_story",
  sheetId: DEMO_WORKBOOK.sheets[0].id,
  bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 3 },
  orientation: "rows-as-records",
  headerAxis: "row",
  targetEntityDefinitionId: null,
};

export const Step1_InvalidRegion: Story = {
  name: "Step 1 — Invalid region (entity unbound) with injected errors",
  args: {
    ...BASE_ARGS,
    step: 1,
    files: [SAMPLE_FILE],
    uploadPhase: "parsed",
    workbook: DEMO_WORKBOOK,
    regions: [invalidRegion],
    activeSheetId: invalidRegion.sheetId,
    selectedRegionId: invalidRegion.id,
    errors: {
      [invalidRegion.id]: {
        targetEntityDefinitionId: "Select an entity to bind this region to",
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Step 2 — Review
// ---------------------------------------------------------------------------

export const Step2_AllGreen: Story = {
  name: "Step 2 — Review with high confidence",
  args: {
    ...BASE_ARGS,
    step: 2,
    files: [SAMPLE_FILE],
    uploadPhase: "parsed",
    workbook: DEMO_WORKBOOK,
    regions: POST_INTERPRET_REGIONS,
    activeSheetId: POST_INTERPRET_REGIONS[0].sheetId,
    overallConfidence: 0.91,
  },
};

const blockerRegion: RegionDraft = {
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
};

export const Step2_BlockerPresent: Story = {
  name: "Step 2 — Blocker present, commit disabled",
  args: {
    ...BASE_ARGS,
    step: 2,
    files: [SAMPLE_FILE],
    uploadPhase: "parsed",
    workbook: DEMO_WORKBOOK,
    regions: [blockerRegion],
    activeSheetId: blockerRegion.sheetId,
    overallConfidence: 0.56,
  },
};

// ---------------------------------------------------------------------------
// Interactive — full click-through with fake async handlers
// ---------------------------------------------------------------------------

function delay<T>(value: T, ms = 300): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

const InteractiveContent: React.FC = () => {
  const [committedPayload, setCommittedPayload] = useState<{
    regions: RegionDraft[];
    connectorInstanceId: string;
  } | null>(null);

  const workflow = useFileUploadWorkflow(
    {
      parseFile: () => delay(DEMO_WORKBOOK),
      createConnectorInstance: () =>
        delay({ connectorInstanceId: "ci_interactive" }),
      runInterpret: (regions) =>
        delay({
          regions: regions.map((r) => ({
            ...r,
            confidence: 0.88,
            columnBindings: POST_INTERPRET_REGIONS[0].columnBindings,
          })),
          overallConfidence: 0.88,
          planId: "plan_interactive",
        }),
      runCommit: (regions) => {
        void regions;
        return delay({ connectorInstanceId: "ci_interactive" });
      },
      onCommitSuccess: (connectorInstanceId) => {
        setCommittedPayload({
          regions: workflow.regions,
          connectorInstanceId,
        });
      },
    },
    {
      organizationId: "org_demo",
      connectorDefinitionId: "cdef_fileupload_demo",
    }
  );

  return (
    <>
      <FileUploadConnectorWorkflowUI
        open={true}
        onClose={fn()}
        step={workflow.step}
        stepConfigs={FILE_UPLOAD_WORKFLOW_STEPS}
        files={workflow.files}
        onFilesChange={workflow.addFiles}
        uploadPhase={workflow.uploadPhase}
        fileProgress={workflow.fileProgress}
        overallUploadPercent={workflow.overallUploadPercent}
        onStartParse={() => {
          void workflow.startParse();
        }}
        workbook={workflow.workbook}
        regions={workflow.regions}
        selectedRegionId={workflow.selectedRegionId}
        activeSheetId={workflow.activeSheetId}
        entityOptions={ENTITY_OPTIONS}
        onActiveSheetChange={workflow.onActiveSheetChange}
        onSelectRegion={workflow.onSelectRegion}
        onRegionDraft={workflow.onRegionDraft}
        onRegionUpdate={workflow.onRegionUpdate}
        onRegionResize={(regionId, nextBounds) =>
          workflow.onRegionUpdate(regionId, { bounds: nextBounds })
        }
        onRegionDelete={workflow.onRegionDelete}
        onInterpret={() => {
          void workflow.onInterpret();
        }}
        overallConfidence={workflow.overallConfidence}
        onJumpToRegion={(regionId) => workflow.onSelectRegion(regionId)}
        onEditBinding={(regionId) => workflow.onSelectRegion(regionId)}
        onCommit={() => {
          void workflow.onCommit();
        }}
        onBack={workflow.goBack}
        serverError={workflow.serverError}
        isInterpreting={workflow.isInterpreting}
        isCommitting={workflow.isCommitting}
      />

      <Dialog
        open={committedPayload !== null}
        onClose={() => setCommittedPayload(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Commit payload</DialogTitle>
        <DialogContent dividers>
          <pre style={{ margin: 0, fontSize: 12, whiteSpace: "pre-wrap" }}>
            {JSON.stringify(committedPayload, null, 2)}
          </pre>
        </DialogContent>
        <DialogActions>
          <MuiButton
            onClick={() => {
              setCommittedPayload(null);
              workflow.reset();
            }}
          >
            Done
          </MuiButton>
        </DialogActions>
      </Dialog>
    </>
  );
};

export const Interactive: Story = {
  name: "Interactive — click through Upload → Draw → Review → Commit",
  args: { ...BASE_ARGS },
  render: () => <InteractiveContent />,
};
