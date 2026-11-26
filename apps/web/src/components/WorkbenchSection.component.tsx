import React from "react";

import { Button, Icon, IconName, PageSection } from "@portalai/core/ui";

import { RouterLink } from "./RouterLink.component";

export interface WorkbenchSectionUIProps {
  /** The section's heading, an `h2` under the dashboard's `h1`. */
  title: string;
  icon?: React.ReactNode;
  /**
   * The section's "see all" link. Its label names what it opens
   * ("All stations"), so several sections' links stay distinct.
   */
  seeAll?: { href: string; label: string };
  children: React.ReactNode;
  [key: `data-${string}`]: string;
}

/**
 * One dashboard workbench section (#1123): a titled `PageSection` with an
 * optional "see all" link at the trailing edge of its title row. The link
 * navigates, so it renders through the router as a link, not a button.
 */
export const WorkbenchSectionUI: React.FC<WorkbenchSectionUIProps> = ({
  title,
  icon,
  seeAll,
  children,
  ...rest
}) => (
  <PageSection
    title={title}
    icon={icon}
    primaryAction={
      seeAll ? (
        <Button
          component={RouterLink}
          href={seeAll.href}
          variant="text"
          size="small"
          endIcon={<Icon name={IconName.ArrowForward} />}
        >
          {seeAll.label}
        </Button>
      ) : undefined
    }
    {...rest}
  >
    {children}
  </PageSection>
);
