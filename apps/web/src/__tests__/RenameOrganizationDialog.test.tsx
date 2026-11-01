import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { RenameOrganizationDialogUI } =
  await import("../components/RenameOrganizationDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  currentName: "Acme",
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

const nameField = () =>
  screen.getByRole("textbox", { name: /organization name/i });

describe("RenameOrganizationDialogUI (#907)", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the title and the current name when open", () => {
    render(<RenameOrganizationDialogUI {...defaultProps} />);
    expect(screen.getByText("Rename organization")).toBeInTheDocument();
    expect(nameField()).toHaveValue("Acme");
  });

  it("does not render when closed", () => {
    render(<RenameOrganizationDialogUI {...defaultProps} open={false} />);
    expect(screen.queryByText("Rename organization")).not.toBeInTheDocument();
  });

  it("marks the name field required", () => {
    render(<RenameOrganizationDialogUI {...defaultProps} />);
    expect(nameField()).toBeRequired();
  });

  it("auto-focuses the name field", async () => {
    render(<RenameOrganizationDialogUI {...defaultProps} />);
    await waitFor(() => expect(nameField()).toHaveFocus());
  });

  it("submits the trimmed name on Save", async () => {
    const onSubmit = jest.fn();
    render(
      <RenameOrganizationDialogUI {...defaultProps} onSubmit={onSubmit} />
    );
    await user.clear(nameField());
    await user.type(nameField(), "  Acme Corp  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Acme Corp");
  });

  it("submits on a real Enter key press", async () => {
    const onSubmit = jest.fn();
    render(
      <RenameOrganizationDialogUI {...defaultProps} onSubmit={onSubmit} />
    );
    await waitFor(() => expect(nameField()).toHaveFocus());
    await user.clear(nameField());
    await user.type(nameField(), "Acme Corp{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("Acme Corp");
  });

  it("does not submit on Enter while a save is pending", async () => {
    const onSubmit = jest.fn();
    render(
      <RenameOrganizationDialogUI
        {...defaultProps}
        onSubmit={onSubmit}
        isPending
      />
    );
    await user.type(nameField(), "x{Enter}{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes without submitting when the name is unchanged", async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    render(
      <RenameOrganizationDialogUI
        {...defaultProps}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );
    await user.type(nameField(), "  {Enter}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("treats a stored name with stray spaces, saved unedited, as unchanged", async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    render(
      <RenameOrganizationDialogUI
        {...defaultProps}
        currentName="Acme "
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onClose on Cancel", async () => {
    const onClose = jest.fn();
    render(<RenameOrganizationDialogUI {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state and can't be dismissed while pending", async () => {
    const onClose = jest.fn();
    render(
      <RenameOrganizationDialogUI
        {...defaultProps}
        onClose={onClose}
        isPending
      />
    );
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("blocks an empty name with a field error and aria-invalid", async () => {
    const onSubmit = jest.fn();
    render(
      <RenameOrganizationDialogUI {...defaultProps} onSubmit={onSubmit} />
    );
    await user.clear(nameField());
    await user.type(nameField(), "   {Enter}");
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the field error after blur", async () => {
    render(<RenameOrganizationDialogUI {...defaultProps} />);
    await user.clear(nameField());
    fireEvent.blur(nameField());
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
  });

  it("shows the length error for a 121-character paste, without truncating it", async () => {
    const onSubmit = jest.fn();
    render(
      <RenameOrganizationDialogUI {...defaultProps} onSubmit={onSubmit} />
    );
    await user.clear(nameField());
    await user.click(nameField());
    await user.paste("a".repeat(121));
    expect(nameField()).toHaveValue("a".repeat(121));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Name must be 120 characters or fewer")
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders a FormAlert for a server error", () => {
    render(
      <RenameOrganizationDialogUI
        {...defaultProps}
        serverError={{
          message: "You don't have permission to edit the organization.",
          code: "PERMISSION_DENIED",
        }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "permission to edit the organization"
    );
  });

  it("renders no FormAlert without a server error", () => {
    render(<RenameOrganizationDialogUI {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows no error when an emptied name loses focus to Cancel", async () => {
    const onClose = jest.fn();
    render(<RenameOrganizationDialogUI {...defaultProps} onClose={onClose} />);
    await user.clear(nameField());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
