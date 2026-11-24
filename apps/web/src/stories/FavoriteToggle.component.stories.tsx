import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { FavoriteToggleUI } from "../components/FavoriteToggle.component";

const meta = {
  title: "Components/FavoriteToggle",
  component: FavoriteToggleUI,
  parameters: { layout: "centered" },
  args: { name: "Sales", isFavorite: false, pending: false, onToggle: fn() },
} satisfies Meta<typeof FavoriteToggleUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NotFavorite: Story = {};

export const Favorite: Story = { args: { isFavorite: true } };

export const Saving: Story = { args: { isFavorite: true, pending: true } };
