import React, { useId, useRef, useState } from "react";

import Chip from "@mui/material/Chip";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";

import {
  Combobox,
  Icon,
  IconName,
  type ComboboxOption,
} from "@portalai/core/ui";

/** A station the start box can start a portal in. */
export interface StationOption {
  id: string;
  name: string;
  /** Starred by the caller: marked with a star. */
  favorite: boolean;
  /** The heading it's listed under in the search popup (#1079), saying why
   *  it's suggested. Options of one group must be adjacent. */
  group?: string;
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
 * `stations` in the order given, marking favorites with a star.
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
  const open = anchor !== null;

  const selected =
    stations.find((s) => s.id === selectedId) ??
    search?.results.find((s) => s.id === selectedId) ??
    null;
  // A typed query lists its results; otherwise the loaded stations.
  const searchingByQuery = search !== undefined && search.query.trim() !== "";
  const listed = searchingByQuery ? search.results : stations;

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

  // In the order given: the caller decides what comes first (#1079: the
  // start box's suggestions).
  const items = <>{listed.map(item)}</>;

  // What an empty list says. "Searching…" wins over an empty result while a
  // search runs.
  const emptyText = !searchingByQuery
    ? "No stations yet"
    : search?.searching
      ? "Searching…"
      : "No stations match";

  // With search, the list is core's Combobox: the same field and options as
  // the header's command palette (#1079), and the APG combobox pattern a
  // field above a list needs.
  const options: (ComboboxOption & { station: StationOption })[] = listed.map(
    (station) => ({
      id: station.id,
      label: station.name,
      group: station.group,
      description: station.favorite ? "Favorite" : undefined,
      onSelect: () => handleSelect(station.id),
      station,
    })
  );
  const statusText =
    searchingByQuery && search?.searching
      ? "Searching…"
      : options.length === 0
        ? emptyText
        : `${options.length} ${options.length === 1 ? "station" : "stations"}`;

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
          <Combobox
            options={options}
            inputValue={search.query}
            onInputChange={search.onQueryChange}
            label="Search stations"
            placeholder="Search stations"
            statusText={statusText}
            renderOption={({ station }) => (
              <>
                <Icon
                  name={
                    station.favorite ? IconName.Star : IconName.SatelliteAlt
                  }
                  fontSize="small"
                />
                {/* A favorite's star is read as its description. */}
                <span>{station.name}</span>
              </>
            )}
            emptyContent={emptyText}
            inputRef={searchRef}
          />
        </Popover>
      ) : (
        <Menu
          id={menuId}
          anchorEl={anchor}
          open={open}
          onClose={() => setAnchor(null)}
        >
          {stations.length === 0 && (
            <MenuItem disabled>No stations yet</MenuItem>
          )}
          {items}
        </Menu>
      )}
    </>
  );
};
