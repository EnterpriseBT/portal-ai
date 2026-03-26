import { jest } from "@jest/globals";
import type { Station } from "@portalai/core/models";

const { render, screen, fireEvent } = await import("./test-utils");
const { StationListUI, StationCardUI } = await import(
  "../components/StationList.component"
);

const makeStation = (overrides: Partial<Station> = {}): Station => ({
  id: "station-1",
  organizationId: "org-1",
  name: "Sales Analytics",
  description: "Sales data analysis station",
  toolPacks: ["data_query", "statistics"],
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

const station1 = makeStation();
const station2 = makeStation({
  id: "station-2",
  name: "Finance Hub",
  description: "Financial reporting",
  toolPacks: ["data_query", "financial"],
});

const defaultCardProps = {
  station: station1,
  isDefault: false,
  onSetDefault: jest.fn(),
  onOpen: jest.fn(),
};

describe("StationCardUI", () => {
  it("should render station name and description", () => {
    render(<StationCardUI {...defaultCardProps} />);
    expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
    expect(
      screen.getByText("Sales data analysis station")
    ).toBeInTheDocument();
  });

  it("should render tool packs", () => {
    render(<StationCardUI {...defaultCardProps} />);
    expect(
      screen.getByText("Tool packs: data_query, statistics")
    ).toBeInTheDocument();
  });

  it("should show Default badge when isDefault is true", () => {
    render(<StationCardUI {...defaultCardProps} isDefault={true} />);
    expect(screen.getByTestId("default-badge")).toBeInTheDocument();
    expect(screen.getByText("Default")).toBeInTheDocument();
  });

  it("should not show Default badge when isDefault is false", () => {
    render(<StationCardUI {...defaultCardProps} isDefault={false} />);
    expect(screen.queryByTestId("default-badge")).not.toBeInTheDocument();
  });

  it("should show 'Set as default' button when not default", () => {
    render(<StationCardUI {...defaultCardProps} isDefault={false} />);
    expect(
      screen.getByRole("button", { name: "Set as default" })
    ).toBeInTheDocument();
  });

  it("should not show 'Set as default' button when default", () => {
    render(<StationCardUI {...defaultCardProps} isDefault={true} />);
    expect(
      screen.queryByRole("button", { name: "Set as default" })
    ).not.toBeInTheDocument();
  });

  it("should call onSetDefault when 'Set as default' is clicked", () => {
    const onSetDefault = jest.fn();
    render(
      <StationCardUI
        {...defaultCardProps}
        isDefault={false}
        onSetDefault={onSetDefault}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Set as default" }));
    expect(onSetDefault).toHaveBeenCalledWith(station1);
  });

  it("should navigate when card is clicked", () => {
    const onOpen = jest.fn();
    render(<StationCardUI {...defaultCardProps} onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("station-card"));
    expect(onOpen).toHaveBeenCalledWith(station1);
  });
});

const defaultListProps = {
  stations: [station1, station2],
  defaultStationId: null as string | null,
  onSetDefault: jest.fn(),
  onOpen: jest.fn(),
};

describe("StationListUI", () => {
  it("should render multiple station cards", () => {
    render(<StationListUI {...defaultListProps} />);
    expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
    expect(screen.getByText("Finance Hub")).toBeInTheDocument();
  });

  it("should show empty state when no stations", () => {
    render(<StationListUI {...defaultListProps} stations={[]} />);
    expect(screen.getByText("No stations found")).toBeInTheDocument();
  });

  it("should mark the correct station as default", () => {
    render(
      <StationListUI {...defaultListProps} defaultStationId="station-1" />
    );
    expect(screen.getByTestId("default-badge")).toBeInTheDocument();
    // Only one default badge should be shown
    expect(screen.getAllByTestId("default-badge")).toHaveLength(1);
  });
});
