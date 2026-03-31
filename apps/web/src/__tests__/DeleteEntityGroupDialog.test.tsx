import { jest } from "@jest/globals";
import type { EntityGroupImpactResponsePayload } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteEntityGroupDialog } = await import(
  "../components/DeleteEntityGroupDialog.component"
);

const impactWithMembers: EntityGroupImpactResponsePayload = {
  entityGroupMembers: 4,
};

const zeroImpact: EntityGroupImpactResponsePayload = {
  entityGroupMembers: 0,
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  entityGroupName: "Customer Group",
  onConfirm: jest.fn(),
  isPending: false,
  impact: impactWithMembers,
  isLoadingImpact: false,
};

describe("DeleteEntityGroupDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render dialog when open is true", () => {
    render(<DeleteEntityGroupDialog {...defaultProps} />);
    expect(
      screen.getByText("Delete Entity Group")
    ).toBeInTheDocument();
  });

  it("should not render when open is false", () => {
    render(<DeleteEntityGroupDialog {...defaultProps} open={false} />);
    expect(
      screen.queryByText("Delete Entity Group")
    ).not.toBeInTheDocument();
  });

  it("should show impact summary with member count", () => {
    render(<DeleteEntityGroupDialog {...defaultProps} />);
    expect(screen.getByText("4 group members")).toBeInTheDocument();
  });

  it("should call onConfirm on confirm click", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteEntityGroupDialog
        {...defaultProps}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should show loading state when isPending is true", () => {
    render(
      <DeleteEntityGroupDialog {...defaultProps} isPending={true} />
    );
    expect(
      screen.getByRole("button", { name: "Deleting..." })
    ).toBeDisabled();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <DeleteEntityGroupDialog
        {...defaultProps}
        serverError={{ message: "Delete failed", code: "GROUP_DELETE_FAILED" }}
      />
    );
    expect(screen.getByText(/Delete failed/)).toBeInTheDocument();
  });

  it("should show 'No associated data found' when entityGroupMembers is 0", () => {
    render(
      <DeleteEntityGroupDialog
        {...defaultProps}
        impact={zeroImpact}
      />
    );
    expect(
      screen.getByText("No associated data found.")
    ).toBeInTheDocument();
  });

  it("should show loading indicator when isLoadingImpact is true", () => {
    render(
      <DeleteEntityGroupDialog
        {...defaultProps}
        impact={null}
        isLoadingImpact={true}
      />
    );
    expect(
      screen.getByText("Checking associated data...")
    ).toBeInTheDocument();
  });

  it("should submit on Enter key press (form submission)", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteEntityGroupDialog
        {...defaultProps}
        onConfirm={onConfirm}
      />
    );
    const form = screen.getByRole("button", { name: "Delete" }).closest("form")!;
    fireEvent.submit(form);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should call onClose on Cancel click", () => {
    const onClose = jest.fn();
    render(
      <DeleteEntityGroupDialog {...defaultProps} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
