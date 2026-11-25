import React from "react";
import Box from "@mui/material/Box";

export interface KbdProps {
  /** The key or chord, as shown: "⌘K", "Ctrl K", "↵". */
  children: React.ReactNode;
  /**
   * Hide it from assistive tech when the shortcut is announced another
   * way (a control's `aria-keyshortcuts`), so it isn't read twice.
   */
  "aria-hidden"?: boolean;
}

/**
 * A keycap (#1122): a key or chord drawn as on a keyboard, for shortcut
 * hints such as the header search's "⌘K" and the command palette's footer.
 * Its look comes from theme tokens.
 */
export const Kbd: React.FC<KbdProps> = ({ children, ...props }) => (
  <Box
    component="kbd"
    {...props}
    sx={{
      display: "inline-flex",
      alignItems: "center",
      gap: 0.25,
      px: 0.75,
      minWidth: "1.5em",
      justifyContent: "center",
      fontFamily: "monospace",
      // Doubled for specificity: a Button's icon slot sizes its first
      // child as an icon, which a keycap in it shouldn't follow.
      "&&": { fontSize: "0.75rem", lineHeight: 1.6 },
      color: "text.secondary",
      bgcolor: "action.hover",
      border: 1,
      borderColor: "divider",
      borderRadius: 1,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </Box>
);

export default Kbd;
