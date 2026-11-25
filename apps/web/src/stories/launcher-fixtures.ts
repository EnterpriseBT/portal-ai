import { fn } from "@storybook/test";

import type { LauncherItem, PaletteGroup } from "../utils/launcher-items.util";

/** Example launcher data for the #1122 stories. */

export const FINANCE = { id: "t-fin", name: "finance", color: "#2563EB" };
export const EXEC = { id: "t-exec", name: "exec", color: "#B7791F" };

export const FAVORITES: LauncherItem[] = [
  {
    id: "s1",
    type: "station",
    name: "Finance Close",
    href: "/stations/s1",
    tags: [FINANCE],
  },
  {
    id: "s2",
    type: "station",
    name: "Field Inspections",
    href: "/stations/s2",
  },
  {
    id: "p1",
    type: "pin",
    name: "Q3 variance by region",
    href: "/portal-results/p1",
    tags: [FINANCE, EXEC],
  },
  {
    id: "v1",
    type: "curated_view",
    name: "GL Accounts",
    href: "/views/v1",
    tags: [FINANCE],
  },
  {
    id: "c1",
    type: "connector_instance",
    name: "NetSuite export",
    href: "/connectors/c1",
  },
];

export const RECENT: LauncherItem[] = [
  { id: "e1", type: "entity", name: "Customers", href: "/entities/e1" },
  {
    id: "v2",
    type: "curated_view",
    name: "Active customers",
    href: "/views/v2",
  },
];

export const ACTIONS: PaletteGroup = {
  label: "Actions",
  entries: [
    {
      kind: "action",
      id: "new-portal",
      label: "New portal in Finance Close",
      onSelect: fn(),
    },
    { kind: "action", id: "new-station", label: "New station", onSelect: fn() },
    { kind: "action", id: "import", label: "Import a file", onSelect: fn() },
    {
      kind: "action",
      id: "invite",
      label: "Invite a member",
      onSelect: fn(),
      gate: { kind: "disable", reason: "Needs member.invite" },
    },
  ],
};

export const asEntries = (items: LauncherItem[]) =>
  items.map((item) => ({ kind: "item" as const, ...item }));
