import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { ToolPackChip } = await import("../components/ToolPackChip.component");

describe("ToolPackChip", () => {
  it("renders the human-readable label for a known pack", () => {
    render(<ToolPackChip pack="data_query" />);
    expect(screen.getByText("Data Query")).toBeInTheDocument();
  });

  it("renders the dedicated MUI icon for each known pack", () => {
    const cases: Array<[string, string]> = [
      ["data_query", "StorageOutlinedIcon"],
      ["statistics", "BarChartOutlinedIcon"],
      ["regression", "TrendingUpOutlinedIcon"],
      ["financial", "PaidOutlinedIcon"],
      ["web_search", "TravelExploreOutlinedIcon"],
      ["entity_management", "HubOutlinedIcon"],
    ];
    for (const [pack, iconTestId] of cases) {
      const { unmount } = render(<ToolPackChip pack={pack} />);
      expect(screen.getByTestId(iconTestId)).toBeInTheDocument();
      unmount();
    }
  });

  it("falls back to the Extension icon and raw key for unknown packs", () => {
    render(<ToolPackChip pack="not_a_real_pack" />);
    expect(screen.getByText("not_a_real_pack")).toBeInTheDocument();
    expect(screen.getByTestId("ExtensionOutlinedIcon")).toBeInTheDocument();
  });

  it("renders custom org:<id> refs with the same Extension icon as built-in fallbacks", () => {
    // Custom toolpacks live behind `org:<id>` refs and don't appear in
    // TOOL_PACK_ICONS — they share the Extension icon to stay visually
    // consistent with built-in chips in the station-dialog picker.
    render(<ToolPackChip pack="org:abc-123" label="customer_intel" />);
    expect(screen.getByText("customer_intel")).toBeInTheDocument();
    expect(screen.getByTestId("ExtensionOutlinedIcon")).toBeInTheDocument();
  });

  // ── Unentitled variant (#284) ─────────────────────────────────────
  //
  // An attached pack the plan no longer includes must read as inert
  // wherever it renders, without disappearing — the chip still names the
  // pack, and the reason is reachable by tooltip and by screen reader.

  describe("entitled", () => {
    it("renders exactly as before when the prop is omitted", () => {
      render(<ToolPackChip pack="entity_management" />);
      expect(screen.getByText("Entity Management")).toBeInTheDocument();
      expect(screen.getByTestId("HubOutlinedIcon")).toBeInTheDocument();
      expect(
        document.querySelector('[data-entitled="false"]')
      ).not.toBeInTheDocument();
    });

    it("marks the chip inert and names the limit when entitled is false", () => {
      render(<ToolPackChip pack="entity_management" entitled={false} />);
      const chip = document.querySelector('[data-entitled="false"]');
      expect(chip).toBeInTheDocument();
      expect(chip).toHaveAttribute(
        "aria-label",
        "Entity Management — Not included in your plan"
      );
    });

    it("keeps the unentitled styling when the caller passes its own sx", () => {
      // Regression: `{...rest}` used to spread after the conditional sx, so any
      // caller-supplied sx clobbered the muted/dashed treatment. That silently
      // broke exactly the two surfaces that pass one — the portal header and
      // station detail, both via ToolPackChipWithMetadata's cursor style —
      // while leaving data-entitled and the tooltip intact, so it read as
      // "tooltip works, styling missing".
      render(
        <ToolPackChip
          pack="entity_management"
          entitled={false}
          sx={{ cursor: "pointer" }}
        />
      );
      const chip = document.querySelector('[data-entitled="false"]')!;
      expect(chip).toHaveStyle({ borderStyle: "dashed" });
      expect(chip).toHaveStyle({ opacity: "0.6" });
      // …and the caller's own style still applies.
      expect(chip).toHaveStyle({ cursor: "pointer" });
    });

    it("keeps the pack label and icon when unentitled", () => {
      render(<ToolPackChip pack="entity_management" entitled={false} />);
      // The pack is still named — inert, not hidden.
      expect(screen.getByText("Entity Management")).toBeInTheDocument();
      expect(screen.getByTestId("HubOutlinedIcon")).toBeInTheDocument();
    });
  });

  it("forwards Chip props such as onDelete for use as an Autocomplete tag", () => {
    const onDelete = jest.fn();
    render(<ToolPackChip pack="statistics" onDelete={onDelete} />);
    // MUI renders a delete icon button when onDelete is provided
    fireEvent.click(screen.getByTestId("CancelIcon"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
