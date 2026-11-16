import React from "react";
import Box from "@mui/material/Box";

export interface CardListProps {
  /** The list's accessible name, e.g. "Stations". */
  "aria-label": string;
  children: React.ReactNode;
  className?: string;
}

/**
 * A list of cards (#794). Each child becomes a list item, so a screen reader
 * says how many there are and moves between them. Pair it with cards whose
 * title is their control (`DetailCard` with `href` or `onClick`).
 */
export const CardList: React.FC<CardListProps> = ({
  "aria-label": ariaLabel,
  children,
  className,
}) => (
  <Box
    component="ul"
    aria-label={ariaLabel}
    className={className}
    // sx in core, with a reason: a list's bullets, margin and indent are
    // browser defaults to undo; the 8px gap matches the Stack it replaces.
    sx={{
      listStyle: "none",
      m: 0,
      p: 0,
      display: "flex",
      flexDirection: "column",
      gap: 1,
    }}
  >
    {React.Children.toArray(children).map((child, i) => (
      <li
        key={React.isValidElement(child) && child.key != null ? child.key : i}
      >
        {child}
      </li>
    ))}
  </Box>
);

export default CardList;
