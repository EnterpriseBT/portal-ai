import React, { useEffect, useId } from "react";

import {
  Box,
  EmptyState,
  Icon,
  IconName,
  LinkList,
  Stack,
  StatusMessage,
  Typography,
} from "@portalai/core/ui";

import { RouterLink } from "./RouterLink.component";
import {
  TagCountChipUI,
  type TagCountChipUIProps,
} from "./TagCountChip.component";
import { emptyListHelp } from "../utils/empty-list-help.util";

/** The kinds of object a tag can be on. */
export type TaggedType = "station" | "pin" | "view" | "connector" | "entity";

/** One object that carries the selected tag. */
export interface TagMatch {
  id: string;
  name: string;
  type: TaggedType;
  /** The object's own page. */
  href: string;
}

/** Each type's name and icon, the same icons as the sidebar. */
const TYPES: Record<TaggedType, { label: string; icon: IconName }> = {
  station: { label: "Station", icon: IconName.SatelliteAlt },
  pin: { label: "Pinned result", icon: IconName.PushPin },
  view: { label: "View", icon: IconName.Layers },
  connector: { label: "Connector", icon: IconName.MemoryChip },
  entity: { label: "Entity", icon: IconName.DataObject },
};

export interface BrowseByTagUIProps {
  /** In the order to show them. */
  tags: Pick<TagCountChipUIProps, "tag" | "count">[];
  /** The tag whose matches are showing, or null. */
  selectedTagId: string | null;
  /** Called with a tag to show its matches, or null to hide them. */
  onSelectTag: (tagId: string | null) => void;
  /** The selected tag's matches, once loaded: the current page of them. */
  matches?: TagMatch[];
  matchesStatus?: "loading" | "error" | "ready";
  /** Search and paging for the matches, shown above them while a tag is
   *  selected: the container's `<PaginationToolbar {...toolbarProps} />`,
   *  as every list does. */
  matchesToolbar?: React.ReactNode;
  /** The matches are narrowed by a search, so an empty page means nothing
   *  matched it rather than nothing carrying the tag. */
  matchesFiltered?: boolean;
}

/**
 * The dashboard's Browse by tag (#1123): each tag with its count. Pressing a
 * tag lists the objects that carry it, each with its type's icon, under the
 * tags, with a search box and paging above them; pressing it again hides
 * them. With no tags, a teaching empty state.
 */
export const BrowseByTagUI: React.FC<BrowseByTagUIProps> = ({
  tags,
  selectedTagId,
  onSelectTag,
  matches = [],
  matchesStatus = "ready",
  matchesToolbar,
  matchesFiltered = false,
}) => {
  const listId = useId();
  const selected = tags.find((t) => t.tag.id === selectedTagId)?.tag ?? null;

  // A selected tag that's no longer listed (deleted, or no longer readable)
  // isn't a selection: say so, so the container stops paging its matches.
  useEffect(() => {
    if (selectedTagId !== null && selected === null) onSelectTag(null);
  }, [selectedTagId, selected, onSelectTag]);

  if (tags.length === 0) {
    return (
      <EmptyState
        icon={<Icon name={IconName.Label} />}
        title="No tags yet"
        {...emptyListHelp("tags")}
      />
    );
  }

  const handleToggle = (tagId: string) =>
    onSelectTag(tagId === selectedTagId ? null : tagId);

  return (
    <Stack spacing={2}>
      <Stack
        role="list"
        aria-label="Tags"
        direction="row"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
      >
        {tags.map((item) => (
          <Box role="listitem" key={item.tag.id}>
            <TagCountChipUI
              {...item}
              selected={item.tag.id === selectedTagId}
              onToggle={handleToggle}
              controls={listId}
            />
          </Box>
        ))}
      </Stack>
      {selected && (
        <Stack id={listId} spacing={1}>
          {matchesToolbar}
          {matchesStatus === "loading" && (
            <StatusMessage
              loading
              message={`Loading items tagged ${selected.name}…`}
            />
          )}
          {matchesStatus === "error" && (
            <StatusMessage
              variant="error"
              message={`Couldn't load the items tagged ${selected.name}.`}
            />
          )}
          {matchesStatus === "ready" && matches.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {matchesFiltered
                ? `No items tagged ${selected.name} match your search.`
                : "Nothing you can see has this tag."}
            </Typography>
          )}
          {matchesStatus === "ready" && matches.length > 0 && (
            <LinkList
              aria-label={`Tagged ${selected.name}`}
              linkComponent={RouterLink}
              items={matches.map((match) => ({
                id: `${match.type}-${match.id}`,
                href: match.href,
                primary: match.name,
                secondary: TYPES[match.type].label,
                icon: <Icon name={TYPES[match.type].icon} fontSize="inherit" />,
              }))}
            />
          )}
        </Stack>
      )}
    </Stack>
  );
};
