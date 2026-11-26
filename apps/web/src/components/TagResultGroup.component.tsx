import React from "react";

import { CardList, DetailCard, Typography } from "@portalai/core/ui";

import { RouterLink } from "./RouterLink.component";
import { WorkbenchSectionUI } from "./WorkbenchSection.component";

/** One object carrying the tag. */
export interface TagResultItem {
  id: string;
  name: string;
  /** The object's own page. */
  href: string;
}

export interface TagResultGroupUIProps {
  /** The object type, plural: "Stations", "Pinned results". */
  title: string;
  icon?: React.ReactNode;
  /** The first few tagged objects of this type. */
  items: TagResultItem[];
  /** How many of this type carry the tag in all. */
  total: number;
  /** This type's list, filtered to the tag. */
  viewAllHref: string;
}

/**
 * One type's results on a tag's page (#1123): its first few tagged objects
 * as links, and "View all" to its list filtered to the tag. An empty group
 * says so rather than disappearing, so every type reads the same way.
 */
export const TagResultGroupUI: React.FC<TagResultGroupUIProps> = ({
  title,
  icon,
  items,
  total,
  viewAllHref,
}) => {
  const type = title.toLowerCase();
  return (
    <WorkbenchSectionUI
      title={title}
      icon={icon}
      seeAll={
        total > 0
          ? { href: viewAllHref, label: `View all ${total} ${type}` }
          : undefined
      }
    >
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No {type} have this tag.
        </Typography>
      ) : (
        <CardList aria-label={title}>
          {items.map((item) => (
            <DetailCard
              key={item.id}
              title={item.name}
              href={item.href}
              linkComponent={RouterLink}
              headingLevel={3}
            />
          ))}
        </CardList>
      )}
    </WorkbenchSectionUI>
  );
};
