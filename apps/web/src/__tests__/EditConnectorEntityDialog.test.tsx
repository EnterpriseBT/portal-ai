import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen } = await import("./test-utils");
const { EditConnectorEntityDialog } =
  await import("../components/EditConnectorEntityDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  entity: { label: "Contacts" },
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

const labelField = () => screen.getByRole("textbox", { name: /label/i });

describe("EditConnectorEntityDialog", () => {
  const user = userEvent.setup();

  beforeEach(() => jest.clearAllMocks());

  it("renders the title and the current label when open", () => {
    render(<EditConnectorEntityDialog {...defaultProps} />);
    expect(screen.getByText("Edit Connector Entity")).toBeInTheDocument();
    expect(labelField()).toHaveValue("Contacts");
  });

  it("does not render when closed", () => {
    render(<EditConnectorEntityDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Edit Connector Entity")).not.toBeInTheDocument();
  });

  it("marks the label field required", () => {
    render(<EditConnectorEntityDialog {...defaultProps} />);
    expect(labelField()).toBeRequired();
  });

  it("submits the trimmed label on Save", async () => {
    const onSubmit = jest.fn();
    render(<EditConnectorEntityDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(labelField());
    await user.type(labelField(), "  People  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ label: "People" });
  });

  it("submits on a real Enter key press", async () => {
    const onSubmit = jest.fn();
    render(<EditConnectorEntityDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(labelField());
    await user.type(labelField(), "People{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit on Enter while the label is unchanged", async () => {
    const onSubmit = jest.fn();
    render(<EditConnectorEntityDialog {...defaultProps} onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(labelField(), "{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onClose on Cancel", async () => {
    const onClose = jest.fn();
    render(<EditConnectorEntityDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state while pending", () => {
    render(<EditConnectorEntityDialog {...defaultProps} isPending />);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("shows the field error and aria-invalid after clearing the label", async () => {
    render(<EditConnectorEntityDialog {...defaultProps} />);
    await user.clear(labelField());
    // A click elsewhere in the dialog is a real blur. (Tab would move to
    // Cancel, a dialog control, which deliberately doesn't mark it touched.)
    await user.click(screen.getByText("Edit Connector Entity"));
    expect(labelField()).toHaveAttribute("aria-invalid", "true");
  });

  it("renders a FormAlert for a server error", () => {
    render(
      <EditConnectorEntityDialog
        {...defaultProps}
        serverError={{
          message: "Label taken",
          code: "CONNECTOR_ENTITY_CONFLICT",
        }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Label taken");
  });

  it("renders no FormAlert without a server error", () => {
    render(<EditConnectorEntityDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// #801 adversarial §6.1: a value saved before the limit doesn't block the
// dialog. Only a value the user edits is held to it.
describe("EditConnectorEntityDialog — a label saved before the limit (#801)", () => {
  it("doesn't flag an unchanged legacy label on blur", () => {
    render(
      <EditConnectorEntityDialog
        {...defaultProps}
        entity={{ label: "E".repeat(500) }}
      />
    );
    labelField().focus();
    labelField().blur();
    expect(
      screen.queryByText("Label must be 120 characters or fewer")
    ).not.toBeInTheDocument();
  });
});
