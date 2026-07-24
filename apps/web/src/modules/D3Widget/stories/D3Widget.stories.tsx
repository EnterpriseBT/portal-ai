import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { THEME_MAP } from "@portalai/core/ui";

import { D3WidgetUI } from "../D3Widget.component";
import { buildSandboxTheme } from "../utils/sandbox-theme.util";

/**
 * Storybook is the REAL-BROWSER execution surface for the sandbox
 * (spec resolved Q5): unlike jsdom, the iframe here actually runs the
 * bootstrap + program. `Rendered` proves a live D3 paint; `ThrowingProgram`
 * proves error containment (the frame reports, the page survives).
 */

const lightTheme = buildSandboxTheme(THEME_MAP.brand);
const darkTheme = buildSandboxTheme(THEME_MAP["brand.dark"]);

const MONTHLY_ROWS = [
  { month: "Jan", total: 32 },
  { month: "Feb", total: 45 },
  { month: "Mar", total: 28 },
  { month: "Apr", total: 61 },
  { month: "May", total: 54 },
  { month: "Jun", total: 73 },
];

/** A plain-ES5 bar chart, written the way the agent will author programs. */
const BAR_CHART_PROGRAM = `
var d3 = api.d3;
var width = Math.max(api.width, 320);
var height = 260;
var margin = { top: 12, right: 12, bottom: 28, left: 32 };

var svg = d3
  .select(api.container)
  .append("svg")
  .attr("width", width)
  .attr("height", height);

var x = d3
  .scaleBand()
  .domain(api.data.map(function (d) { return d.month; }))
  .range([margin.left, width - margin.right])
  .padding(0.2);

var y = d3
  .scaleLinear()
  .domain([0, d3.max(api.data, function (d) { return d.total; }) || 1])
  .nice()
  .range([height - margin.bottom, margin.top]);

svg
  .append("g")
  .selectAll("rect")
  .data(api.data)
  .join("rect")
  .attr("x", function (d) { return x(d.month); })
  .attr("y", function (d) { return y(d.total); })
  .attr("width", x.bandwidth())
  .attr("height", function (d) { return y(0) - y(d.total); })
  .attr("fill", api.theme.categorical[0]);

svg
  .append("g")
  .attr("transform", "translate(0," + (height - margin.bottom) + ")")
  .call(d3.axisBottom(x))
  .attr("color", api.theme.text);

svg
  .append("g")
  .attr("transform", "translate(" + margin.left + ",0)")
  .call(d3.axisLeft(y).ticks(5))
  .attr("color", api.theme.text);
`;

const meta: Meta<typeof D3WidgetUI> = {
  title: "Modules/D3Widget",
  component: D3WidgetUI,
  parameters: { layout: "padded" },
  args: {
    program: BAR_CHART_PROGRAM,
    theme: lightTheme,
    batches: [{ rows: MONTHLY_ROWS, seq: 0, done: true }],
    totalRows: MONTHLY_ROWS.length,
    receivedRows: MONTHLY_ROWS.length,
    complete: true,
    loading: false,
    error: null,
    onFrameError: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof D3WidgetUI>;

/** Live sandbox execution — a real D3 bar chart painted in the iframe. */
export const Rendered: Story = {};

export const WithTitle: Story = {
  args: { title: "Monthly totals" },
};

export const DarkTheme: Story = {
  args: { theme: darkTheme },
  parameters: { backgrounds: { default: "dark" } },
};

/** Pre-first-batch state for a large handle-backed result. */
export const Loading: Story = {
  args: {
    batches: [],
    totalRows: 13_427,
    truncated: true,
    receivedRows: 0,
    complete: false,
    loading: true,
  },
};

/** Mid-progressive-fetch: first batch painted, more arriving. */
export const ProgressiveRendering: Story = {
  args: {
    batches: [{ rows: MONTHLY_ROWS, seq: 0, done: false }],
    totalRows: 13_427,
    receivedRows: 6_000,
    complete: false,
  },
};

export const ErrorCard: Story = {
  args: {
    batches: [],
    error: "Cannot read properties of undefined (reading 'select')",
  },
};

/** Containment demo: the program throws inside the frame; the widget
 *  keeps rendering (the container would surface the error card via
 *  onFrameError — watch the action in the Actions panel). */
export const ThrowingProgram: Story = {
  args: {
    program: "throw new Error('intentional sandbox failure');",
    batches: [{ rows: MONTHLY_ROWS, seq: 0, done: true }],
  },
};
