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

// #789: Cancel never flashes a field error on its way out.
describe("RenamePortalDialog — blur toward the dialog's controls", () => {
  it("shows no error when an emptied name loses focus to Cancel", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<RenamePortalDialog {...defaultProps} onClose={onClose} />);
    await user.clear(nameField());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Name is required")).not.toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// #801 adversarial §6.1: a value saved before the limit doesn't block the
// dialog. Only a value the user edits is held to it.
describe("RenamePortalDialog — a name saved before the limit (#801)", () => {
  it("closes on an unchanged legacy name without an error or a request", async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(
      <RenamePortalDialog
        {...defaultProps}
        currentName={"P".repeat(500)}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Name must be 120 characters or fewer")
    ).not.toBeInTheDocument();
  });
});
