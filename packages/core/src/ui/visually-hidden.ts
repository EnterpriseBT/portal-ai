/**
 * Screen-reader-only styles (MUI's `visuallyHidden` recipe): the element stays
 * in the accessibility tree, out of sight. For a hidden page heading, a label
 * that would repeat what's visible, or a skip link until it's focused (#797).
 */
export const visuallyHidden = {
  border: 0,
  clip: "rect(0 0 0 0)",
  height: "1px",
  margin: "-1px",
  overflow: "hidden",
  padding: 0,
  position: "absolute",
  whiteSpace: "nowrap",
  width: "1px",
} as const;
