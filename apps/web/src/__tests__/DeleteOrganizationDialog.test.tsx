import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteOrganizationDialog } =
  await import("../components/DeleteOrganizationDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  organizationName: "Acme Corp",
  onConfirm: jest.fn(),
  isPending: false,
};

const confirmButton = () =>
  screen.getByTestId("confirm-delete-organization") as HTMLButtonElement;
const confirmField = () =>
  screen.getByLabelText(/Type "Acme Corp" to confirm/) as HTMLInputElement;

describe("DeleteOrganizationDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render the title and permanence warning when open (case 18)", () => {
    render(<DeleteOrganizationDialog {...defaultProps} />);
    expect(screen.getByText("Delete Organization")).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText(/all organization data/i)).toBeInTheDocument();
  });

  it("should not render content when open is false (case 18)", () => {
    render(<DeleteOrganizationDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Delete Organization")).not.toBeInTheDocument();
  });

  it("should keep Delete disabled until the exact name is typed (case 19)", () => {
    render(<DeleteOrganizationDialog {...defaultProps} />);
    expect(confirmButton()).toBeDisabled();

    fireEvent.change(confirmField(), { target: { value: "acme corp" } });
    expect(confirmButton()).toBeDisabled();

    fireEvent.change(confirmField(), { target: { value: "Acme Corp" } });
    expect(confirmButton()).not.toBeDisabled();

    // Surrounding whitespace matches via trim.
    fireEvent.change(confirmField(), { target: { value: "  Acme Corp  " } });
    expect(confirmButton()).not.toBeDisabled();
  });

  it("should call onConfirm with the trimmed name on click (case 20)", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteOrganizationDialog {...defaultProps} onConfirm={onConfirm} />
    );
    fireEvent.change(confirmField(), { target: { value: "  Acme Corp  " } });
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith("Acme Corp");
  });

  it("should call onConfirm on form submit (Enter) when matching (case 20)", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteOrganizationDialog {...defaultProps} onConfirm={onConfirm} />
    );
    fireEvent.change(confirmField(), { target: { value: "Acme Corp" } });
    fireEvent.submit(confirmField().closest("form")!);
    expect(onConfirm).toHaveBeenCalledWith("Acme Corp");
  });

  it("should not call onConfirm on submit while the name does not match (case 20)", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteOrganizationDialog {...defaultProps} onConfirm={onConfirm} />
    );
    fireEvent.change(confirmField(), { target: { value: "wrong" } });
    fireEvent.submit(confirmField().closest("form")!);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("should clear the input when the dialog reopens (case 21)", () => {
    const { rerender } = render(<DeleteOrganizationDialog {...defaultProps} />);
    fireEvent.change(confirmField(), { target: { value: "Acme Corp" } });
    expect(confirmField().value).toBe("Acme Corp");

    rerender(<DeleteOrganizationDialog {...defaultProps} open={false} />);
    rerender(<DeleteOrganizationDialog {...defaultProps} open={true} />);
    expect(confirmField().value).toBe("");
    expect(confirmButton()).toBeDisabled();
  });

  it("should disable both buttons and show progress label when pending (case 22)", () => {
    render(<DeleteOrganizationDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("should render FormAlert when serverError is provided (case 23)", () => {
    render(
      <DeleteOrganizationDialog
        {...defaultProps}
        serverError={{
          message: "Organization is locked by an in-flight job",
          code: "ENTITY_LOCKED_BY_JOB",
        }}
      />
    );
    expect(
      screen.getByText(/Organization is locked by an in-flight job/)
    ).toBeInTheDocument();
    expect(screen.getByText(/ENTITY_LOCKED_BY_JOB/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null (case 23)", () => {
    render(<DeleteOrganizationDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("should mark the field aria-invalid after blur with a non-match (case 24)", () => {
    render(<DeleteOrganizationDialog {...defaultProps} />);
    const field = confirmField();
    expect(field).not.toHaveAttribute("aria-invalid", "true");

    fireEvent.change(field, { target: { value: "wrong" } });
    fireEvent.blur(field);
    expect(field).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(field, { target: { value: "Acme Corp" } });
    expect(field).not.toHaveAttribute("aria-invalid", "true");
  });

  it("should call onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    render(<DeleteOrganizationDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
