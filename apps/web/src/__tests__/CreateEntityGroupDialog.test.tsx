import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { CreateEntityGroupDialog } =
  await import("../components/CreateEntityGroupDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

const nameField = () => screen.getByRole("textbox", { name: /^name/i });

describe("CreateEntityGroupDialog", () => {
  it("opens empty after the parent closes it on success", async () => {
    // The parent closes on success without going through Cancel, so the
    // form clears when it opens, not only when it closes itself.
    const user = userEvent.setup();
    const { rerender } = render(<CreateEntityGroupDialog {...defaultProps} />);
    await user.type(nameField(), "Customers");
    rerender(<CreateEntityGroupDialog {...defaultProps} open={false} />);
    rerender(<CreateEntityGroupDialog {...defaultProps} open />);
    await waitFor(() => expect(nameField()).toHaveValue(""));
  });

  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the title when open", () => {
    render(<CreateEntityGroupDialog {...defaultProps} />);
    expect(screen.getByText("Create Entity Group")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<CreateEntityGroupDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Create Entity Group")).not.toBeInTheDocument();
  });

  it("marks the name field required", () => {
    render(<CreateEntityGroupDialog {...defaultProps} />);
    expect(nameField()).toBeRequired();
  });

  it("submits on Create", async () => {
    const onSubmit = jest.fn();
    render(<CreateEntityGroupDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.type(nameField(), "Customers");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Customers",
      description: undefined,
    });
  });

  it("submits on a real Enter key press", async () => {
    const onSubmit = jest.fn();
    render(<CreateEntityGroupDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.type(nameField(), "Customers{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it("does not submit on Enter while pending", async () => {
    const onSubmit = jest.fn();
    render(
      <CreateEntityGroupDialog
        {...defaultProps}
        onSubmit={onSubmit}
        isPending
      />
    );
    await user.type(nameField(), "Customers{Enter}{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onClose on Cancel", async () => {
    const onClose = jest.fn();
    render(<CreateEntityGroupDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state while pending", () => {
    render(<CreateEntityGroupDialog {...defaultProps} isPending />);
    expect(screen.getByRole("button", { name: "Creating..." })).toBeDisabled();
  });

  it("blocks an empty name with a field error", async () => {
    const onSubmit = jest.fn();
    render(<CreateEntityGroupDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.type(nameField(), "{Enter}");
    await waitFor(() =>
      expect(nameField()).toHaveAttribute("aria-invalid", "true")
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the field error after blur", async () => {
    render(<CreateEntityGroupDialog {...defaultProps} />);
    fireEvent.focus(nameField());
    fireEvent.blur(nameField());
    await waitFor(() =>
      expect(nameField()).toHaveAttribute("aria-invalid", "true")
    );
  });

  it("renders a FormAlert for a server error", () => {
    render(
      <CreateEntityGroupDialog
        {...defaultProps}
        serverError={{ message: "Group exists", code: "ENTITY_GROUP_CONFLICT" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Group exists");
  });

  it("renders no FormAlert without a server error", () => {
    render(<CreateEntityGroupDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
