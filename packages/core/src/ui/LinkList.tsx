import React from "react";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export interface LinkListItem {
  id: string;
  href: string;
  /** The item's name, and the start of its link's name. */
  primary: string;
  /** A short detail at the trailing edge: a type, a station, a time. */
  secondary?: string;
  /** A decorative icon before the name. Say what it means in `secondary`. */
  icon?: React.ReactNode;
}

export interface LinkListProps {
  /** The list's accessible name, e.g. "Recent portals". */
  "aria-label": string;
  items: LinkListItem[];
  /** The router's link (`RouterLink` in the web app); core can't import the
   *  router. Defaults to a plain `<a>`. */
  linkComponent?: React.ElementType;
  id?: string;
}

/**
 * A compact list of links, one line each (#1123): an optional icon, the name,
 * and a short detail at the trailing edge. For lists where a card per item
 * would waste space, like the dashboard's recent portals.
 */
export const LinkList: React.FC<LinkListProps> = ({
  "aria-label": ariaLabel,
  items,
  linkComponent = "a",
  id,
}) => (
  <List aria-label={ariaLabel} id={id} disablePadding dense>
    {items.map((item, i) => (
      <ListItem key={item.id} disablePadding divider={i < items.length - 1}>
        <ListItemButton component={linkComponent} href={item.href}>
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            flex={1}
            minWidth={0}
          >
            {item.icon && (
              <Box
                aria-hidden
                display="flex"
                color="text.secondary"
                fontSize="1.25rem"
              >
                {item.icon}
              </Box>
            )}
            <Box flex={1} minWidth={0}>
              <Typography variant="body2" noWrap>
                {item.primary}
              </Typography>
            </Box>
            {item.secondary && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {item.secondary}
              </Typography>
            )}
          </Stack>
        </ListItemButton>
      </ListItem>
    ))}
  </List>
);

export default LinkList;
