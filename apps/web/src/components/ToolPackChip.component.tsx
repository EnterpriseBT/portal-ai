import React from "react";

import Chip from "@mui/material/Chip";
import type { ChipProps } from "@mui/material/Chip";
import Tooltip from "@mui/material/Tooltip";

import { ToolPackIconUtil } from "../utils/tool-pack-icons.util";
import {
  ToolPackUtil,
  UNENTITLED_PACK_REASON,
  UNENTITLED_PACK_TOOLTIP,
} from "../utils/tool-packs.util";

export interface ToolPackChipProps extends Omit<ChipProps, "icon"> {
  pack: string;
  /**
   * Whether the org's plan includes this pack (#284). `false` renders the
   * chip muted with a tooltip and an `aria-label` naming the limit — the
   * pack stays named and visible, because a station can legitimately carry
   * a pack a later downgrade excluded. Defaults to `true`, so every
   * existing call site is unchanged.
   */
  entitled?: boolean;
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
  entitled = true,
  sx,
  ...rest
}) => {
  const IconComponent = ToolPackIconUtil.getIcon(pack);
  const resolvedLabel = label ?? ToolPackUtil.getLabel(pack);
  const chip = (
    <Chip
      icon={React.createElement(IconComponent, { fontSize: "small" })}
      label={resolvedLabel}
      size={size}
      variant={variant}
      {...(entitled
        ? {}
        : {
            "data-entitled": "false",
            "aria-label": `${resolvedLabel} — ${UNENTITLED_PACK_REASON}`,
          })}
      // `sx` is pulled out of `rest` and MERGED rather than spread over: a
      // caller passing its own sx (the chip-with-metadata surfaces pass a
      // cursor style) used to clobber the unentitled treatment entirely,
      // leaving the tooltip and aria-label working with no visual difference.
      // Caller styles come last, so they still win on conflicting keys.
      sx={[
        !entitled && { opacity: 0.6, borderStyle: "dashed" },
        ...(Array.isArray(sx) ? sx : [sx]),
      ].filter(Boolean)}
      {...rest}
    />
  );

  // The tooltip is the reason's visual home; the aria-label above carries it
  // for assistive tech, since a Chip is not focusable on its own.
  return entitled ? (
    chip
  ) : (
    <Tooltip title={UNENTITLED_PACK_TOOLTIP}>{chip}</Tooltip>
  );
};
