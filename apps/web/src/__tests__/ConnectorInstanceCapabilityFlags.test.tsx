/**
 * #689: the connector's Write/Sync/Push flags are controls only for a caller
 * with write on the instance; for everyone else they read as text. A running
 * job disables them and says why.
 */
import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { ConnectorInstanceCapabilityFlagsUI } =
  await import("../components/ConnectorInstanceCapabilityFlags.component");

const baseProps = {
  supported: { write: true, sync: true, push: false },
  flags: { read: true, write: false, sync: true, push: false },
  canEdit: true,
  lockedReason: null,
  isPending: false,
  onChange: jest.fn(),
};

describe("ConnectorInstanceCapabilityFlagsUI", () => {
  it("renders a checkbox per flag for a writer", () => {
    render(<ConnectorInstanceCapabilityFlagsUI {...baseProps} />);
    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    expect(screen.getByRole("checkbox", { name: "Sync" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Write" })).not.toBeChecked();
  });

  it("reports a toggle through onChange", () => {
    const onChange = jest.fn();
    render(
      <ConnectorInstanceCapabilityFlagsUI {...baseProps} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Write" }));
    expect(onChange).toHaveBeenCalledWith("write", true);
  });

  it("disables unsupported flags", () => {
    render(<ConnectorInstanceCapabilityFlagsUI {...baseProps} />);
    expect(screen.getByRole("checkbox", { name: "Push" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Write" })).not.toBeDisabled();
  });

  it("renders the enabled flags as text, with no controls, without write", () => {
    render(
      <ConnectorInstanceCapabilityFlagsUI {...baseProps} canEdit={false} />
    );
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByText("Read")).toBeInTheDocument();
    expect(screen.getByText("Sync")).toBeInTheDocument();
    expect(screen.queryByText("Write")).toBeNull();
    expect(screen.queryByText("Push")).toBeNull();
  });

  it("disables every control and names the running job while locked", () => {
    const reason =
      "Sync is running on this connector — try again when it finishes.";
    render(
      <ConnectorInstanceCapabilityFlagsUI
        {...baseProps}
        lockedReason={reason}
      />
    );
    for (const name of ["Write", "Sync", "Push"]) {
      expect(screen.getByRole("checkbox", { name })).toBeDisabled();
    }
    expect(screen.getByText(reason)).toBeInTheDocument();
  });

  it("disables the controls while an update is pending", () => {
    render(<ConnectorInstanceCapabilityFlagsUI {...baseProps} isPending />);
    expect(screen.getByRole("checkbox", { name: "Write" })).toBeDisabled();
  });
});
