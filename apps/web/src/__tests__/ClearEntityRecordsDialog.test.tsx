import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { ClearEntityRecordsDialog } =
  await import("../components/ClearEntityRecordsDialog.component");

const defaultProps = {
  open: true,
  entityLabel: "Customers",
  recordCount: 400920,
  isPending: false,
  serverError: null,
  onConfirm: jest.fn(),
  onClose: jest.fn(),
};

const confirmButton = () =>
  screen.getByTestId("confirm-clear-entity-records") as HTMLButtonElement;
const confirmField = () =>
  screen.getByLabelText(/Type "Customers" to confirm/) as HTMLInputElement;

describe("ClearEntityRecordsDialog (#453)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the title and the record-count impact line when open", () => {
    render(<ClearEntityRecordsDialog {...defaultProps} />);
    expect(screen.getByText("Delete All Records")).toBeInTheDocument();
    // The impact line names the blast radius with the live count.
    expect(screen.getByText(/400,920 records/)).toBeInTheDocument();
    expect(
      screen.getByText("Customers", { selector: "strong" })
    ).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<ClearEntityRecordsDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Delete All Records")).not.toBeInTheDocument();
  });

  it("calls onConfirm when the exact label is typed and submitted", () => {
    const onConfirm = jest.fn();
    render(
      <ClearEntityRecordsDialog {...defaultProps} onConfirm={onConfirm} />
    );
    fireEvent.change(confirmField(), { target: { value: "  Customers  " } });
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("supports Enter-key submission via the form", () => {
    const onConfirm = jest.fn();
    render(
      <ClearEntityRecordsDialog {...defaultProps} onConfirm={onConfirm} />
    );
    fireEvent.change(confirmField(), { target: { value: "Customers" } });
    fireEvent.submit(confirmField().closest("form")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("blocks submission and shows a field error when the label does not match", () => {
    const onConfirm = jest.fn();
    render(
      <ClearEntityRecordsDialog {...defaultProps} onConfirm={onConfirm} />
    );
    fireEvent.change(confirmField(), { target: { value: "customers" } });
    fireEvent.click(confirmButton());

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/exactly to confirm/i)).toBeInTheDocument();
    expect(confirmField()).toHaveAttribute("aria-invalid", "true");
  });

  it("shows no error while typing before blur or submit", () => {
    render(<ClearEntityRecordsDialog {...defaultProps} />);
    fireEvent.change(confirmField(), { target: { value: "cust" } });
    expect(screen.queryByText(/exactly to confirm/i)).not.toBeInTheDocument();
    expect(confirmField()).toHaveAttribute("aria-invalid", "false");
  });

  it("shows the error after blur with a mismatched value", () => {
    render(<ClearEntityRecordsDialog {...defaultProps} />);
    fireEvent.change(confirmField(), { target: { value: "nope" } });
    fireEvent.blur(confirmField());
    expect(screen.getByText(/exactly to confirm/i)).toBeInTheDocument();
  });

  it("marks the confirmation field required", () => {
    render(<ClearEntityRecordsDialog {...defaultProps} />);
    expect(confirmField()).toBeRequired();
  });

  it("calls onClose on Cancel", () => {
    const onClose = jest.fn();
    render(<ClearEntityRecordsDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons and relabels while pending", () => {
    render(<ClearEntityRecordsDialog {...defaultProps} isPending />);
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    expect(screen.getByText(/Deleting/)).toBeInTheDocument();
  });

  it("renders FormAlert when a serverError is provided", () => {
    render(
      <ClearEntityRecordsDialog
        {...defaultProps}
        serverError={{
          message: "Connector instance is locked by an in-flight job",
          code: "ENTITY_LOCKED_BY_JOB",
        }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/locked by an in-flight job/)).toBeInTheDocument();
  });

  it("does not render FormAlert when serverError is null", () => {
    render(<ClearEntityRecordsDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("resets the confirmation state when reopened", () => {
    const { rerender } = render(<ClearEntityRecordsDialog {...defaultProps} />);
    fireEvent.change(confirmField(), { target: { value: "Customers" } });
    rerender(<ClearEntityRecordsDialog {...defaultProps} open={false} />);
    rerender(<ClearEntityRecordsDialog {...defaultProps} open={true} />);
    expect(confirmField().value).toBe("");
  });
});
