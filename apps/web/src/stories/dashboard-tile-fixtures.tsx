import React from "react";

import { useTheme } from "@mui/material/styles";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";

import { Typography } from "@portalai/core/ui";

import { VisualFigureUI } from "../components/VisualFigure.component";

/**
 * Static stand-ins for pinned blocks in the #1123 tile stories. Real tiles
 * render through the compact block renderer (#1081), which needs the SDK.
 */

const BARS = [
  { label: "North", value: 42 },
  { label: "South", value: 28 },
  { label: "East", value: 35 },
  { label: "West", value: 19 },
];

/** A small bar chart in the theme's data colours. */
export const FixtureChart: React.FC = () => {
  const { palette } = useTheme();
  const max = Math.max(...BARS.map((b) => b.value));
  return (
    <VisualFigureUI
      kind="chart"
      title="Q3 variance by region"
      summary="North leads at 42; West trails at 19."
      header={null}
      testId="fixture-chart"
    >
      <svg viewBox="0 0 200 100" width="100%" role="presentation">
        {BARS.map((bar, i) => {
          const height = (bar.value / max) * 90;
          return (
            <rect
              key={bar.label}
              x={10 + i * 48}
              y={100 - height}
              width={36}
              height={height}
              fill={palette.dataViz.categorical[i]}
            />
          );
        })}
      </svg>
    </VisualFigureUI>
  );
};

/** A plain three-row table. */
export const FixtureTable: React.FC = () => (
  <Table size="small" aria-label="Open inspections by county">
    <TableHead>
      <TableRow>
        <TableCell>County</TableCell>
        <TableCell align="right">Open</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {[
        ["Travis", 14],
        ["Williamson", 9],
        ["Hays", 4],
      ].map(([county, open]) => (
        <TableRow key={county}>
          <TableCell>{county}</TableCell>
          <TableCell align="right">{open}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

/** A map's place, without MapLibre. */
export const FixtureMap: React.FC = () => (
  <VisualFigureUI
    kind="map"
    title="Inspection sites"
    summary="23 sites across 3 counties."
    header={null}
    testId="fixture-map"
  >
    <Typography variant="body2" color="text.secondary">
      Map preview
    </Typography>
  </VisualFigureUI>
);
