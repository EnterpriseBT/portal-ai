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
}

export interface MetadataListProps {
  /** The metadata entries to display. */
  items: MetadataItem[];
  /**
   * Layout mode.
   * - "responsive" — label and value side-by-side on sm+, stacked on xs (default)
   * - "inline" — label and value on one line separated by a colon
   * - "stacked" — label above value, always vertical
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

const ResponsiveRow: React.FC<{
  item: MetadataItem;
  size: "small" | "medium";
}> = ({ item, size }) => {
  const typographyVariant = size === "small" ? "body2" : "body1";

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        gap: { xs: 0.5, sm: 2 },
        alignItems: { xs: "flex-start", sm: "center" },
      }}
    >
      <MuiTypography
        variant={typographyVariant}
        color="text.secondary"
        sx={{ flexShrink: 0 }}
      >
        {item.label}
      </MuiTypography>
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
  const labelVariant = size === "small" ? "body2" : "body1";

  return (
    <Stack spacing={0.5}>
      <MuiTypography variant={labelVariant} color="text.secondary">
        {item.label}
      </MuiTypography>
      <MetadataValue item={item} size={size} />
    </Stack>
  );
};

export const MetadataList = React.forwardRef<HTMLDivElement, MetadataListProps>(
  (
    {
      items,
      layout = "responsive",
      dividers = false,
      spacing = 1.5,
      size = "small",
      raised = false,
      className,
      ...rest
    },
    ref,
  ) => {
    const visible = items.filter((i) => !i.hidden);

    const list = (
      <Stack
        ref={raised ? undefined : ref}
        spacing={dividers ? spacing / 2 : spacing}
        className={raised ? undefined : className}
        data-testid="metadata-list"
        {...(raised ? {} : rest)}
      >
        {visible.map((item, i) => (
          <React.Fragment key={`${item.label}-${i}`}>
            {layout === "inline" && <InlineRow item={item} size={size} />}
            {layout === "responsive" && (
              <ResponsiveRow item={item} size={size} />
            )}
            {layout === "stacked" && <StackedRow item={item} size={size} />}
            {dividers && i < visible.length - 1 && <Divider />}
          </React.Fragment>
        ))}
      </Stack>
    );

    if (raised) {
      return (
        <Paper ref={ref} variant="outlined" className={className} sx={{ p: 2.5 }} {...rest}>
          {list}
        </Paper>
      );
    }

    return list;
  },
);

export default MetadataList;
