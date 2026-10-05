import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteAccessItemDialogUI } =
  await import("../components/DeleteAccessItemDialog.component");

const props = {
  open: true,
  onClose: jest.fn(),
  onConfirm: jest.fn(),
  kind: "group" as const,
  itemName: "Analysts",
  isPending: false,
  serverError: null,
};

describe("DeleteAccessItemDialogUI (#691)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders a titled confirm naming the item", () => {
    render(<DeleteAccessItemDialogUI {...props} />);
    expect(screen.getByText("Delete group")).toBeInTheDocument();
    expect(screen.getByText(/Analysts/)).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<DeleteAccessItemDialogUI {...props} open={false} />);
    expect(screen.queryByText("Delete group")).toBeNull();
  });

  it("calls onConfirm on Delete", () => {
    render(<DeleteAccessItemDialogUI {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(props.onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Cancel", () => {
    render(<DeleteAccessItemDialogUI {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the pending state and can't fire twice", () => {
    render(<DeleteAccessItemDialogUI {...props} isPending />);
    const del = screen.getByRole("button", { name: "Deleting..." });
    expect(del).toBeDisabled();
    fireEvent.click(del);
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("can't be dismissed (Escape) while the delete is in flight", () => {
    render(<DeleteAccessItemDialogUI {...props} isPending />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("can be dismissed with Escape when idle", () => {
    render(<DeleteAccessItemDialogUI {...props} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the server error in the dialog", () => {
    render(
      <DeleteAccessItemDialogUI
        {...props}
        serverError={{ message: "Group is in use", code: "GROUP_IN_USE" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Group is in use");
  });

  it("renders no alert without a server error", () => {
    render(<DeleteAccessItemDialogUI {...props} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the kind for roles and policies", () => {
    const { rerender } = render(
      <DeleteAccessItemDialogUI {...props} kind="role" />
    );
    expect(screen.getByText("Delete role")).toBeInTheDocument();
    rerender(<DeleteAccessItemDialogUI {...props} kind="policy" />);
    expect(screen.getByText("Delete policy")).toBeInTheDocument();
  });
});
