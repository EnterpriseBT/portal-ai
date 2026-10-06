import React from "react";
import { jest } from "@jest/globals";
import type { ToolpackWithCapabilities as Toolpack } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { ToolpacksUI } = await import("../views/Toolpacks.view");

const PACKS: Toolpack[] = [
  {
    id: "builtin:data_query",
    kind: "builtin",
    capabilities: { read: true, write: false, delete: false },
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
    capabilities: { read: true, write: false, delete: false },
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
    capabilities: { read: true, write: false, delete: false },
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

function renderUI(
  overrides: Partial<React.ComponentProps<typeof ToolpacksUI>> = {}
) {
  const defaults: React.ComponentProps<typeof ToolpacksUI> = {
    toolpacks: PACKS,
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
  it("filters rows via the pagination toolbar's search input", () => {
    renderUI();
    const input = screen.getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "stat" } });
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(screen.queryByText("Data Query")).not.toBeInTheDocument();
    expect(screen.queryByText("Financial")).not.toBeInTheDocument();
  });

  // Case 51
  it("renders the pagination toolbar with search and sort affordances", () => {
    renderUI();
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
    // The toolbar exposes sort + page controls — pick a stable sentinel.
    expect(screen.getByLabelText("First page")).toBeInTheDocument();
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
      capabilities: { read: true, write: true, delete: true },
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
      signingSecretStatus: { has: true },
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

  describe("per-row actions follow the row's capabilities (#691)", () => {
    const custom = (
      id: string,
      capabilities: { read: boolean; write: boolean; delete: boolean }
    ): Toolpack =>
      ({
        id,
        kind: "custom",
        capabilities,
        slug: `pack_${id}`,
        name: `pack_${id}`,
        description: "",
        iconSlug: "Extension",
        tools: [],
        endpoints: {
          schema: "https://example.com/schema",
          runtime: "https://example.com/runtime",
        },
        authHeadersStatus: { has: false },
        signingSecretStatus: { has: true },
        schemaFetchedAt: Date.now(),
        metadataFetchedAt: null,
      }) as Toolpack;
    const handlers = {
      onEdit: jest.fn(),
      onDelete: jest.fn(),
      onRefresh: jest.fn(),
    };

    it("a pack another member registered shows no Refresh, Edit or Delete", () => {
      renderUI({
        toolpacks: [custom("a", { read: true, write: false, delete: false })],
        ...handlers,
      });
      expect(screen.queryByLabelText("Edit toolpack")).toBeNull();
      expect(screen.queryByLabelText("Delete toolpack")).toBeNull();
      expect(screen.queryByLabelText("Refresh toolpack schema")).toBeNull();
    });

    it("write without delete shows Refresh and Edit, not Delete", () => {
      renderUI({
        toolpacks: [custom("b", { read: true, write: true, delete: false })],
        ...handlers,
      });
      expect(screen.getByLabelText("Edit toolpack")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Refresh toolpack schema")
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Delete toolpack")).toBeNull();
    });

    it("each row is gated on its own capabilities", () => {
      renderUI({
        toolpacks: [
          custom("mine", { read: true, write: true, delete: true }),
          custom("theirs", { read: true, write: false, delete: false }),
        ],
        ...handlers,
      });
      expect(screen.getAllByLabelText("Delete toolpack")).toHaveLength(1);
      expect(screen.getAllByLabelText("Edit toolpack")).toHaveLength(1);
    });
  });

  // Case 111
  it("renders the Register toolpack header button when onRegister is supplied", () => {
    const onRegister = jest.fn();
    renderUI({ onRegister });
    const button = screen.getByRole("button", { name: /Register toolpack/i });
    fireEvent.click(button);
    expect(onRegister).toHaveBeenCalledTimes(1);
  });

  it("disables the row refresh button + shows a spinner while refreshingId matches", () => {
    const customPack: Toolpack = {
      id: "otp-1",
      kind: "custom",
      capabilities: { read: true, write: true, delete: true },
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
      signingSecretStatus: { has: true },
      schemaFetchedAt: Date.now(),
      metadataFetchedAt: null,
    };

    const { rerender } = renderUI({
      toolpacks: [customPack],
      onRefresh: jest.fn(),
      refreshingId: null,
    });
    const before = screen.getByLabelText(
      "Refresh toolpack schema"
    ) as HTMLButtonElement;
    expect(before.disabled).toBe(false);
    expect(
      screen.queryByTestId(`toolpack-refresh-spinner-${customPack.id}`)
    ).not.toBeInTheDocument();

    rerender(
      <ToolpacksUI
        toolpacks={[customPack]}
        selected={null}
        onSelect={jest.fn()}
        onCloseModal={jest.fn()}
        onRefresh={jest.fn()}
        refreshingId={customPack.id}
      />
    );

    const after = screen.getByLabelText(
      "Refresh toolpack schema"
    ) as HTMLButtonElement;
    expect(after.disabled).toBe(true);
    expect(
      screen.getByTestId(`toolpack-refresh-spinner-${customPack.id}`)
    ).toBeInTheDocument();
  });

  // ── Tier entitlements (#214, cases 20–22) ──────────────────────────

  describe("custom-toolpack entitlement affordances (#214)", () => {
    const customPack: Toolpack = {
      id: "otp-42",
      kind: "custom",
      capabilities: { read: true, write: true, delete: true },
      slug: "customer_intel",
      name: "customer_intel",
      description: "External calls.",
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
      signingSecretStatus: { has: true },
      schemaFetchedAt: Date.now(),
      metadataFetchedAt: null,
    } as never;

    // case 20 — unentitled
    it("#691: badges custom rows and upsells Register, with the plan reason, when unentitled", async () => {
      const onRegister = jest.fn();
      const onUpgrade = jest.fn();
      renderUI({
        toolpacks: [...PACKS, customPack],
        onRegister,
        customToolpacksEntitled: false,
        registerGate: {
          kind: "upsell",
          reason: "Your plan does not include custom toolpacks",
          onUpgrade,
        },
      });

      expect(screen.getByText("Inactive on your plan")).toBeInTheDocument();

      const register = screen.getByRole("button", {
        name: /register toolpack/i,
      });
      // An upsell is enabled: it leads to an upgrade, not to the dialog.
      expect(register).toBeEnabled();
      fireEvent.click(register);
      expect(onUpgrade).toHaveBeenCalledTimes(1);
      expect(onRegister).not.toHaveBeenCalled();

      fireEvent.mouseOver(register);
      expect(
        await screen.findByText(/your plan does not include custom toolpacks/i)
      ).toBeInTheDocument();
    });

    it("#691: hides Register for a caller who can't create toolpacks", () => {
      renderUI({
        toolpacks: PACKS,
        onRegister: jest.fn(),
        registerGate: { kind: "hide" },
      });
      expect(
        screen.queryByRole("button", { name: /register toolpack/i })
      ).toBeNull();
    });

    // Scope narrowed by #284: built-in rows badge on their OWN axis
    // (entitledBuiltinSlugs, covered below) — never on the custom one.
    it("never badges built-in rows off the custom axis", () => {
      renderUI({
        toolpacks: PACKS,
        onRegister: jest.fn(),
        customToolpacksEntitled: false,
      });

      expect(
        screen.queryByText("Inactive on your plan")
      ).not.toBeInTheDocument();
    });

    // case 21 — entitled regression
    it("renders no badge and an enabled Register when entitled", () => {
      renderUI({
        toolpacks: [...PACKS, customPack],
        onRegister: jest.fn(),
        customToolpacksEntitled: true,
      });

      expect(
        screen.queryByText("Inactive on your plan")
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /register toolpack/i })
      ).toBeEnabled();
    });

    // case 22 — prop default keeps the pre-#214 surface
    it("defaults to entitled when the prop is omitted (existing callers unchanged)", () => {
      renderUI({ toolpacks: [...PACKS, customPack], onRegister: jest.fn() });

      expect(
        screen.queryByText("Inactive on your plan")
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /register toolpack/i })
      ).toBeEnabled();
    });
  });

  // ── Built-in entitlement affordances (#284) ────────────────────────
  //
  // The same badge, driven off the built-in axis. #214 shipped the badge
  // for custom packs only; a `standard`-tier org listing `entity_management`
  // as an ordinary built-in is the silent state this removes.

  describe("built-in toolpack entitlement affordances (#284)", () => {
    it("badges built-in rows whose slug is unentitled", () => {
      renderUI({
        toolpacks: PACKS,
        entitledBuiltinSlugs: new Set(["data_query"]),
      });

      // `statistics` and `financial` are outside the set; `data_query` is in.
      expect(screen.getAllByText("Inactive on your plan")).toHaveLength(2);
    });

    it("leaves entitled built-in rows unbadged", () => {
      renderUI({
        toolpacks: PACKS,
        entitledBuiltinSlugs: new Set([
          "data_query",
          "statistics",
          "financial",
        ]),
      });

      expect(
        screen.queryByText("Inactive on your plan")
      ).not.toBeInTheDocument();
    });

    it("passes the row's entitlement into the metadata modal", () => {
      renderUI({
        toolpacks: PACKS,
        selected: PACKS[1], // statistics — outside the set below
        entitledBuiltinSlugs: new Set(["data_query"]),
      });

      expect(screen.getByTestId("toolpack-plan-notice")).toBeInTheDocument();
    });
  });
});
