import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteEntityRecordDialog } = await import(
  "../components/DeleteEntityRecordDialog.component"
);

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  recordSourceId: "REC-001",
  onConfirm: jest.fn(),
  isPending: false,
};

describe("DeleteEntityRecordDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render dialog when open is true", () => {
    render(<DeleteEntityRecordDialog {...defaultProps} />);
    expect(
      screen.getByText("Delete Entity Record")
    ).toBeInTheDocument();
  });

  it("should not render when open is false", () => {
    render(<DeleteEntityRecordDialog {...defaultProps} open={false} />);
    expect(
      screen.queryByText("Delete Entity Record")
    ).not.toBeInTheDocument();
  });

  it("should display record source ID in confirmation text", () => {
    render(<DeleteEntityRecordDialog {...defaultProps} />);
    expect(screen.getByText("REC-001")).toBeInTheDocument();
  });

  it("should call onConfirm when Delete is clicked", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteEntityRecordDialog {...defaultProps} onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should show loading state when isPending is true", () => {
    render(
      <DeleteEntityRecordDialog {...defaultProps} isPending={true} />
    );
    expect(
      screen.getByRole("button", { name: "Deleting..." })
    ).toBeDisabled();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <DeleteEntityRecordDialog
        {...defaultProps}
        serverError={{ message: "Delete failed", code: "RECORD_DELETE_FAILED" }}
      />
    );
    expect(screen.getByText(/Delete failed/)).toBeInTheDocument();
    expect(screen.getByText(/RECORD_DELETE_FAILED/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(
      <DeleteEntityRecordDialog {...defaultProps} serverError={null} />
    );
    const alerts = screen.getAllByRole("alert");
    alerts.forEach((alert) => {
      expect(alert).not.toHaveTextContent("Delete failed");
    });
  });

  it("should submit on Enter key press (form submission)", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteEntityRecordDialog {...defaultProps} onConfirm={onConfirm} />
    );
    const form = screen.getByRole("button", { name: "Delete" }).closest("form")!;
    fireEvent.submit(form);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should call onClose on Cancel click", () => {
    const onClose = jest.fn();
    render(
      <DeleteEntityRecordDialog {...defaultProps} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
