import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { CommandPaletteUI } from "../components/CommandPalette.component";
import { RouterLink } from "../components/RouterLink.component";
import { ACTIONS, FAVORITES, RECENT, asEntries } from "./launcher-fixtures";

/**
 * #1122: the command palette, from props. Arrows move, Enter runs an
 * action or opens a link (the story's router), Escape closes. The query is
 * held by the story; filtering and searching are #1076's.
 */
const meta = {
  title: "Launcher/CommandPalette",
  component: CommandPaletteUI,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    onClose: fn(),
    query: "",
    onQueryChange: fn(),
    linkComponent: RouterLink,
    groups: [
      ACTIONS,
      { label: "Favorites", entries: asEntries(FAVORITES) },
      { label: "Recent", entries: asEntries(RECENT) },
    ],
  },
  render: function Render(args) {
    const [query, setQuery] = React.useState(args.query);
    return (
      <CommandPaletteUI
        {...args}
        query={query}
        onQueryChange={(value) => {
          setQuery(value);
          args.onQueryChange(value);
        }}
      />
    );
  },
} satisfies Meta<typeof CommandPaletteUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** `#finance`: everything carrying that tag, across types, plus an action. */
export const TagQuery: Story = {
  args: {
    query: "#fin",
    groups: [
      {
        label: "Tagged “finance”",
        entries: asEntries(FAVORITES.filter((item) => item.tags?.length)),
      },
      {
        label: "Actions",
        entries: [ACTIONS.entries[0]],
      },
    ],
  },
};

/** Search results labelled by type. */
export const SearchResults: Story = {
  args: {
    query: "cust",
    groups: [
      { label: "Entities", entries: asEntries([RECENT[0]]) },
      { label: "Views", entries: asEntries([RECENT[1]]) },
    ],
  },
};

export const Loading: Story = {
  args: { query: "fin", groups: [], loading: true },
};

export const NoResults: Story = { args: { query: "zzz", groups: [] } };

/** A new user: nothing favorited or recent yet. */
export const Empty: Story = { args: { groups: [ACTIONS] } };

export const NothingAtAll: Story = { args: { groups: [] } };

export const LongNames: Story = {
  args: {
    groups: [
      {
        label: "Favorites",
        entries: asEntries([
          {
            id: "s9",
            type: "station",
            name: "Quarterly revenue reconciliation for EMEA channel partners",
            href: "/stations/s9",
            tags: [
              { id: "a", name: "a", color: "#2563EB" },
              { id: "b", name: "b", color: "#B7791F" },
              { id: "c", name: "c", color: "#1F7A4D" },
            ],
          },
        ]),
      },
    ],
  },
};

export const ManyRows: Story = {
  args: {
    groups: [
      {
        label: "Stations",
        entries: asEntries(
          Array.from({ length: 30 }, (_, i) => ({
            id: `s${i}`,
            type: "station" as const,
            name: `Station ${i + 1}`,
            href: `/stations/s${i}`,
          }))
        ),
      },
    ],
  },
};

/** #1076: a failed search keeps the actions. */
export const SearchFailed: Story = {
  args: {
    query: "sales",
    groups: [ACTIONS],
    errorMessage: "Couldn’t search. Try again.",
  },
};
