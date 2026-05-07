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

  it("forwards Chip props such as onDelete for use as an Autocomplete tag", () => {
    const onDelete = jest.fn();
    render(<ToolPackChip pack="statistics" onDelete={onDelete} />);
    // MUI renders a delete icon button when onDelete is provided
    fireEvent.click(screen.getByTestId("CancelIcon"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
