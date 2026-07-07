import React from "react";
import Box from "@mui/material/Box";
import MuiTypography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";

export interface MetadataItem {
  /** Label displayed for this entry. */
  label: string;
  /** Value to display. Accepts strings or custom JSX (links, chips, etc.). */
  value: React.ReactNode;
  /** Controls how the value is rendered. Defaults to "text". */
  variant?: "text" | "mono" | "chip";
  /** When true the item is not rendered. Avoids conditional wrapping at the call site. */
  hidden?: boolean;
  /** Optional leading icon rendered beside the label (in `stacked`/`responsive` layouts). */
  icon?: React.ReactNode;
}

export interface MetadataListProps {
  /** The metadata entries to display. */
  items: MetadataItem[];
  /**
   * Layout mode.
   * - "stacked" — label above value, always vertical (default)
   * - "responsive" — label and value side-by-side on sm+, stacked on xs
   * - "inline" — label and value on one line separated by a colon
   */
  layout?: "inline" | "stacked" | "responsive";
  /** Show a divider between items. Default: false. */
  dividers?: boolean;
  /** Vertical spacing between items. Default: 1.5. */
  spacing?: number;
  /** Controls typography size. "small" uses body2, "medium" uses body1. Default: "small". */
  size?: "small" | "medium";
  /** When true, wraps the list in an outlined Paper card. Default: false. */
  raised?: boolean;
  /**
   * How items flow within the list.
   * - "wrap" — items render horizontally and wrap to new lines as needed (default)
   * - "vertical" — items stack vertically, one per row
   */
  direction?: "wrap" | "vertical";
  className?: string;
  [key: `data-${string}`]: string;
}

const MetadataValue: React.FC<{
  item: MetadataItem;
  size: "small" | "medium";
}> = ({ item, size }) => {
  const typographyVariant = size === "small" ? "body2" : "body1";

  switch (item.variant) {
    case "mono":
      return (
        <MuiTypography
          variant={typographyVariant}
          sx={{ fontFamily: "monospace", wordBreak: "break-all" }}
        >
          {item.value}
        </MuiTypography>
      );
    case "chip":
      return typeof item.value === "string" ? (
        <Chip label={item.value} size="small" variant="outlined" />
      ) : (
        <>{item.value}</>
      );
    default:
      return typeof item.value === "string" ||
        typeof item.value === "number" ? (
        <MuiTypography variant={typographyVariant}>{item.value}</MuiTypography>
      ) : (
        <>{item.value}</>
      );
  }
};

const InlineRow: React.FC<{
  item: MetadataItem;
  size: "small" | "medium";
}> = ({ item, size }) => {
  const typographyVariant = size === "small" ? "body2" : "body1";

  if (item.variant === "chip") {
    return (
      <Stack direction="row" spacing={1} alignItems="center">
        <MuiTypography
          variant={typographyVariant}
          color="text.secondary"
          component="span"
        >
          {item.label}:
        </MuiTypography>
        <MetadataValue item={item} size={size} />
      </Stack>
    );
  }

  return (
    <MuiTypography variant={typographyVariant}>
      <Box component="span" fontWeight={600} color="text.primary">
        {item.label}:
      </Box>{" "}
      <Box
        component="span"
        color="text.secondary"
        sx={item.variant === "mono" ? { fontFamily: "monospace" } : undefined}
      >
        {item.value}
      </Box>
    </MuiTypography>
  );
};

/** Label text with an optional leading icon. Icon-less output is identical to
 *  the original markup, so existing consumers are unaffected. */
const MetadataLabel: React.FC<{
  item: MetadataItem;
  size: "small" | "medium";
  shrink?: boolean;
}> = ({ item, size, shrink }) => {
  const labelVariant = size === "small" ? "caption" : "body2";
  const label = (
    <MuiTypography
      variant={labelVariant}
      color="text.secondary"
      sx={{ flexShrink: shrink ? 0 : undefined, fontWeight: 400 }}
    >
      {item.label}
    </MuiTypography>
  );

  if (!item.icon) return label;

  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      sx={{ flexShrink: shrink ? 0 : undefined, color: "text.secondary" }}
    >
      {item.icon}
      {label}
    </Stack>
  );
};

const ResponsiveRow: React.FC<{
  item: MetadataItem;
  size: "small" | "medium";
}> = ({ item, size }) => {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        gap: { xs: 0.25, sm: 1 },
        alignItems: "flex-start",
      }}
    >
      <MetadataLabel item={item} size={size} shrink />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <MetadataValue item={item} size={size} />
      </Box>
    </Box>
  );
};

const StackedRow: React.FC<{
  item: MetadataItem;
  size: "small" | "medium";
}> = ({ item, size }) => {
  return (
    <Stack spacing={0.25}>
      <MetadataLabel item={item} size={size} />
      <MetadataValue item={item} size={size} />
    </Stack>
  );
};

export const MetadataList = React.forwardRef<HTMLDivElement, MetadataListProps>(
  (
    {
      items,
      layout = "stacked",
      dividers = false,
      spacing = 1.5,
      size = "small",
      raised = false,
      direction = "wrap",
      className,
      ...rest
    },
    ref
  ) => {
    const visible = items.filter((i) => !i.hidden);
    const verticalGap = dividers ? spacing / 2 : spacing;

    const renderRow = (item: MetadataItem) => {
      if (layout === "inline") return <InlineRow item={item} size={size} />;
      if (layout === "stacked") return <StackedRow item={item} size={size} />;
      return <ResponsiveRow item={item} size={size} />;
    };

    const list =
      direction === "wrap" ? (
        <Box
          ref={raised ? undefined : ref}
          className={raised ? undefined : className}
          data-testid="metadata-list"
          sx={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            columnGap: spacing * 2,
            rowGap: spacing,
          }}
          {...(raised ? {} : rest)}
        >
          {visible.map((item, i) => (
            <Box key={`${item.label}-${i}`} sx={{ minWidth: 0 }}>
              {renderRow(item)}
            </Box>
          ))}
        </Box>
      ) : (
        <Stack
          ref={raised ? undefined : ref}
          spacing={verticalGap}
          className={raised ? undefined : className}
          data-testid="metadata-list"
          {...(raised ? {} : rest)}
        >
          {visible.map((item, i) => (
            <React.Fragment key={`${item.label}-${i}`}>
              {renderRow(item)}
              {dividers && i < visible.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </Stack>
      );

    if (raised) {
      return (
        <Paper
          ref={ref}
          variant="outlined"
          className={className}
          sx={{ p: 2.5 }}
          {...rest}
        >
          {list}
        </Paper>
      );
    }

    return list;
  }
);

export default MetadataList;
