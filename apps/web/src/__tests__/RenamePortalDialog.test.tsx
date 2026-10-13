import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { RenamePortalDialog } =
  await import("../components/RenamePortalDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  currentName: "Sales Portal",
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

const nameField = () => screen.getByRole("textbox", { name: /name/i });

describe("RenamePortalDialog", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the title and the current name when open", () => {
    render(<RenamePortalDialog {...defaultProps} />);
    expect(screen.getByText("Rename Portal")).toBeInTheDocument();
    expect(nameField()).toHaveValue("Sales Portal");
  });

  it("does not render when closed", () => {
    render(<RenamePortalDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Rename Portal")).not.toBeInTheDocument();
  });

  it("marks the name field required", () => {
    render(<RenamePortalDialog {...defaultProps} />);
    expect(nameField()).toBeRequired();
  });

  it("submits the trimmed name on Save", async () => {
    const onSubmit = jest.fn();
    render(<RenamePortalDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(nameField());
    await user.type(nameField(), "  Renamed  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Renamed");
  });

  // #758: Enter did nothing; the dialog had no form for it to submit.
  it("submits on a real Enter key press", async () => {
    const onSubmit = jest.fn();
    render(<RenamePortalDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(nameField());
    await user.type(nameField(), "Renamed{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("Renamed");
  });

  it("does not submit on Enter while a save is pending", async () => {
    const onSubmit = jest.fn();
    render(
      <RenamePortalDialog {...defaultProps} onSubmit={onSubmit} isPending />
    );
    await user.type(nameField(), "x{Enter}{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closes without submitting when the name is unchanged", async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    render(
      <RenamePortalDialog
        {...defaultProps}
        onSubmit={onSubmit}
        onClose={onClose}
      />
    );
    await user.type(nameField(), "{Enter}");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onClose on Cancel", async () => {
    const onClose = jest.fn();
    render(<RenamePortalDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state while pending", () => {
    render(<RenamePortalDialog {...defaultProps} isPending />);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("blocks an empty name with a field error", async () => {
    const onSubmit = jest.fn();
    render(<RenamePortalDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(nameField());
    await user.type(nameField(), "   {Enter}");
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the field error after blur", async () => {
    render(<RenamePortalDialog {...defaultProps} />);
    await user.clear(nameField());
    fireEvent.blur(nameField());
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
  });

  it("renders a FormAlert for a server error", () => {
    render(
      <RenamePortalDialog
        {...defaultProps}
        serverError={{ message: "Rename failed", code: "PORTAL_NOT_FOUND" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Rename failed");
  });

  it("renders no FormAlert without a server error", () => {
    render(<RenamePortalDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
