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
  /** Shown under the title: the health check and default-station line. */
  headerContent?: React.ReactNode;
  /** Each section's body. A section whose slot is omitted isn't rendered,
   *  so the page can be wired one section at a time (#1078 to #1083). */
  start?: React.ReactNode;
  stations?: React.ReactNode;
  pins?: React.ReactNode;
  recent?: React.ReactNode;
  tags?: React.ReactNode;
  attention?: React.ReactNode;
}

/**
 * The dashboard workbench (#1123): the page's one `h1`, then its sections as
 * `h2`s in the workbench order. The start box, favorite stations and pins
 * take full rows; Recent portals, Browse by tag and Needs attention share the
 * last row on wide screens and stack on narrow ones. Sections that show
 * favorites link to their list's page (#1078); Recent portals has no list
 * page, so no "see all".
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
  const full = { xs: 1, md: 3 };
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
      <PageGrid columns={{ xs: 1, md: 3 }}>
        {start !== undefined && (
          <PageGridItem span={full}>
            <WorkbenchSectionUI
              title="Start a portal"
              icon={<Icon name={IconName.Portal} />}
            >
              {start}
            </WorkbenchSectionUI>
          </PageGridItem>
        )}
        {stations !== undefined && (
          <PageGridItem span={full}>
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
          <PageGridItem span={full}>
            <WorkbenchSectionUI
              title="Favorite pins"
              icon={<Icon name={IconName.PushPin} />}
              seeAll={{ href: "/portal-results", label: "All pinned results" }}
            >
              {pins}
            </WorkbenchSectionUI>
          </PageGridItem>
        )}
        {recent !== undefined && (
          <PageGridItem>
            <WorkbenchSectionUI
              title="Recent portals"
              icon={<Icon name={IconName.Portal} />}
            >
              {recent}
            </WorkbenchSectionUI>
          </PageGridItem>
        )}
        {tags !== undefined && (
          <PageGridItem>
            <WorkbenchSectionUI
              title="Browse by tag"
              icon={<Icon name={IconName.Label} />}
              seeAll={{ href: "/tags", label: "All tags" }}
            >
              {tags}
            </WorkbenchSectionUI>
          </PageGridItem>
        )}
        {attention !== undefined && (
          <PageGridItem>
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
