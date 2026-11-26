import React, { useEffect } from "react";

import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { useRouter, useRouterState } from "@tanstack/react-router";

import {
  Button,
  Icon,
  IconName,
  PageHeader,
  Stack,
  Typography,
} from "@portalai/core/ui";

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
import { RouterLink } from "../components/RouterLink.component";
import { StartBoxUI } from "../components/StartBox.component";
import { TagPageBodyUI } from "../components/TagPageBody.component";
import {
  ATTENTION_JOBS,
  FAVORITE_STATIONS,
  RECENT_PORTALS,
  STATIONS,
  TAG_COUNTS,
  TAG_PAGES,
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

/**
 * Stand-in for the tag page #1082 builds, so a click on a tag chip shows
 * what the page lists. Storybook's router has only a root route, so this
 * reads the location the chip navigated to rather than a route match.
 */
const TagPageExample: React.FC<{ tagId: string }> = ({ tagId }) => {
  const tag = TAG_COUNTS.find((t) => t.tag.id === tagId)?.tag;
  return (
    <Stack spacing={4}>
      <PageHeader
        title={tag?.name ?? "Tag"}
        icon={<Icon name={IconName.Label} />}
        primaryAction={
          <Button
            component={RouterLink}
            href="/"
            variant="outlined"
            startIcon={<Icon name={IconName.ArrowBack} />}
          >
            Dashboard
          </Button>
        }
      />
      <TagPageBodyUI groups={TAG_PAGES[tagId] ?? []} />
    </Stack>
  );
};

/** The workbench, or the tag page once a tag chip is clicked. */
const WorkbenchWithTagPages: React.FC<DashboardWorkbenchUIProps> = (props) => {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Each story starts on the dashboard: the router is shared across stories.
  useEffect(() => {
    void router.navigate({ to: "/" });
  }, [router]);
  const tagId = /^\/tags\/([^/]+)$/.exec(pathname)?.[1];
  return tagId ? (
    <TagPageExample tagId={tagId} />
  ) : (
    <DashboardWorkbenchUI {...props} />
  );
};

/**
 * #1123: the whole dashboard workbench, composed from its sections. Click a
 * tag under Browse by tag to see an example of its page.
 */
const meta = {
  title: "Dashboard/DashboardWorkbench",
  component: DashboardWorkbenchUI,
  parameters: { layout: "padded" },
  args: POPULATED,
  render: (args) => <WorkbenchWithTagPages {...args} />,
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
