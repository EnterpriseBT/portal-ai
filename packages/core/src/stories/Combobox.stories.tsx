import React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { Combobox } from "../ui/Combobox";
import type { ComboboxOption } from "../ui/Combobox";
import { Icon, IconName } from "../ui/Icon";
import { Modal } from "../ui/Modal";
import { Typography } from "../ui/Typography";

/**
 * #1122: a search input over a list that's always shown, the shell for a
 * command palette. Arrows, Home/End move the highlight; Enter runs an
 * action or follows a link. Filtering is the caller's (here, the story's).
 */
const followLink = fn();

/** Stands in for the app's router link: logs instead of navigating. */
const StoryLink = React.forwardRef<
  HTMLAnchorElement,
  React.AnchorHTMLAttributes<HTMLAnchorElement>
>(({ onClick, ...props }, ref) => (
  <a
    ref={ref}
    {...props}
    onClick={(event) => {
      onClick?.(event);
      event.preventDefault();
      followLink(props.href);
    }}
  />
));

const OPTIONS: ComboboxOption[] = [
  { id: "new", label: "New portal", group: "Actions", onSelect: fn() },
  { id: "station", label: "New station", group: "Actions", onSelect: fn() },
  {
    id: "invite",
    label: "Invite a member",
    group: "Actions",
    onSelect: fn(),
    gate: { kind: "disable", reason: "Needs member.invite" },
  },
  { id: "st-1", label: "Sales Ops", group: "Favorites", href: "/stations/1" },
  {
    id: "pin-1",
    label: "Q3 pipeline",
    group: "Favorites",
    href: "/portal-results/1",
  },
  {
    id: "view-1",
    label: "Active customers",
    group: "Recent",
    href: "/views/1",
  },
];

const ICONS: Record<string, IconName> = {
  Actions: IconName.Add,
  Favorites: IconName.Star,
  Recent: IconName.Refresh,
};

const Playground = ({
  options = OPTIONS,
  statusOverride,
}: {
  options?: ComboboxOption[];
  statusOverride?: string;
}) => {
  const [value, setValue] = React.useState("");
  const shown = options.filter((o) =>
    o.label.toLowerCase().includes(value.toLowerCase())
  );
  return (
    <Combobox
      options={shown}
      inputValue={value}
      onInputChange={setValue}
      label="Search and actions"
      placeholder="Search or run an action…"
      statusText={
        statusOverride ??
        `${shown.length} ${shown.length === 1 ? "result" : "results"}`
      }
      linkComponent={StoryLink}
      renderOption={(option) => (
        <>
          <Icon
            name={ICONS[option.group ?? ""] ?? IconName.Search}
            fontSize="small"
          />
          <span>{option.label}</span>
          {option.gate?.kind === "disable" && (
            // The shell reads the reason as the option's description.
            <Typography variant="caption" color="text.secondary" aria-hidden>
              {option.gate.reason}
            </Typography>
          )}
        </>
      )}
      emptyContent={
        <Typography sx={{ p: 2 }} color="text.secondary">
          Nothing matches “{value}”.
        </Typography>
      }
    />
  );
};

const meta = {
  title: "Components/Combobox",
  component: Playground,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Playground>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Grouped: Story = {};

export const Ungrouped: Story = {
  args: { options: OPTIONS.map(({ group: _group, ...o }) => o) },
};

export const Empty: Story = { args: { options: [] } };

export const ManyOptions: Story = {
  args: {
    options: Array.from({ length: 40 }, (_, i) => ({
      id: `st-${i}`,
      label: `Station ${i + 1}`,
      group: i < 5 ? "Favorites" : "Stations",
      href: `/stations/${i}`,
    })),
  },
};

/** Hosted the way the command palette hosts it: Escape closes the dialog. */
export const InADialog: Story = {
  render: (args) => (
    <Modal
      open
      onClose={fn()}
      aria-label="Search and actions"
      maxWidth="sm"
      fullWidth
    >
      <Playground {...args} />
    </Modal>
  ),
};
