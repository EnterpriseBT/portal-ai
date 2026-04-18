import React, { useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import MuiButton from "@mui/material/Button";
import Box from "@mui/material/Box";
import type { StepConfig } from "@portalai/core/ui";

import { RegionEditorUI } from "../RegionEditor.component";
import type { RegionEditorStep } from "../RegionEditor.component";
import {
  DEMO_WORKBOOK,
  ENTITY_OPTIONS,
  PROPOSED_REGIONS,
  DRIFT_REGIONS,
} from "./utils/region-editor-fixtures.util";
import type {
  CellBounds,
  EntityOption,
  RegionDraft,
  Workbook,
} from "../utils/region-editor.types";

const STEP_CONFIGS: StepConfig[] = [
  { label: "Draw regions", description: "Outline the data on each sheet" },
  { label: "Review", description: "Confirm bindings and commit" },
];

const meta = {
  title: "Modules/RegionEditor/RegionEditorUI",
  component: RegionEditorUI,
  parameters: { layout: "fullscreen" },
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ padding: 16, display: "flex", flexDirection: "column" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof RegionEditorUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ModeA_Empty: Story = {
  name: "Mode A — empty (fresh upload)",
  args: {
    step: 0,
    stepConfigs: STEP_CONFIGS,
    workbook: DEMO_WORKBOOK,
    regions: [],
    activeSheetId: DEMO_WORKBOOK.sheets[0].id,
    onActiveSheetChange: fn(),
    selectedRegionId: null,
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onInterpret: fn(),
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    onCommit: fn(),
    onBack: fn(),
  },
};

export const ModeA_ProposedOnReview: Story = {
  name: "Mode A — post-interpret review",
  args: {
    step: 1,
    stepConfigs: STEP_CONFIGS,
    workbook: DEMO_WORKBOOK,
    regions: PROPOSED_REGIONS,
    activeSheetId: DEMO_WORKBOOK.sheets[0].id,
    onActiveSheetChange: fn(),
    selectedRegionId: null,
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    overallConfidence: 0.78,
    onInterpret: fn(),
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    onCommit: fn(),
    onBack: fn(),
  },
};

export const ModeB_DriftHalt: Story = {
  name: "Mode B — drift halt (re-enter editor seeded with prior plan)",
  args: {
    step: 0,
    stepConfigs: STEP_CONFIGS,
    workbook: DEMO_WORKBOOK,
    regions: DRIFT_REGIONS,
    activeSheetId: "sheet_crosstab",
    onActiveSheetChange: fn(),
    selectedRegionId: "region_revenue_crosstab_absolute",
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onAcceptProposedIdentity: fn(),
    onKeepPriorIdentity: fn(),
    onInterpret: fn(),
    onRefetchWorkbook: fn(),
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    onCommit: fn(),
    onBack: fn(),
    driftReport: {
      severity: "blocker",
      identityChanging: true,
      fetchedAt: "2026-04-17 09:12 UTC",
      notes: "Records-axis values renamed from short (JAN) to long (January) month labels.",
    },
  },
};

interface InteractiveContentProps {
  workbook: Workbook;
}

const InteractiveContent: React.FC<InteractiveContentProps> = ({ workbook }) => {
  const [step, setStep] = useState<RegionEditorStep>(0);
  const [regions, setRegions] = useState<RegionDraft[]>([]);
  const [activeSheetId, setActiveSheetId] = useState(workbook.sheets[0].id);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [stagedEntities, setStagedEntities] = useState<EntityOption[]>([]);
  const [committedPlan, setCommittedPlan] = useState<{
    regions: RegionDraft[];
    stagedEntities: EntityOption[];
  } | null>(null);

  const entityOptions = useMemo<EntityOption[]>(
    () => [...stagedEntities, ...ENTITY_OPTIONS],
    [stagedEntities]
  );

  const handleCreateEntity = (key: string, label: string) => {
    setStagedEntities((prev) =>
      prev.some((e) => e.value === key)
        ? prev
        : [...prev, { value: key, label, source: "staged" }]
    );
    return key;
  };

  const handleDraft = (draft: { sheetId: string; bounds: CellBounds }) => {
    const id = `region_${Date.now()}`;
    setRegions((prev) => [
      ...prev,
      {
        id,
        sheetId: draft.sheetId,
        bounds: draft.bounds,
        orientation: "rows-as-records",
        headerAxis: "row",
        boundsMode: "absolute",
        targetEntityDefinitionId: null,
      },
    ]);
    setSelectedRegionId(id);
  };

  const handleUpdate = (regionId: string, updates: Partial<RegionDraft>) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === regionId ? { ...r, ...updates } : r))
    );
  };

  const handleDelete = (regionId: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== regionId));
    setSelectedRegionId((sel) => (sel === regionId ? null : sel));
  };

  const handleResize = (regionId: string, nextBounds: CellBounds) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === regionId ? { ...r, bounds: nextBounds } : r))
    );
  };

  const overallConfidence = useMemo(() => {
    if (regions.length === 0) return undefined;
    const scored = regions.filter((r) => r.confidence !== undefined);
    if (scored.length === 0) return 0.8;
    return scored.reduce((sum, r) => sum + (r.confidence ?? 0), 0) / scored.length;
  }, [regions]);

  return (
    <>
      <RegionEditorUI
        step={step}
        stepConfigs={STEP_CONFIGS}
        workbook={workbook}
        regions={regions}
        activeSheetId={activeSheetId}
        onActiveSheetChange={setActiveSheetId}
        selectedRegionId={selectedRegionId}
        onSelectRegion={setSelectedRegionId}
        onRegionDraft={handleDraft}
        onRegionUpdate={handleUpdate}
        onRegionDelete={handleDelete}
        onRegionResize={handleResize}
        entityOptions={entityOptions}
        onCreateEntity={handleCreateEntity}
        onSuggestAxisName={(id) =>
          handleUpdate(id, {
            recordsAxisName: { name: "Month", source: "ai", confidence: 0.82 },
          })
        }
        onInterpret={() => {
          setRegions((prev) =>
            prev.map((r, i) => ({
              ...r,
              confidence: r.confidence ?? 0.7 + (i * 0.07),
            }))
          );
          setStep(1);
        }}
        overallConfidence={overallConfidence}
        onJumpToRegion={(id) => {
          setSelectedRegionId(id);
          setStep(0);
        }}
        onEditBinding={fn()}
        onCommit={() => setCommittedPlan({ regions, stagedEntities })}
        onBack={() => setStep(0)}
      />
      <Dialog
        open={committedPlan !== null}
        onClose={() => setCommittedPlan(null)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Region editor output</DialogTitle>
        <DialogContent dividers>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 2,
              maxHeight: "60vh",
              overflow: "auto",
              fontSize: 12,
              fontFamily: "monospace",
              backgroundColor: "grey.100",
              borderRadius: 1,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {committedPlan ? JSON.stringify(committedPlan, null, 2) : ""}
          </Box>
        </DialogContent>
        <DialogActions>
          <MuiButton onClick={() => setCommittedPlan(null)}>Close</MuiButton>
        </DialogActions>
      </Dialog>
    </>
  );
};

export const Interactive: Story = {
  name: "Interactive — draw, interpret, review",
  args: {
    step: 0,
    stepConfigs: STEP_CONFIGS,
    workbook: DEMO_WORKBOOK,
    regions: [],
    activeSheetId: DEMO_WORKBOOK.sheets[0].id,
    onActiveSheetChange: fn(),
    selectedRegionId: null,
    onSelectRegion: fn(),
    onRegionDraft: fn(),
    onRegionUpdate: fn(),
    onRegionDelete: fn(),
    entityOptions: ENTITY_OPTIONS,
    onInterpret: fn(),
    onJumpToRegion: fn(),
    onEditBinding: fn(),
    onCommit: fn(),
    onBack: fn(),
  },
  render: () => <InteractiveContent workbook={DEMO_WORKBOOK} />,
};
