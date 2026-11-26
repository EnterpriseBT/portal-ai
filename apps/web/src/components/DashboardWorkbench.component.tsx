import React from "react";

import {
  Icon,
  IconName,
  PageGrid,
  PageGridItem,
  PageHeader,
  Stack,
} from "@portalai/core/ui";

import { WorkbenchSectionUI } from "./WorkbenchSection.component";

export interface DashboardWorkbenchUIProps {
  /** The header's trailing action, e.g. Open Portal until the start box lands. */
  headerAction?: React.ReactNode;
  /** Shown under the title: the API health check. */
  headerContent?: React.ReactNode;
  /** Each part's body. A part whose slot is omitted isn't rendered, so the
   *  page can be wired one section at a time (#1078 to #1083). */
  start?: React.ReactNode;
  stations?: React.ReactNode;
  pins?: React.ReactNode;
  recent?: React.ReactNode;
  tags?: React.ReactNode;
  attention?: React.ReactNode;
}

const FULL = { xs: 1, md: 5 };

/**
 * The dashboard workbench (#1123): the page's one `h1`, the start box (a
 * named form, so it needs no heading of its own), then the sections as
 * `h2`s. Favorite stations and pins take full rows. Below them, Recent
 * portals with Browse by tag under it fill the left three fifths, and Needs
 * attention runs down the right beside both. Everything stacks at phone
 * width, in that reading order. Sections that show favorites link to their
 * list's page (#1078); Recent portals has no list page.
 */
export const DashboardWorkbenchUI: React.FC<DashboardWorkbenchUIProps> = ({
  headerAction,
  headerContent,
  start,
  stations,
  pins,
  recent,
  tags,
  attention,
}) => {
  const hasLeft = recent !== undefined || tags !== undefined;
  const hasRight = attention !== undefined;

  return (
    <Stack spacing={4}>
      <PageHeader
        breadcrumbs={[{ label: "Home" }]}
        title="Dashboard"
        icon={<Icon name={IconName.Home} />}
        primaryAction={headerAction}
      >
        {headerContent}
      </PageHeader>
      <PageGrid columns={{ xs: 1, md: 5 }}>
        {start !== undefined && (
          <PageGridItem span={FULL}>{start}</PageGridItem>
        )}
        {stations !== undefined && (
          <PageGridItem span={FULL}>
            <WorkbenchSectionUI
              title="Favorite stations"
              icon={<Icon name={IconName.SatelliteAlt} />}
              seeAll={{ href: "/stations", label: "All stations" }}
            >
              {stations}
            </WorkbenchSectionUI>
          </PageGridItem>
        )}
        {pins !== undefined && (
          <PageGridItem span={FULL}>
            <WorkbenchSectionUI
              title="Favorite pins"
              icon={<Icon name={IconName.PushPin} />}
              seeAll={{ href: "/portal-results", label: "All pinned results" }}
            >
              {pins}
            </WorkbenchSectionUI>
          </PageGridItem>
        )}
        {hasLeft && (
          <PageGridItem
            span={hasRight ? { xs: 1, md: 3 } : FULL}
            data-testid="workbench-recent-and-tags"
          >
            <Stack spacing={3}>
              {recent !== undefined && (
                <WorkbenchSectionUI
                  title="Recent portals"
                  icon={<Icon name={IconName.Portal} />}
                >
                  {recent}
                </WorkbenchSectionUI>
              )}
              {tags !== undefined && (
                <WorkbenchSectionUI
                  title="Browse by tag"
                  icon={<Icon name={IconName.Label} />}
                  seeAll={{ href: "/tags", label: "All tags" }}
                >
                  {tags}
                </WorkbenchSectionUI>
              )}
            </Stack>
          </PageGridItem>
        )}
        {hasRight && (
          <PageGridItem
            span={hasLeft ? { xs: 1, md: 2 } : FULL}
            data-testid="workbench-attention"
          >
            <WorkbenchSectionUI
              title="Needs attention"
              icon={<Icon name={IconName.Work} />}
              seeAll={{ href: "/jobs", label: "All jobs" }}
            >
              {attention}
            </WorkbenchSectionUI>
          </PageGridItem>
        )}
      </PageGrid>
    </Stack>
  );
};
