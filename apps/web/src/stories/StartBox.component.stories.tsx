import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, userEvent, within } from "@storybook/test";

import { StartBoxUI } from "../components/StartBox.component";
import { STATIONS } from "./dashboard-fixtures";

/** #1123: type a question, pick a station, start a portal. */
const meta = {
  title: "Dashboard/StartBox",
  component: StartBoxUI,
  parameters: { layout: "padded" },
  args: {
    stations: STATIONS,
    initialStationId: "s1",
    pending: false,
    serverError: null,
    onStart: fn(),
  },
} satisfies Meta<typeof StartBoxUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};
/** Nothing preselected: Start says to pick one. */
export const PickAStation: Story = { args: { initialStationId: null } };
export const Pending: Story = { args: { pending: true } };
export const InlineError: Story = {
  args: {
    serverError: {
      message: "The station couldn't start a portal. Try again.",
      code: "PORTAL_CREATE_FAILED",
    },
  },
};
export const DisabledWithReason: Story = {
  args: {
    gate: { kind: "disable", reason: "Ask for access to start portals" },
  },
};
export const Upsell: Story = {
  args: {
    gate: {
      kind: "upsell",
      reason: "Your plan's portal sessions are used up for this period",
      onUpgrade: fn(),
    },
  },
};

/** #1079: a question over the 20,000-character message limit is refused on
 *  Start, shown under the field and kept, never cut. */
export const QuestionTooLong: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Ask a question" });
    await userEvent.click(field);
    await userEvent.paste("a".repeat(20_001));
    await userEvent.click(canvas.getByRole("button", { name: "Start" }));
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(args.onStart).not.toHaveBeenCalled();
  },
};

/** #1079: the picker searches every station the caller can see. */
export const WithStationSearch: Story = {
  args: {
    initialStationId: null,
    stationSearch: {
      query: "",
      onQueryChange: fn(),
      results: [],
      searching: false,
    },
  },
};
