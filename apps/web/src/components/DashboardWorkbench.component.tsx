import React from "react";

import {
  Icon,
  IconName,
  PageGrid,
  PageGridItem,
  PageHeader,
  PageSectionGroup,
  Stack,
} from "@portalai/core/ui";

import { WorkbenchSectionUI } from "./WorkbenchSection.component";

export interface DashboardWorkbenchUIProps {
  /** The header's trailing action, e.g. Open Portal until the start box lands. */
  headerAction?: React.ReactNode;
  /** Shown under the title: the health check and default-station line. */
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

/** Five columns on a wide screen: full rows span all five, and the last row
 *  splits three to two, Recent portals beside tags and attention. */
const FULL = { xs: 1, md: 5 };

/**
 * The dashboard workbench (#1123): the page's one `h1`, the start box (a
 * named form, so it needs no heading of its own), then the sections as
 * `h2`s. Favorite stations and pins take full rows; Recent portals shares
 * the last row with Browse by tag and Needs attention, which sit together in
 * one frame. Everything stacks at phone width. Sections that show favorites
 * link to their list's page (#1078); Recent portals has no list page.
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
  const tagsSection = tags !== undefined && (
    <WorkbenchSectionUI
      title="Browse by tag"
      icon={<Icon name={IconName.Label} />}
      seeAll={{ href: "/tags", label: "All tags" }}
      variant="plain"
    >
      {tags}
    </WorkbenchSectionUI>
  );
  const attentionSection = attention !== undefined && (
    <WorkbenchSectionUI
      title="Needs attention"
      icon={<Icon name={IconName.Work} />}
      seeAll={{ href: "/jobs", label: "All jobs" }}
      variant="plain"
    >
      {attention}
    </WorkbenchSectionUI>
  );
  const sideBySide = recent !== undefined;

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
        {recent !== undefined && (
          <PageGridItem span={{ xs: 1, md: 3 }}>
            <WorkbenchSectionUI
              title="Recent portals"
              icon={<Icon name={IconName.Portal} />}
            >
              {recent}
            </WorkbenchSectionUI>
          </PageGridItem>
        )}
        {(tagsSection || attentionSection) && (
          <PageGridItem span={sideBySide ? { xs: 1, md: 2 } : FULL}>
            <PageSectionGroup>
              {tagsSection}
              {attentionSection}
            </PageSectionGroup>
          </PageGridItem>
        )}
      </PageGrid>
    </Stack>
  );
};
