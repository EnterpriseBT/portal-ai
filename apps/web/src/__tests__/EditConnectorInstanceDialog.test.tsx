import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { EditConnectorInstanceDialog } = await import(
  "../components/EditConnectorInstanceDialog.component"
);

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  currentName: "Salesforce Prod",
  onConfirm: jest.fn(),
  isPending: false,
};

describe("EditConnectorInstanceDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render dialog when open is true", () => {
    render(<EditConnectorInstanceDialog {...defaultProps} />);
    expect(
      screen.getByText("Edit Connector Instance")
    ).toBeInTheDocument();
  });

  it("should not render content when open is false", () => {
    render(
      <EditConnectorInstanceDialog {...defaultProps} open={false} />
    );
    expect(
      screen.queryByText("Edit Connector Instance")
    ).not.toBeInTheDocument();
  });

  it("should pre-fill text field with currentName", () => {
    render(<EditConnectorInstanceDialog {...defaultProps} />);
    const input = screen.getByRole("textbox", { name: /name/i });
    expect(input).toHaveValue("Salesforce Prod");
  });

  it("should disable Save button when name is unchanged", () => {
    render(<EditConnectorInstanceDialog {...defaultProps} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("should disable Save button when name is empty", () => {
    render(<EditConnectorInstanceDialog {...defaultProps} />);
    const input = screen.getByRole("textbox", { name: /name/i });
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("should disable Save button when isPending is true", () => {
    render(
      <EditConnectorInstanceDialog {...defaultProps} isPending={true} />
    );
    expect(
      screen.getByRole("button", { name: "Saving..." })
    ).toBeDisabled();
  });

  it("should call onConfirm with new name when Save is clicked", () => {
    const onConfirm = jest.fn();
    render(
      <EditConnectorInstanceDialog
        {...defaultProps}
        onConfirm={onConfirm}
      />
    );
    const input = screen.getByRole("textbox", { name: /name/i });
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledWith("New Name");
  });

  it("should submit form on Enter key press in text field", () => {
    const onConfirm = jest.fn();
    render(
      <EditConnectorInstanceDialog
        {...defaultProps}
        onConfirm={onConfirm}
      />
    );
    const input = screen.getByRole("textbox", { name: /name/i });
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.submit(input.closest("form")!);
    expect(onConfirm).toHaveBeenCalledWith("New Name");
  });

  it("should call onClose when Cancel button is clicked", () => {
    const onClose = jest.fn();
    render(
      <EditConnectorInstanceDialog {...defaultProps} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
