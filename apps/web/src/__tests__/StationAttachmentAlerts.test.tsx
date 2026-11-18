const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { StationAttachmentAlertsUI } =
  await import("../components/StationAttachmentAlerts.component");

describe("StationAttachmentAlertsUI (#674)", () => {
  it("renders one combined alert when both kinds are missing", () => {
    render(<StationAttachmentAlertsUI viewCount={0} connectorCount={0} />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent(
      "No views or connectors are attached to this station. It works without them. Attach a view to query entity data here, or a connector to create and edit entities."
    );
  });

  it("names only the views when connectors are attached", () => {
    render(<StationAttachmentAlertsUI viewCount={0} connectorCount={2} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No views are attached to this station. Attach a view to query entity data here."
    );
  });

  it("names only the connectors when views are attached", () => {
    render(<StationAttachmentAlertsUI viewCount={1} connectorCount={0} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No connectors are attached to this station. Attach a connector to create and edit entities here."
    );
  });

  // #848: a station without views or connectors is valid, so the notice
  // informs rather than warns.
  it("renders the notice as an info alert, not a warning", () => {
    render(<StationAttachmentAlertsUI viewCount={0} connectorCount={0} />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toMatch(/MuiAlert-(colorInfo|outlinedInfo)/);
    expect(alert.className).not.toMatch(/Warning/);
  });

  it("renders nothing when both kinds are attached", () => {
    render(<StationAttachmentAlertsUI viewCount={1} connectorCount={1} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <StationAttachmentAlertsUI viewCount={0} connectorCount={0} />
    );
    await expectNoAxeViolations(container);
  });

  // #1055: when the plan excludes the station's packs, the plan is the
  // reason, so the notice names the packs and links to plans.
  describe("plan-excluded", () => {
    const planExcluded = (
      <StationAttachmentAlertsUI
        viewCount={0}
        connectorCount={1}
        dataSetup="plan-excluded"
        excludedPackNames={["GIS"]}
      />
    );

    it("names the pack and links to plans instead of suggesting a view", () => {
      render(planExcluded);
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent(
        "GIS isn't included in your plan, so attaching a view won't make data available on this station."
      );
      expect(alert).not.toHaveTextContent(/Attach a view/);
      expect(screen.getByRole("link", { name: "View plans" })).toHaveAttribute(
        "href",
        "/settings?tab=billing"
      );
    });

    it("keeps today's notice and no link in the other states", () => {
      render(
        <StationAttachmentAlertsUI
          viewCount={0}
          connectorCount={1}
          dataSetup="none"
          excludedPackNames={["GIS"]}
        />
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No views are attached to this station. Attach a view to query entity data here."
      );
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("shows even when views and connectors are attached", () => {
      render(
        <StationAttachmentAlertsUI
          viewCount={2}
          connectorCount={2}
          dataSetup="plan-excluded"
          excludedPackNames={["GIS"]}
        />
      );
      expect(screen.getByRole("alert")).toHaveTextContent(/GIS isn't included/);
    });

    it("has no axe violations", async () => {
      const { container } = render(planExcluded);
      await expectNoAxeViolations(container);
    });
  });
});
