import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen } = await import("./test-utils");
const { EditEntityGroupDialog } =
  await import("../components/EditEntityGroupDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  group: { name: "Customers", description: null },
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

const nameField = () => screen.getByRole("textbox", { name: /^name/i });

describe("EditEntityGroupDialog", () => {
  const user = userEvent.setup();

  beforeEach(() => jest.clearAllMocks());

  it("renders the title and the current label when open", () => {
    render(<EditEntityGroupDialog {...defaultProps} />);
    expect(screen.getByText("Edit Entity Group")).toBeInTheDocument();
    expect(nameField()).toHaveValue("Customers");
  });

  it("does not render when closed", () => {
    render(<EditEntityGroupDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Edit Entity Group")).not.toBeInTheDocument();
  });

  it("marks the name field required", () => {
    render(<EditEntityGroupDialog {...defaultProps} />);
    expect(nameField()).toBeRequired();
  });

  it("submits the trimmed name on Save", async () => {
    const onSubmit = jest.fn();
    render(<EditEntityGroupDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(nameField());
    await user.type(nameField(), "  People  ");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "People" });
  });

  it("submits on a real Enter key press", async () => {
    const onSubmit = jest.fn();
    render(<EditEntityGroupDialog {...defaultProps} onSubmit={onSubmit} />);
    await user.clear(nameField());
    await user.type(nameField(), "People{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not submit on Enter while the name is unchanged", async () => {
    const onSubmit = jest.fn();
    render(<EditEntityGroupDialog {...defaultProps} onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.type(nameField(), "{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("calls onClose on Cancel", async () => {
    const onClose = jest.fn();
    render(<EditEntityGroupDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the loading state while pending", () => {
    render(<EditEntityGroupDialog {...defaultProps} isPending />);
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("shows the field error and aria-invalid after clearing the name", async () => {
    render(<EditEntityGroupDialog {...defaultProps} />);
    await user.clear(nameField());
    await user.click(screen.getByRole("textbox", { name: /^name/i }));
    await user.tab();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
  });

  it("renders a FormAlert for a server error", () => {
    render(
      <EditEntityGroupDialog
        {...defaultProps}
        serverError={{ message: "Name taken", code: "ENTITY_GROUP_CONFLICT" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Name taken");
  });

  it("renders no FormAlert without a server error", () => {
    render(<EditEntityGroupDialog {...defaultProps} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

// #801 adversarial §6.1: a value saved before the limit doesn't block the
// dialog. Only a value the user edits is held to it.
describe("EditEntityGroupDialog — a name saved before the limit (#801)", () => {
  const user = userEvent.setup();

  it("saves a description change on a group with a legacy name", async () => {
    const onSubmit = jest.fn();
    render(
      <EditEntityGroupDialog
        {...defaultProps}
        group={{ name: "G".repeat(500), description: null }}
        onSubmit={onSubmit}
      />
    );
    await user.type(
      screen.getByRole("textbox", { name: /description/i }),
      "Accounts"
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ description: "Accounts" });
  });

  it("holds a changed description to the limit", async () => {
    const onSubmit = jest.fn();
    render(<EditEntityGroupDialog {...defaultProps} onSubmit={onSubmit} />);
    const description = screen.getByRole("textbox", { name: /description/i });
    await user.click(description);
    await user.paste("d".repeat(2001));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Description must be 2000 characters or fewer")
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
