import type { Meta, StoryObj } from "@storybook/react";

import { FavoritesEmptyResults } from "../components/FavoritesEmptyResults.component";

const meta = {
  title: "Components/FavoritesEmptyResults",
  component: FavoritesEmptyResults,
  parameters: { layout: "centered" },
  args: { noun: "station" },
} satisfies Meta<typeof FavoritesEmptyResults>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Stations: Story = {};

export const Views: Story = { args: { noun: "view" } };
