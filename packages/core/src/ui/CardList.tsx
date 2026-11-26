import React from "react";
import Box from "@mui/material/Box";
import type { Breakpoint } from "@mui/material/styles";

export interface CardListProps {
  /** The list's accessible name, e.g. "Stations". */
  "aria-label": string;
  children: React.ReactNode;
  /**
   * Lay the cards out in a grid of this many columns, per breakpoint
   * (`{ xs: 1, sm: 2, md: 3 }`). Omitted, the cards stack in one column.
   * Cards in a row stretch to the row's height.
   */
  columns?: number | Partial<Record<Breakpoint, number>>;
  className?: string;
}

const gridTemplate = (
  columns: NonNullable<CardListProps["columns"]>
): string | Record<string, string> =>
  typeof columns === "number"
    ? `repeat(${columns}, minmax(0, 1fr))`
    : Object.fromEntries(
        Object.entries(columns).map(([bp, n]) => [
          bp,
          `repeat(${n}, minmax(0, 1fr))`,
        ])
      );

/**
 * A list of cards (#794). Each child becomes a list item, so a screen reader
 * says how many there are and moves between them. Pair it with cards whose
 * title is their control (`DetailCard` with `href` or `onClick`).
 */
export const CardList: React.FC<CardListProps> = ({
  "aria-label": ariaLabel,
  children,
  columns,
  className,
}) => (
  <Box
    component="ul"
    aria-label={ariaLabel}
    className={className}
    // sx in core, with a reason: a list's bullets, margin and indent are
    // browser defaults to undo; the 8px gap matches the Stack it replaces.
    // As a grid, each card fills its item so a row's cards share a height.
    sx={{
      listStyle: "none",
      m: 0,
      p: 0,
      ...(columns === undefined
        ? { display: "flex", flexDirection: "column", gap: 1 }
        : {
            display: "grid",
            gap: 2,
            gridTemplateColumns: gridTemplate(columns),
            "& > li > *": { height: "100%" },
          }),
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
