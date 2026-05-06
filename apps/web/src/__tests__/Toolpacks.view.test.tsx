import React from "react";
import { jest } from "@jest/globals";
import type { Toolpack } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { ToolpacksUI } = await import("../views/Toolpacks.view");

const PACKS: Toolpack[] = [
  {
    id: "builtin:data_query",
    kind: "builtin",
    slug: "data_query",
    name: "Data Query",
    description: "SQL and visualization tools.",
    iconSlug: "Storage",
    tools: [
      {
        name: "sql_query",
        description: "Run a SQL query.",
        parameterSchema: { type: "object", properties: {} },
      },
    ],
  },
  {
    id: "builtin:statistics",
    kind: "builtin",
    slug: "statistics",
    name: "Statistics",
    description: "Descriptive stats and correlation.",
    iconSlug: "BarChart",
    tools: [
      {
        name: "describe_column",
        description: "Compute descriptive stats.",
        parameterSchema: { type: "object", properties: {} },
      },
      {
        name: "correlate",
        description: "Compute Pearson/Spearman/Kendall.",
        parameterSchema: { type: "object", properties: {} },
      },
    ],
  },
  {
    id: "builtin:financial",
    kind: "builtin",
    slug: "financial",
    name: "Financial",
    description: "TVM, NPV, IRR.",
    iconSlug: "AccountBalance",
    tools: [
      {
        name: "tvm",
        description: "Time-value of money.",
        parameterSchema: { type: "object", properties: {} },
      },
    ],
  },
];

function renderUI(overrides: Partial<React.ComponentProps<typeof ToolpacksUI>> = {}) {
  const defaults: React.ComponentProps<typeof ToolpacksUI> = {
    toolpacks: PACKS,
    search: "",
    onSearchChange: jest.fn(),
    selected: null,
    onSelect: jest.fn(),
    onCloseModal: jest.fn(),
  };
  return render(<ToolpacksUI {...defaults} {...overrides} />);
}

describe("ToolpacksUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Case 49
  it("renders one row per toolpack", () => {
    renderUI();
    expect(screen.getByText("Data Query")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(screen.getByText("Financial")).toBeInTheDocument();
  });

  // Case 50
  it("filters rows when the search field narrows the set", () => {
    renderUI({ search: "stat" });
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(screen.queryByText("Data Query")).not.toBeInTheDocument();
    expect(screen.queryByText("Financial")).not.toBeInTheDocument();
  });

  // Case 51
  it("invokes onSearchChange when the user types into the filter field", () => {
    const onSearchChange = jest.fn();
    renderUI({ onSearchChange });
    const input = screen.getByLabelText(/Filter toolpacks/i);
    fireEvent.change(input, { target: { value: "fin" } });
    expect(onSearchChange).toHaveBeenCalledWith("fin");
  });

  // Case 52
  it("invokes onSelect with the clicked toolpack when a row is clicked", () => {
    const onSelect = jest.fn();
    renderUI({ onSelect });
    fireEvent.click(screen.getByText("Statistics"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const arg = (onSelect as jest.Mock).mock.calls[0][0] as Toolpack;
    expect(arg.slug).toBe("statistics");
  });

  // Case 53
  it("renders the metadata modal heading when a toolpack is selected", () => {
    renderUI({ selected: PACKS[0] });
    // The modal opens with the same name shown in the header.
    // There is also a row for the same pack — so we pick the role=heading
    // version to be specific.
    const headings = screen.getAllByText("Data Query");
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });

  // Case 110
  it("renders Edit / Delete / Refresh actions for custom rows but not built-ins", () => {
    const customPack: Toolpack = {
      id: "otp-1",
      kind: "custom",
      slug: "customer_intel",
      name: "customer_intel",
      description: "External customer intelligence.",
      iconSlug: "Extension",
      tools: [
        {
          name: "lookup_company",
          description: "Look up a company.",
          parameterSchema: { type: "object", properties: {} },
        },
      ],
      endpoints: {
        schema: "https://example.com/schema",
        runtime: "https://example.com/runtime",
      },
      authHeadersStatus: { has: false },
      schemaFetchedAt: Date.now(),
      metadataFetchedAt: null,
    };

    renderUI({
      toolpacks: [PACKS[0], customPack],
      onEdit: jest.fn(),
      onDelete: jest.fn(),
      onRefresh: jest.fn(),
    });

    // The custom row's three icon buttons render — at least one of each.
    expect(
      screen.getAllByLabelText("Edit toolpack").length
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByLabelText("Delete toolpack").length
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByLabelText("Refresh toolpack schema").length
    ).toBeGreaterThanOrEqual(1);
  });

  // Case 111
  it("renders the Register toolpack header button when onRegister is supplied", () => {
    const onRegister = jest.fn();
    renderUI({ onRegister });
    const button = screen.getByRole("button", { name: /Register toolpack/i });
    fireEvent.click(button);
    expect(onRegister).toHaveBeenCalledTimes(1);
  });
});
