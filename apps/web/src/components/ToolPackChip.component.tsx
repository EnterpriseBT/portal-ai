import React from "react";

import Chip from "@mui/material/Chip";
import type { ChipProps } from "@mui/material/Chip";

import { ToolPackIconUtil } from "../utils/tool-pack-icons.util";
import { ToolPackUtil } from "../utils/tool-packs.util";

export interface ToolPackChipProps extends Omit<ChipProps, "icon"> {
  pack: string;
}

/**
 * Displays a tool pack as a chip with its associated icon and human-readable
 * label. Pass through any additional `Chip` props (e.g. `onDelete`,
 * `onClick`) to extend behavior in form or trigger contexts. A caller-
 * supplied `label` overrides the registry-derived label — useful for
 * `org:<id>` custom-pack refs whose label can't be resolved without a
 * lookup.
 */
export const ToolPackChip: React.FC<ToolPackChipProps> = ({
  pack,
  size = "small",
  variant = "outlined",
  label,
  ...rest
}) => {
  const IconComponent = ToolPackIconUtil.getIcon(pack);
  return (
    <Chip
      icon={React.createElement(IconComponent, { fontSize: "small" })}
      label={label ?? ToolPackUtil.getLabel(pack)}
      size={size}
      variant={variant}
      {...rest}
    />
  );
};
