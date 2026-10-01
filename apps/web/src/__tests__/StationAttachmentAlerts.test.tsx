const { render, screen } = await import("./test-utils");
const { StationAttachmentAlertsUI } =
  await import("../components/StationAttachmentAlerts.component");

describe("StationAttachmentAlertsUI (#674)", () => {
  it("renders one combined alert when both kinds are missing", () => {
    render(<StationAttachmentAlertsUI viewCount={0} connectorCount={0} />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(
      "No views or connectors are attached to this station yet."
    );
  });

  it("names only the views when connectors are attached", () => {
    render(<StationAttachmentAlertsUI viewCount={0} connectorCount={2} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No views are attached to this station yet."
    );
  });

  it("names only the connectors when views are attached", () => {
    render(<StationAttachmentAlertsUI viewCount={1} connectorCount={0} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No connectors are attached to this station yet."
    );
  });

  it("renders nothing when both kinds are attached", () => {
    render(<StationAttachmentAlertsUI viewCount={1} connectorCount={1} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
