import React, { useId, useRef, useState } from "react";

import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Popover from "@mui/material/Popover";
import TextField from "@mui/material/TextField";

import { Icon, IconName } from "@portalai/core/ui";

/** A station the start box can start a portal in. */
export interface StationOption {
  id: string;
  name: string;
  /** Starred by the caller. Favorites are listed first. */
  favorite: boolean;
}

/** #1079: searching every station the caller can see, beyond `stations`. */
export interface StationSearch {
  query: string;
  onQueryChange: (query: string) => void;
  /** The stations matching a typed `query`. */
  results: StationOption[];
  /** A search for `query` is in flight. */
  searching: boolean;
}

export interface StationPickerUIProps {
  stations: StationOption[];
  /** The chosen station, or null when there's none yet. */
  selectedId: string | null;
  onSelect: (stationId: string) => void;
  /** Adds a "Search stations" field above the list. Without it, the menu
   *  lists `stations` only. */
  search?: StationSearch;
}

/**
 * The start box's station chip and its menu (#1123). The chip shows the
 * chosen station, or "Pick a station" when there's none. The menu lists
 * favorite stations first, each marked with a star, then the rest.
 */
export const StationPickerUI: React.FC<StationPickerUIProps> = ({
  stations,
  selectedId,
  onSelect,
  search,
}) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const open = anchor !== null;

  const selected =
    stations.find((s) => s.id === selectedId) ??
    search?.results.find((s) => s.id === selectedId) ??
    null;
  // A typed query lists its results; otherwise the loaded stations.
  const searchingByQuery = search !== undefined && search.query.trim() !== "";
  const listed = searchingByQuery ? search.results : stations;
  const favorites = listed.filter((s) => s.favorite);
  const others = listed.filter((s) => !s.favorite);

  // A closed picker forgets its search (#1137 code review), so it reopens
  // on the favorites rather than on an old query's results.
  const close = () => {
    setAnchor(null);
    if (search && search.query !== "") search.onQueryChange("");
  };

  const handleSelect = (stationId: string) => {
    close();
    onSelect(stationId);
  };

  const item = (station: StationOption) => (
    <MenuItem
      key={station.id}
      selected={station.id === selectedId}
      onClick={() => handleSelect(station.id)}
    >
      <ListItemIcon>
        <Icon
          name={station.favorite ? IconName.Star : IconName.SatelliteAlt}
          fontSize="small"
        />
      </ListItemIcon>
      <ListItemText
        primary={station.name}
        secondary={station.favorite ? "Favorite" : undefined}
      />
    </MenuItem>
  );

  const items = (
    <>
      {favorites.map(item)}
      {favorites.length > 0 && others.length > 0 && <Divider />}
      {others.map(item)}
    </>
  );

  // Status rows: disabled items, so the list still reads as the menu's
  // content. "Searching…" wins over an empty result while a search runs.
  const status = !searchingByQuery ? (
    stations.length === 0 && <MenuItem disabled>No stations yet</MenuItem>
  ) : search.searching ? (
    <MenuItem disabled>Searching…</MenuItem>
  ) : (
    search.results.length === 0 && (
      <MenuItem disabled>No stations match</MenuItem>
    )
  );

  // A text field can't sit inside role="menu", so with search the field
  // goes above a MenuList in a popover; ArrowDown moves into the list.
  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown") return;
    const first = listRef.current?.querySelector<HTMLElement>(
      '[role="menuitem"]:not([aria-disabled="true"])'
    );
    if (!first) return;
    event.preventDefault();
    first.focus();
  };

  return (
    <>
      <Chip
        icon={<Icon name={IconName.SatelliteAlt} />}
        label={selected ? selected.name : "Pick a station"}
        // The visible text leads the name, so speech input still matches it.
        aria-label={
          selected ? `${selected.name}, station. Change station` : undefined
        }
        variant={selected ? "filled" : "outlined"}
        color={selected ? "default" : "primary"}
        onClick={(event) => setAnchor(event.currentTarget)}
        // With search the popup is a dialog holding a field and a menu, not
        // a menu on its own (#1137 code review).
        aria-haspopup={search ? "dialog" : "menu"}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      />
      {search ? (
        <Popover
          anchorEl={anchor}
          open={open}
          onClose={close}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          slotProps={{
            paper: {
              id: menuId,
              role: "dialog",
              "aria-label": "Pick a station",
            },
            transition: { onEntered: () => searchRef.current?.focus() },
          }}
        >
          <TextField
            size="small"
            placeholder="Search stations"
            value={search.query}
            onChange={(event) => search.onQueryChange(event.target.value)}
            onKeyDown={handleSearchKeyDown}
            inputRef={searchRef}
            slotProps={{ htmlInput: { "aria-label": "Search stations" } }}
            margin="dense"
            fullWidth
          />
          <MenuList ref={listRef} aria-label="Stations">
            {status}
            {items}
          </MenuList>
        </Popover>
      ) : (
        <Menu
          id={menuId}
          anchorEl={anchor}
          open={open}
          onClose={() => setAnchor(null)}
        >
          {status}
          {items}
        </Menu>
      )}
    </>
  );
};
