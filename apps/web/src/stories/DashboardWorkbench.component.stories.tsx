import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import { Typography } from "@portalai/core/ui";

import {
  DashboardWorkbenchUI,
  type DashboardWorkbenchUIProps,
} from "../components/DashboardWorkbench.component";
import { BrowseByTagUI } from "../components/BrowseByTag.component";
import { DashboardRecentPortalsUI } from "../components/DashboardRecentPortals.component";
import {
  FavoritePinsUI,
  type FavoritePinItem,
} from "../components/FavoritePins.component";
import { FavoriteStationsUI } from "../components/FavoriteStations.component";
import { NeedsAttentionUI } from "../components/NeedsAttention.component";
import { StartBoxUI } from "../components/StartBox.component";
import {
  ATTENTION_JOBS,
  FAVORITE_STATIONS,
  RECENT_PORTALS,
  STATIONS,
  TAG_COUNTS,
} from "./dashboard-fixtures";
import {
  FixtureChart,
  FixtureMap,
  FixtureTable,
} from "./dashboard-tile-fixtures";

const PINS: FavoritePinItem[] = [
  {
    pin: { id: "r1", title: "Q3 variance by region" },
    status: "ready",
    content: <FixtureChart />,
  },
  {
    pin: { id: "r2", title: "Open inspections by county" },
    status: "ready",
    content: <FixtureTable />,
  },
  {
    pin: { id: "r3", title: "Inspection sites" },
    status: "ready",
    content: <FixtureMap />,
  },
];

const header = (
  <Typography variant="body2" color="text.secondary">
    Default station: Finance Close
  </Typography>
);

const startBox = (stationId: string | null) => (
  <StartBoxUI
    stations={STATIONS}
    initialStationId={stationId}
    pending={false}
    serverError={null}
    onStart={fn()}
  />
);

const POPULATED: DashboardWorkbenchUIProps = {
  headerContent: header,
  start: startBox("s1"),
  stations: <FavoriteStationsUI items={FAVORITE_STATIONS} onLaunch={fn()} />,
  pins: <FavoritePinsUI pins={PINS} onRetry={fn()} />,
  recent: <DashboardRecentPortalsUI portals={RECENT_PORTALS} />,
  tags: <BrowseByTagUI tags={TAG_COUNTS} />,
  attention: <NeedsAttentionUI jobs={ATTENTION_JOBS} />,
};

/** A brand-new org: every section shows its teaching empty state. */
const NEW_ORG: DashboardWorkbenchUIProps = {
  start: startBox(null),
  stations: <FavoriteStationsUI items={[]} onLaunch={fn()} />,
  pins: <FavoritePinsUI pins={[]} />,
  recent: <DashboardRecentPortalsUI portals={[]} />,
  tags: <BrowseByTagUI tags={[]} />,
  attention: <NeedsAttentionUI jobs={[]} />,
};

/** Some sections full, some empty, a tile loading and one failed. */
const MIXED: DashboardWorkbenchUIProps = {
  ...POPULATED,
  stations: <FavoriteStationsUI items={[]} onLaunch={fn()} />,
  pins: (
    <FavoritePinsUI
      pins={[
        PINS[0],
        { pin: { id: "r4", title: "Churn drivers" }, status: "loading" },
        { pin: { id: "r5", title: "Late shipments" }, status: "error" },
      ]}
      onRetry={fn()}
    />
  ),
  recent: <DashboardRecentPortalsUI portals={RECENT_PORTALS.slice(0, 2)} />,
  attention: <NeedsAttentionUI jobs={[]} />,
};

/** #1123: the whole dashboard workbench, composed from its sections. */
const meta = {
  title: "Dashboard/DashboardWorkbench",
  component: DashboardWorkbenchUI,
  parameters: { layout: "padded" },
  args: POPULATED,
} satisfies Meta<typeof DashboardWorkbenchUI>;

export default meta;
type Story = StoryObj<typeof meta>;

const dark = { globals: { theme: "brand.dark" } };
const phone = { parameters: { viewport: { defaultViewport: "mobile1" } } };

export const Populated: Story = {};
export const NewOrg: Story = { args: NEW_ORG };
export const Mixed: Story = { args: MIXED };
/** The bottom row stacks at phone width. */
export const Phone: Story = { ...phone };

export const PopulatedDark: Story = { ...dark };
export const NewOrgDark: Story = { args: NEW_ORG, ...dark };
export const MixedDark: Story = { args: MIXED, ...dark };
export const PhoneDark: Story = { ...phone, ...dark };
