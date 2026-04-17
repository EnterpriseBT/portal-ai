import type { Orientation } from "./region-editor.types";

export function orientationArrow(orientation: Orientation): string {
  switch (orientation) {
    case "rows-as-records":
      return "↓";
    case "columns-as-records":
      return "→";
    case "cells-as-records":
      return "↘";
  }
}

export function orientationArrowLabel(orientation: Orientation): string {
  switch (orientation) {
    case "rows-as-records":
      return "Records run down (each row is a record)";
    case "columns-as-records":
      return "Records run across (each column is a record)";
    case "cells-as-records":
      return "Records are individual cells (crosstab)";
  }
}
