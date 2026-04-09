import { jest } from "@jest/globals";
import type { FieldMappingImpactResponsePayload } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteFieldMappingDialog } = await import(
  "../components/DeleteFieldMappingDialog.component"
);

const impactWithCascade: FieldMappingImpactResponsePayload = {
  entityGroupMembers: 5,
  entityRecords: 0,
  counterpart: null,
};

const zeroImpact: FieldMappingImpactResponsePayload = {
  entityGroupMembers: 0,
  entityRecords: 0,
  counterpart: null,
};

const impactWithBidirectional: FieldMappingImpactResponsePayload = {
  entityGroupMembers: 0,
  entityRecords: 0,
  counterpart: { id: "fm-counterpart", sourceField: "related_id", normalizedKey: "related_id" },
};

const impactWithBoth: FieldMappingImpactResponsePayload = {
  entityGroupMembers: 3,
  entityRecords: 0,
  counterpart: { id: "fm-counterpart", sourceField: "related_id", normalizedKey: "related_id" },
};

const impactWithRecords: FieldMappingImpactResponsePayload = {
  entityGroupMembers: 0,
  entityRecords: 42,
  counterpart: null,
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
      screen.getByText(/will also affect the associated data/)
    ).toBeInTheDocument();
  });

  it("should show bidirectional counterpart in impact summary", () => {
    render(
      <DeleteFieldMappingDialog
        {...defaultProps}
        impact={impactWithBidirectional}
      />
    );
    expect(
      screen.getByText(/Bidirectional link to "related_id" will be cleared/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/will also affect the associated data/)
    ).toBeInTheDocument();
  });

  it("should show both entity group members and bidirectional counterpart", () => {
    render(
      <DeleteFieldMappingDialog
        {...defaultProps}
        impact={impactWithBoth}
      />
    );
    expect(screen.getByText("3 entity group members")).toBeInTheDocument();
    expect(
      screen.getByText(/Bidirectional link to "related_id" will be cleared/)
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

  it("should disable Delete button when entity records exist", () => {
    render(
      <DeleteFieldMappingDialog {...defaultProps} impact={impactWithRecords} />
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("should show error alert when entity records block deletion", () => {
    render(
      <DeleteFieldMappingDialog {...defaultProps} impact={impactWithRecords} />
    );
    expect(
      screen.getByText(/cannot be deleted because its connector entity has existing records/)
    ).toBeInTheDocument();
  });

  it("should show entity record count in impact summary", () => {
    render(
      <DeleteFieldMappingDialog {...defaultProps} impact={impactWithRecords} />
    );
    expect(
      screen.getByText("42 entity records on this connector entity")
    ).toBeInTheDocument();
  });

  it("should not call onConfirm when Delete is clicked while blocked by records", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteFieldMappingDialog
        {...defaultProps}
        impact={impactWithRecords}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("should not call onConfirm on form submit when blocked by records", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteFieldMappingDialog
        {...defaultProps}
        impact={impactWithRecords}
        onConfirm={onConfirm}
      />
    );
    const form = screen.getByRole("button", { name: "Delete" }).closest("form")!;
    fireEvent.submit(form);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
