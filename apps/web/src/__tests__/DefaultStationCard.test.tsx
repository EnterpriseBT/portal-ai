import { jest } from "@jest/globals";
import type { Station } from "@portalai/core/models";

const { render, screen, fireEvent } = await import("./test-utils");
const { DefaultStationCardUI } = await import(
  "../components/DefaultStationCard.component"
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

const defaultProps = {
  station: makeStation(),
  onLaunchPortal: jest.fn(),
  onChangeDefault: jest.fn(),
};

describe("DefaultStationCardUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render station name and description", () => {
    render(<DefaultStationCardUI {...defaultProps} />);
    expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
    expect(
      screen.getByText("Sales data analysis station")
    ).toBeInTheDocument();
  });

  it("should render tool packs as chips", () => {
    render(<DefaultStationCardUI {...defaultProps} />);
    expect(screen.getByText("data_query")).toBeInTheDocument();
    expect(screen.getByText("statistics")).toBeInTheDocument();
  });

  it("should render 'Launch Portal' button", () => {
    render(<DefaultStationCardUI {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: /Launch Portal/ })
    ).toBeInTheDocument();
  });

  it("should call onLaunchPortal with stationId when Launch Portal is clicked", () => {
    const onLaunchPortal = jest.fn();
    render(
      <DefaultStationCardUI {...defaultProps} onLaunchPortal={onLaunchPortal} />
    );
    fireEvent.click(screen.getByRole("button", { name: /Launch Portal/ }));
    expect(onLaunchPortal).toHaveBeenCalledWith("station-1");
  });

  it("should render 'Change default' link", () => {
    render(<DefaultStationCardUI {...defaultProps} />);
    expect(
      screen.getByRole("button", { name: "Change default" })
    ).toBeInTheDocument();
  });

  it("should call onChangeDefault when Change default is clicked", () => {
    const onChangeDefault = jest.fn();
    render(
      <DefaultStationCardUI
        {...defaultProps}
        onChangeDefault={onChangeDefault}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Change default" }));
    expect(onChangeDefault).toHaveBeenCalled();
  });

  it("should show empty state when station is null", () => {
    render(<DefaultStationCardUI {...defaultProps} station={null} />);
    expect(
      screen.getByText(/No default station/)
    ).toBeInTheDocument();
  });

  it("should show 'Go to Stations' button in empty state", () => {
    render(<DefaultStationCardUI {...defaultProps} station={null} />);
    expect(
      screen.getByRole("button", { name: "Go to Stations" })
    ).toBeInTheDocument();
  });

  it("should call onChangeDefault when 'Go to Stations' is clicked in empty state", () => {
    const onChangeDefault = jest.fn();
    render(
      <DefaultStationCardUI
        {...defaultProps}
        station={null}
        onChangeDefault={onChangeDefault}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to Stations" }));
    expect(onChangeDefault).toHaveBeenCalled();
  });
});
