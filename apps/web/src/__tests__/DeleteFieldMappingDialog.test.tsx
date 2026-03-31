import { jest } from "@jest/globals";
import type { FieldMappingImpactResponsePayload } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteFieldMappingDialog } = await import(
  "../components/DeleteFieldMappingDialog.component"
);

const impactWithCascade: FieldMappingImpactResponsePayload = {
  entityGroupMembers: 5,
};

const zeroImpact: FieldMappingImpactResponsePayload = {
  entityGroupMembers: 0,
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  fieldMappingSourceField: "account_id",
  onConfirm: jest.fn(),
  isPending: false,
  impact: zeroImpact,
  isLoadingImpact: false,
};

describe("DeleteFieldMappingDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render dialog when open is true", () => {
    render(<DeleteFieldMappingDialog {...defaultProps} />);
    expect(
      screen.getByText("Delete Field Mapping")
    ).toBeInTheDocument();
  });

  it("should not render when open is false", () => {
    render(<DeleteFieldMappingDialog {...defaultProps} open={false} />);
    expect(
      screen.queryByText("Delete Field Mapping")
    ).not.toBeInTheDocument();
  });

  it("should show cascade warning with group member count", () => {
    render(
      <DeleteFieldMappingDialog
        {...defaultProps}
        impact={impactWithCascade}
      />
    );
    expect(screen.getByText("5 entity group members")).toBeInTheDocument();
    expect(
      screen.getByText(/will also remove 5 entity group members/)
    ).toBeInTheDocument();
  });

  it("should call onConfirm on confirm click", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteFieldMappingDialog
        {...defaultProps}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should show loading state when isPending is true", () => {
    render(
      <DeleteFieldMappingDialog {...defaultProps} isPending={true} />
    );
    expect(
      screen.getByRole("button", { name: "Deleting..." })
    ).toBeDisabled();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <DeleteFieldMappingDialog
        {...defaultProps}
        serverError={{ message: "Delete failed", code: "MAPPING_DELETE_FAILED" }}
      />
    );
    expect(screen.getByText(/Delete failed/)).toBeInTheDocument();
  });

  it("should show 'No associated data found' when entityGroupMembers is 0", () => {
    render(
      <DeleteFieldMappingDialog
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
      <DeleteFieldMappingDialog
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
      <DeleteFieldMappingDialog
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
      <DeleteFieldMappingDialog {...defaultProps} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
