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

  it("falls back to the generic Handyman icon and raw key for unknown packs", () => {
    render(<ToolPackChip pack="not_a_real_pack" />);
    expect(screen.getByText("not_a_real_pack")).toBeInTheDocument();
    expect(screen.getByTestId("HandymanOutlinedIcon")).toBeInTheDocument();
  });

  it("forwards Chip props such as onDelete for use as an Autocomplete tag", () => {
    const onDelete = jest.fn();
    render(<ToolPackChip pack="statistics" onDelete={onDelete} />);
    // MUI renders a delete icon button when onDelete is provided
    fireEvent.click(screen.getByTestId("CancelIcon"));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
