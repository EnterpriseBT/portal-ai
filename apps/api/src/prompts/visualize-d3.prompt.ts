/**
 * Codegen prompt for the `visualize_d3` tool's dedicated model sub-call (#269).
 *
 * The sub-call (AiService.generateCode on claude-opus-4-8) turns a
 * natural-language visualization intent + the query's data shape into a D3
 * render program. The system prompt below is the agent-facing contract for
 * that program; `buildCodegenPrompt` assembles the per-call user message.
 */

/** One ≤10-row sample row + the column schema shape passed to the sub-call. */
export interface CodegenSchemaColumn {
  name: string;
  type: string;
}

export const VISUALIZE_D3_CODEGEN_SYSTEM = `You write D3 (v7) render programs for a sandboxed visualization widget.

RUNTIME CONTRACT
Your output is the BODY of a function executed as \`new Function("api", <your output>)\`.
It receives a single argument \`api\` with:
  - api.d3        the D3 v7 library
  - api.container the DOM element to render into (append your SVG/HTML here)
  - api.data      the array of row objects to visualize (see the schema + sample below)
  - api.params    an optional object of extra parameters (usually {})
  - api.theme     { mode, background, text, fontFamily, monospaceFontFamily, categorical[] }
                  — use api.theme.categorical for series colors, api.theme.text for axes/labels
  - api.width     the available width in px — lay out for this. Exceed it ONLY when the
                  chart is intrinsically wider (a long category axis, a wide flow diagram);
                  the widget then scrolls horizontally.
  - api.height    a suggested STARTING height in px, not a budget. You may exceed it freely:
                  the widget grows to fit whatever you paint and never scrolls vertically.

OUTPUT RULES
  - Output ONLY the raw JavaScript function body. No markdown fences, no \`function\` wrapper,
    no prose, no comments-as-explanation outside the code.
  - It must be syntactically valid as a function body (it is compiled with new Function).
  - Do not fetch, import, or reference any global other than \`api\` and standard browser APIs.
    There is no network access; all data is in api.data.

PROGRESSIVE RENDERING (IMPORTANT)
  - Your program may be RE-INVOKED as more data arrives (api.data grows between calls).
  - Render IDEMPOTENTLY: clear api.container (e.g. api.container.innerHTML = "") and redraw
    from the current api.data every time. Never assume all rows are present, and never append
    to a previous render blindly.
  - Lay out to api.width; treat api.height as a starting point only.

SIZING & LABELS (IMPORTANT)
  - Give axis labels, tick labels and legends the room they actually need. Size margins to
    the real label lengths in api.data — a long category name needs a wide left margin, and
    rotated or multi-line tick labels need a taller bottom margin.
  - Never compress, clip, truncate or scroll your content to fit inside api.height. The
    widget measures what you paint and grows to fit it, in both axes.
  - Place a legend where it has space (beside or below the plot, inside your own svg). Do
    not overlap it with marks to save room.

EXAMPLE (a pattern, not a template — adapt to the data and instruction)
Given data like [{ label: "A", value: 40 }, ...], a vertical bar chart:
  const d3 = api.d3;
  api.container.innerHTML = "";
  const width = Math.max(api.width, 320), height = Math.max(api.height, 260);
  // Margins sized to the real labels, not to fit a fixed box: measure the
  // longest tick label rather than assuming a short one.
  const longest = d3.max(api.data, d => String(d.label).length) || 1;
  const margin = { top: 12, right: 16, bottom: 24 + longest * 6, left: 56 };
  const svg = d3.select(api.container).append("svg")
    .attr("width", width).attr("height", height);
  const x = d3.scaleBand().domain(api.data.map(d => d.label))
    .range([margin.left, width - margin.right]).padding(0.2);
  const y = d3.scaleLinear().domain([0, d3.max(api.data, d => d.value) || 1]).nice()
    .range([height - margin.bottom, margin.top]);
  svg.append("g").selectAll("rect").data(api.data).join("rect")
    .attr("x", d => x(d.label)).attr("y", d => y(d.value))
    .attr("width", x.bandwidth()).attr("height", d => y(0) - y(d.value))
    .attr("fill", api.theme.categorical[0]);
  svg.append("g").attr("transform", \`translate(0,\${height - margin.bottom})\`)
    .call(d3.axisBottom(x)).attr("color", api.theme.text)
    .selectAll("text").attr("transform", "rotate(-40)")
    .style("text-anchor", "end");
  svg.append("g").attr("transform", \`translate(\${margin.left},0)\`)
    .call(d3.axisLeft(y).ticks(5)).attr("color", api.theme.text);`;

export function buildCodegenPrompt(params: {
  instruction: string;
  schema: CodegenSchemaColumn[];
  samplePeek: Array<Record<string, unknown>>;
  lastError?: string;
}): string {
  const columns = params.schema
    .map((c) => `  - ${c.name} (${c.type})`)
    .join("\n");
  const sample = JSON.stringify(params.samplePeek.slice(0, 10), null, 2);
  const retry = params.lastError
    ? `\n\nYour previous program failed to compile with this error — fix it:\n${params.lastError}`
    : "";
  return `Visualization requested:
${params.instruction}

The data (api.data) has these columns:
${columns}

A sample of the rows (the full set may be larger and arrive progressively):
${sample}

Write the D3 render program body per the runtime contract.${retry}`;
}
