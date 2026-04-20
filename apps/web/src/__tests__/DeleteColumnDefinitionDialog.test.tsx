import { jest } from "@jest/globals";
import type { ColumnDefinitionImpactResponsePayload } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteColumnDefinitionDialog } =
  await import("../components/DeleteColumnDefinitionDialog.component");

const fullImpact: ColumnDefinitionImpactResponsePayload = {
  fieldMappings: 5,
  refFieldMappings: 2,
  entityRecords: 100,
};

const zeroImpact: ColumnDefinitionImpactResponsePayload = {
  fieldMappings: 0,
  refFieldMappings: 0,
  entityRecords: 0,
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  columnDefinitionLabel: "Customer Name",
  onConfirm: jest.fn(),
  isPending: false,
  impact: zeroImpact,
  isLoadingImpact: false,
};

describe("DeleteColumnDefinitionDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render title when open is true", () => {
    render(<DeleteColumnDefinitionDialog {...defaultProps} />);
    expect(screen.getByText("Delete Column Definition")).toBeInTheDocument();
  });

  it("should not render when open is false", () => {
    render(<DeleteColumnDefinitionDialog {...defaultProps} open={false} />);
    expect(
      screen.queryByText("Delete Column Definition")
    ).not.toBeInTheDocument();
  });

  it("should show blocked state when impact has fieldMappings > 0", () => {
    render(
      <DeleteColumnDefinitionDialog {...defaultProps} impact={fullImpact} />
    );
    expect(
      screen.getByText(/cannot be deleted because it is referenced/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("should call onConfirm when no dependencies", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteColumnDefinitionDialog
        {...defaultProps}
        impact={zeroImpact}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should show loading state when isPending is true", () => {
    render(<DeleteColumnDefinitionDialog {...defaultProps} isPending={true} />);
    expect(screen.getByRole("button", { name: "Deleting..." })).toBeDisabled();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <DeleteColumnDefinitionDialog
        {...defaultProps}
        serverError={{ message: "Delete failed", code: "DELETE_FAILED" }}
      />
    );
    expect(screen.getByText(/Delete failed/)).toBeInTheDocument();
    expect(screen.getByText(/DELETE_FAILED/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(
      <DeleteColumnDefinitionDialog {...defaultProps} serverError={null} />
    );
    const alerts = screen.getAllByRole("alert");
    alerts.forEach((alert) => {
      expect(alert).not.toHaveTextContent("Delete failed");
    });
  });

  it("should display impact counts when impact data is provided", () => {
    render(
      <DeleteColumnDefinitionDialog {...defaultProps} impact={fullImpact} />
    );
    expect(screen.getByText("5 field mappings")).toBeInTheDocument();
    expect(screen.getByText("2 reference field mappings")).toBeInTheDocument();
    expect(screen.getByText("100 entity records")).toBeInTheDocument();
  });

  it("should show loading indicator when isLoadingImpact is true", () => {
    render(
      <DeleteColumnDefinitionDialog
        {...defaultProps}
        impact={null}
        isLoadingImpact={true}
      />
    );
    expect(screen.getByText("Checking associated data...")).toBeInTheDocument();
  });

  it("should show 'No associated data found' when all counts are zero", () => {
    render(
      <DeleteColumnDefinitionDialog {...defaultProps} impact={zeroImpact} />
    );
    expect(screen.getByText("No associated data found.")).toBeInTheDocument();
  });

  it("should submit on Enter key press (form submission)", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteColumnDefinitionDialog
        {...defaultProps}
        impact={zeroImpact}
        onConfirm={onConfirm}
      />
    );
    const form = screen
      .getByRole("button", { name: "Delete" })
      .closest("form")!;
    fireEvent.submit(form);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should call onClose on Cancel click", () => {
    const onClose = jest.fn();
    render(
      <DeleteColumnDefinitionDialog {...defaultProps} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
