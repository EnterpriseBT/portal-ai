import { jest } from "@jest/globals";
import type { ConnectorInstanceImpact } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { DeleteConnectorInstanceDialog } = await import(
  "../components/DeleteConnectorInstanceDialog.component"
);

const fullImpact: ConnectorInstanceImpact = {
  connectorEntities: 3,
  entityRecords: 47,
  fieldMappings: 12,
  entityTagAssignments: 5,
  entityGroupMembers: 2,
  stations: 1,
};

const zeroImpact: ConnectorInstanceImpact = {
  connectorEntities: 0,
  entityRecords: 0,
  fieldMappings: 0,
  entityTagAssignments: 0,
  entityGroupMembers: 0,
  stations: 0,
};

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  connectorInstanceName: "Salesforce Prod",
  onConfirm: jest.fn(),
  isPending: false,
  impact: fullImpact,
  isLoadingImpact: false,
};

describe("DeleteConnectorInstanceDialog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render dialog when open is true", () => {
    render(<DeleteConnectorInstanceDialog {...defaultProps} />);
    expect(
      screen.getByText("Delete Connector Instance")
    ).toBeInTheDocument();
  });

  it("should not render content when open is false", () => {
    render(<DeleteConnectorInstanceDialog {...defaultProps} open={false} />);
    expect(
      screen.queryByText("Delete Connector Instance")
    ).not.toBeInTheDocument();
  });

  it("should display connector instance name in confirmation text", () => {
    render(<DeleteConnectorInstanceDialog {...defaultProps} />);
    expect(screen.getByText("Salesforce Prod")).toBeInTheDocument();
  });

  it("should display impact counts when impact data is provided", () => {
    render(<DeleteConnectorInstanceDialog {...defaultProps} />);
    expect(screen.getByText("3 connector entities")).toBeInTheDocument();
    expect(screen.getByText("47 entity records")).toBeInTheDocument();
    expect(screen.getByText("12 field mappings")).toBeInTheDocument();
    expect(screen.getByText("5 tag assignments")).toBeInTheDocument();
    expect(screen.getByText("2 group memberships")).toBeInTheDocument();
    expect(
      screen.getByText("1 stations will be unlinked")
    ).toBeInTheDocument();
  });

  it("should omit items with zero count from impact summary", () => {
    const partialImpact: ConnectorInstanceImpact = {
      ...zeroImpact,
      connectorEntities: 2,
      entityRecords: 10,
    };
    render(
      <DeleteConnectorInstanceDialog
        {...defaultProps}
        impact={partialImpact}
      />
    );
    expect(screen.getByText("2 connector entities")).toBeInTheDocument();
    expect(screen.getByText("10 entity records")).toBeInTheDocument();
    expect(screen.queryByText(/field mappings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/tag assignments/)).not.toBeInTheDocument();
    expect(screen.queryByText(/group memberships/)).not.toBeInTheDocument();
    expect(screen.queryByText(/stations/)).not.toBeInTheDocument();
  });

  it("should show loading indicator when isLoadingImpact is true", () => {
    render(
      <DeleteConnectorInstanceDialog
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
      <DeleteConnectorInstanceDialog
        {...defaultProps}
        impact={zeroImpact}
      />
    );
    expect(
      screen.getByText("No associated data found.")
    ).toBeInTheDocument();
  });

  it("should call onConfirm when Delete button is clicked", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteConnectorInstanceDialog {...defaultProps} onConfirm={onConfirm} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should submit on Enter key press (form submission)", () => {
    const onConfirm = jest.fn();
    render(
      <DeleteConnectorInstanceDialog {...defaultProps} onConfirm={onConfirm} />
    );
    const form = screen.getByRole("button", { name: "Delete" }).closest("form")!;
    fireEvent.submit(form);
    expect(onConfirm).toHaveBeenCalled();
  });

  it("should call onClose when Cancel button is clicked", () => {
    const onClose = jest.fn();
    render(
      <DeleteConnectorInstanceDialog {...defaultProps} onClose={onClose} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("should disable Delete button when isPending is true", () => {
    render(
      <DeleteConnectorInstanceDialog {...defaultProps} isPending={true} />
    );
    expect(
      screen.getByRole("button", { name: "Deleting..." })
    ).toBeDisabled();
  });

  it("should disable Delete button when isLoadingImpact is true", () => {
    render(
      <DeleteConnectorInstanceDialog
        {...defaultProps}
        impact={null}
        isLoadingImpact={true}
      />
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });
});
