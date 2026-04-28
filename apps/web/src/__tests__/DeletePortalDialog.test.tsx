import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeletePortalDialog } =
  await import("../components/DeletePortalDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  portalName: "My Portal",
  onConfirm: jest.fn(),
  isPending: false,
};

describe("DeletePortalDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render 'Delete Portal' title", () => {
    render(<DeletePortalDialog {...defaultProps} />);
    expect(screen.getByText("Delete Portal")).toBeInTheDocument();
  });

  it("should display portal name in the confirmation message", () => {
    render(<DeletePortalDialog {...defaultProps} />);
    expect(screen.getByText("My Portal")).toBeInTheDocument();
  });

  it("should call onConfirm when Delete is clicked", () => {
    const onConfirm = jest.fn();
    render(<DeletePortalDialog {...defaultProps} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId("confirm-delete-portal"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<DeletePortalDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should show 'Deleting...' and disable buttons when pending", () => {
    render(<DeletePortalDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should not render content when open is false", () => {
    render(<DeletePortalDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Delete Portal")).not.toBeInTheDocument();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <DeletePortalDialog
        {...defaultProps}
        serverError={{ message: "Portal not found", code: "PORTAL_NOT_FOUND" }}
      />
    );
    expect(screen.getByText(/Portal not found/)).toBeInTheDocument();
    expect(screen.getByText(/PORTAL_NOT_FOUND/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(<DeletePortalDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
