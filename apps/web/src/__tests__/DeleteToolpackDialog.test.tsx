import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteToolpackDialogUI } =
  await import("../components/DeleteToolpackDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  toolpackName: "customer_intel",
  isPending: false,
  serverError: null,
};

describe("DeleteToolpackDialogUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the dialog with the pack name in the body", () => {
    render(<DeleteToolpackDialogUI {...defaultProps} />);
    expect(screen.getByText("Delete toolpack")).toBeInTheDocument();
    expect(screen.getByText(/customer_intel/)).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<DeleteToolpackDialogUI {...defaultProps} open={false} />);
    expect(screen.queryByText("Delete toolpack")).not.toBeInTheDocument();
  });

  it("calls onConfirm when Delete is clicked", () => {
    const onConfirm = jest.fn();
    render(<DeleteToolpackDialogUI {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<DeleteToolpackDialogUI {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the impacted-stations list when provided", () => {
    render(
      <DeleteToolpackDialogUI
        {...defaultProps}
        impactedStations={[
          { id: "s1", name: "Sales Station" },
          { id: "s2", name: "Ops Station" },
        ]}
      />
    );
    const items = screen.getAllByTestId("delete-toolpack-impacted-station");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Sales Station");
  });

  it("falls back to id when an impacted station has no name", () => {
    render(
      <DeleteToolpackDialogUI
        {...defaultProps}
        impactedStations={[{ id: "s-anon" }]}
      />
    );
    expect(screen.getByText("s-anon")).toBeInTheDocument();
  });
});
