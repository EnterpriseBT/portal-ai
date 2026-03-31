import { jest } from "@jest/globals";
import type { ConnectorEntityImpactResponsePayload } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteConnectorEntityDialog } = await import(
  "../components/DeleteConnectorEntityDialog.component"
);

const fullImpact: ConnectorEntityImpactResponsePayload = {
  entityRecords: 50,
  fieldMappings: 10,
  entityTagAssignments: 3,
  entityGroupMembers: 2,
  refFieldMappings: 0,
};

const blockedImpact: ConnectorEntityImpactResponsePayload = {
  entityRecords: 50,
  fieldMappings: 10,
  entityTagAssignments: 3,
  entityGroupMembers: 2,
  refFieldMappings: 4,
};

const zeroImpact: ConnectorEntityImpactResponsePayload = {
  entityRecords: 0,
  fieldMappings: 0,
  entityTagAssignments: 0,
  entityGroupMembers: 0,
  refFieldMappings: 0,
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  connectorEntityLabel: "Accounts",
  onConfirm: jest.fn(),
  isPending: false,
  impact: fullImpact,
  isLoadingImpact: false,
};

describe("DeleteConnectorEntityDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render dialog when open is true", () => {
    render(<DeleteConnectorEntityDialog {...defaultProps} />);
    expect(
      screen.getByText("Delete Connector Entity")
    ).toBeInTheDocument();
  });

  it("should not render when open is false", () => {
    render(<DeleteConnectorEntityDialog {...defaultProps} open={false} />);
    expect(
      screen.queryByText("Delete Connector Entity")
    ).not.toBeInTheDocument();
  });

  it("should render impact summary with counts", () => {
    render(<DeleteConnectorEntityDialog {...defaultProps} />);
    expect(screen.getByText("50 entity records")).toBeInTheDocument();
    expect(screen.getByText("10 field mappings")).toBeInTheDocument();
    expect(screen.getByText("3 tag assignments")).toBeInTheDocument();
    expect(screen.getByText("2 group memberships")).toBeInTheDocument();
  });

  it("should show blocked state when refFieldMappings > 0", () => {
    render(
      <DeleteConnectorEntityDialog
        {...defaultProps}
        impact={blockedImpact}
      />
    );
    expect(
      screen.getByText(/cannot be deleted because other entities reference it/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("should call onConfirm when no blocking dependencies", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteConnectorEntityDialog
        {...defaultProps}
        impact={fullImpact}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should render FormAlert when serverError is provided", () => {
    render(
      <DeleteConnectorEntityDialog
        {...defaultProps}
        serverError={{ message: "Delete failed", code: "ENTITY_DELETE_FAILED" }}
      />
    );
    expect(screen.getByText(/Delete failed/)).toBeInTheDocument();
    expect(screen.getByText(/ENTITY_DELETE_FAILED/)).toBeInTheDocument();
  });

  it("should not render FormAlert when serverError is null", () => {
    render(
      <DeleteConnectorEntityDialog {...defaultProps} serverError={null} />
    );
    const alerts = screen.getAllByRole("alert");
    alerts.forEach((alert) => {
      expect(alert).not.toHaveTextContent("Delete failed");
    });
  });

  it("should show loading indicator when isLoadingImpact is true", () => {
    render(
      <DeleteConnectorEntityDialog
        {...defaultProps}
        impact={null}
        isLoadingImpact={true}
      />
    );
    expect(
      screen.getByText("Checking associated data...")
    ).toBeInTheDocument();
  });

  it("should show 'No associated data found' when all counts are zero", () => {
    render(
      <DeleteConnectorEntityDialog
        {...defaultProps}
        impact={zeroImpact}
      />
    );
    expect(
      screen.getByText("No associated data found.")
    ).toBeInTheDocument();
  });

  it("should submit on Enter key press (form submission)", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteConnectorEntityDialog
        {...defaultProps}
        impact={fullImpact}
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
      <DeleteConnectorEntityDialog {...defaultProps} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should disable Delete button when isLoadingImpact is true", () => {
    render(
      <DeleteConnectorEntityDialog
        {...defaultProps}
        impact={null}
        isLoadingImpact={true}
      />
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("should show 'Deleting...' when isPending is true", () => {
    render(
      <DeleteConnectorEntityDialog {...defaultProps} isPending={true} />
    );
    expect(
      screen.getByRole("button", { name: "Deleting..." })
    ).toBeDisabled();
  });
});
