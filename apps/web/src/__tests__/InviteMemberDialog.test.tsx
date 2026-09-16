import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { InviteMemberDialog } =
  await import("../components/InviteMemberDialog.component");

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};

describe("InviteMemberDialog", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders title and content when open", () => {
    render(<InviteMemberDialog {...defaultProps} />);
    expect(screen.getByText("Invite a member")).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<InviteMemberDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Invite a member")).not.toBeInTheDocument();
  });

  it("submits { email, role } with the default role (member)", async () => {
    const onSubmit = jest.fn();
    render(<InviteMemberDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        email: "new@example.com",
        role: "member",
      });
    });
  });

  it("submits on Enter key press", async () => {
    const onSubmit = jest.fn();
    render(<InviteMemberDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "enter@example.com" },
    });
    fireEvent.submit(screen.getByLabelText(/Email/).closest("form")!);
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        email: "enter@example.com",
        role: "member",
      });
    });
  });

  it("calls onClose on Cancel", () => {
    const onClose = jest.fn();
    render(<InviteMemberDialog {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows loading state when isPending", () => {
    render(<InviteMemberDialog {...defaultProps} isPending />);
    expect(screen.getByRole("button", { name: "Inviting..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("renders FormAlert (role=alert) when serverError is provided", () => {
    render(
      <InviteMemberDialog
        {...defaultProps}
        serverError={{
          message: "That email is already a member",
          code: "SEAT_ALREADY_MEMBER",
        }}
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.getByText(/That email is already a member/)
    ).toBeInTheDocument();
    expect(screen.getByText(/SEAT_ALREADY_MEMBER/)).toBeInTheDocument();
  });

  it("does not render FormAlert when serverError is null", () => {
    render(<InviteMemberDialog {...defaultProps} serverError={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks submit and flags the field on an invalid email", async () => {
    const onSubmit = jest.fn();
    render(<InviteMemberDialog {...defaultProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Email/), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Email/)).toHaveAttribute(
        "aria-invalid",
        "true"
      );
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("marks the email field required", () => {
    render(<InviteMemberDialog {...defaultProps} />);
    expect(screen.getByLabelText(/Email/)).toBeRequired();
  });

  it("offers member and admin roles but never owner", () => {
    render(<InviteMemberDialog {...defaultProps} />);
    // The MUI select renders its options into a listbox on open.
    fireEvent.mouseDown(screen.getByLabelText(/Role/));
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["member", "admin"]));
    expect(options).not.toContain("owner");
  });
});
