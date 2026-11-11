import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { ConnectorInstanceSyncFeedbackUI } from "../components/ConnectorInstanceSyncFeedback.component";

const meta = {
  title: "Components/ConnectorInstanceSyncFeedbackUI",
  component: ConnectorInstanceSyncFeedbackUI,
  args: {
    jobStatus: "completed",
    progress: 100,
    recordCounts: { created: 2, updated: 5, unchanged: 40, deleted: 20 },
    errorMessage: null,
    onDismissResult: fn(),
  },
} satisfies Meta<typeof ConnectorInstanceSyncFeedbackUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = { name: "Sync complete" };

const warnings = [
  {
    kind: "bounds-overflow" as const,
    regionId: "r1",
    sheet: "Q3",
    targetEntityDefinitionId: "contacts",
    targetEntityLabel: "Contacts",
    bounds: { startRow: 2, startCol: 2, endRow: 100, endCol: 6 },
    sheetLastRow: 80,
    sheetLastCol: 8,
    recordsAxis: "row" as const,
  },
  {
    kind: "sheet-missing" as const,
    regionId: "r2",
    sheet: "Q4",
    targetEntityDefinitionId: "deals",
    targetEntityLabel: "Deals",
    bounds: { startRow: 2, startCol: 2, endRow: 40, endCol: 6 },
    recordsAxis: "row" as const,
  },
];

/** #1009: the sync read past a sheet and skipped a missing one. */
export const WithReplayWarnings: Story = {
  name: "Sync complete with replay warnings (#1009)",
  args: {
    replayWarnings: warnings,
    editLayoutPlanLink: { connectorInstanceId: "ci-1" },
  },
};

/** #1009: the same, for a caller who can't modify the plan (no link). */
export const WithReplayWarningsNoLink: Story = {
  name: "Replay warnings, no edit access (#1009)",
  args: { replayWarnings: warnings, replayWarningsOmitted: 2 },
};
