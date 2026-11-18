import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

const { render, screen, expectNoAxeViolations } = await import("./test-utils");
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

  it("has no axe violations when open (#793)", async () => {
    render(<EditEntityGroupDialog {...defaultProps} />);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
  });

  it("has no axe violations with a server error (#793)", async () => {
    render(
      <EditEntityGroupDialog
        {...defaultProps}
        serverError={{ message: "Something went wrong", code: "TEST_ERROR" }}
      />
    );
    await screen.findByText(/Something went wrong/);
    await expectNoAxeViolations(await screen.findByRole("dialog"));
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
    expect(screen.getByRole("button", { name: "Saving..." })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
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

// #1053: the form compared its fields with the live group and was keyed on
// the group's values. When the page refetched another editor's rename behind
// the open dialog, the form remounted on the new values and what this editor
// had typed was gone.
describe("EditEntityGroupDialog — another editor's changes while open (#1053)", () => {
  const user = userEvent.setup();

  beforeEach(() => jest.clearAllMocks());

  const opened = { name: "Customers", description: "Accounts we bill" };
  const descriptionField = () =>
    screen.getByRole("textbox", { name: /description/i });

  /** Open on `opened`; `refetch(after)` is the page refetching behind it. */
  const open = () => {
    const onSubmit = jest.fn();
    const props = { ...defaultProps, onSubmit };
    const { rerender } = render(
      <EditEntityGroupDialog {...props} group={opened} />
    );
    const refetch = (after: typeof opened) =>
      rerender(<EditEntityGroupDialog {...props} group={after} />);
    return { onSubmit, refetch };
  };

  it("keeps what this editor typed when another editor's rename arrives", async () => {
    const { refetch } = open();
    await user.clear(descriptionField());
    await user.type(descriptionField(), "Mine");
    refetch({ ...opened, name: "Clients" });
    expect(descriptionField()).toHaveValue("Mine");
  });

  it("doesn't put back a name another editor changed", async () => {
    const { onSubmit, refetch } = open();
    await user.clear(descriptionField());
    await user.type(descriptionField(), "Mine");
    refetch({ ...opened, name: "Clients" });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ description: "Mine" });
  });

  it("doesn't put back a description another editor changed", async () => {
    const { onSubmit, refetch } = open();
    refetch({ ...opened, description: "Theirs" });
    await user.clear(nameField());
    await user.type(nameField(), "Mine");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ name: "Mine" });
  });
});
