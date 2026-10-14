import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { RenamePinnedResultDialog } =
  await import("../components/RenamePinnedResultDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  currentName: "Revenue Summary",
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

const nameField = () => screen.getByRole("textbox", { name: /name/i });

describe("RenamePinnedResultDialog", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the title and the current name when open", () => {
    render(<RenamePinnedResultDialog {...defaultProps} />);
    expect(screen.getByText("Rename Pinned Result")).toBeInTheDocument();
    expect(nameField()).toHaveValue("Revenue Summary");
  });

  it("does not render when closed", () => {
    render(<RenamePinnedResultDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Rename Pinned Result")).not.toBeInTheDocument();
  });

  it("marks the name field required", () => {
    render(<RenamePinnedResultDialog {...defaultProps} />);
    expect(nameField()).toBeRequired();
  });

  it("submits the trimmed name on Save", async () => {
    const onSubmit = jest.fn();
    render(<RenamePinnedResultDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(nameField());
    await user.type(nameField(), "  Renamed  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Renamed");
  });

  // #758: Enter did nothing; the dialog had no form for it to submit.
  it("submits on a real Enter key press", async () => {
    const onSubmit = jest.fn();
    render(<RenamePinnedResultDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(nameField());
    await user.type(nameField(), "Renamed{Enter}");
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith("Renamed");
  });

  it("does not submit on Enter while a save is pending", async () => {
    const onSubmit = jest.fn();
    render(
      <RenamePinnedResultDialog
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
      <RenamePinnedResultDialog
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
    render(<RenamePinnedResultDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state while pending", () => {
    render(<RenamePinnedResultDialog {...defaultProps} isPending />);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("blocks an empty name with a field error", async () => {
    const onSubmit = jest.fn();
    render(<RenamePinnedResultDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(nameField());
    await user.type(nameField(), "   {Enter}");
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the field error after blur", async () => {
    render(<RenamePinnedResultDialog {...defaultProps} />);
    await user.clear(nameField());
    fireEvent.blur(nameField());
    expect(await screen.findByText("Name is required")).toBeInTheDocument();
  });

  it("renders a FormAlert for a server error", () => {
    render(
      <RenamePinnedResultDialog
        {...defaultProps}
        serverError={{
          message: "Rename failed",
          code: "PORTAL_RESULT_NOT_FOUND",
        }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Rename failed");
  });

  it("renders no FormAlert without a server error", () => {
    render(<RenamePinnedResultDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// #801 adversarial §6.1: a value saved before the limit doesn't block the
// dialog. Only a value the user edits is held to it.
describe("RenamePinnedResultDialog — a name saved before the limit (#801)", () => {
  it("closes on an unchanged legacy name without an error or a request", async () => {
    const onClose = jest.fn();
    const onSubmit = jest.fn();
    render(
      <RenamePinnedResultDialog
        {...defaultProps}
        currentName={"P".repeat(500)}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByText(LIMIT)).not.toBeInTheDocument();
  });

  it("still holds an edited name to the limit", async () => {
    const onSubmit = jest.fn();
    render(
      <RenamePinnedResultDialog
        {...defaultProps}
        currentName={"P".repeat(500)}
        onSubmit={onSubmit}
      />
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "P".repeat(499) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(LIMIT)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

const LIMIT = "Name must be 120 characters or fewer";
