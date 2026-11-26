import React, { useId, useState } from "react";

import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";

import { Icon, IconName } from "@portalai/core/ui";

/** A station the start box can start a portal in. */
export interface StationOption {
  id: string;
  name: string;
  /** Starred by the caller. Favorites are listed first. */
  favorite: boolean;
}

export interface StationPickerUIProps {
  stations: StationOption[];
  /** The chosen station, or null when there's none yet. */
  selectedId: string | null;
  onSelect: (stationId: string) => void;
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
}) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const open = anchor !== null;

  const selected = stations.find((s) => s.id === selectedId) ?? null;
  const favorites = stations.filter((s) => s.favorite);
  const others = stations.filter((s) => !s.favorite);

  const handleSelect = (stationId: string) => {
    setAnchor(null);
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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
      />
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
      >
        {stations.length === 0 && <MenuItem disabled>No stations yet</MenuItem>}
        {favorites.map(item)}
        {favorites.length > 0 && others.length > 0 && <Divider />}
        {others.map(item)}
      </Menu>
    </>
  );
};
