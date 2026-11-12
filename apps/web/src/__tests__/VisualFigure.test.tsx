import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { VisualFigureUI } from "../components/VisualFigure.component";
import { expectNoAxeViolations } from "./test-utils";

// #796: every chart and map is a figure named by its title and described by
// its summary, with its data one disclosure away.

const base = {
  kind: "chart" as const,
  summary: "Revenue peaks in February.",
  header: <div>header</div>,
  testId: "d3-widget",
};

describe("VisualFigureUI", () => {
  it("is a figure named by its title and described by its visible summary", () => {
    render(
      <VisualFigureUI {...base} title="Revenue">
        <div>chart body</div>
      </VisualFigureUI>
    );
    const figure = screen.getByRole("figure", { name: "Revenue" });
    expect(figure).toHaveAttribute("data-testid", "d3-widget");
    expect(figure).toHaveAccessibleDescription("Revenue peaks in February.");
    expect(screen.getByText("Revenue peaks in February.")).toBeVisible();
    expect(screen.getByText("chart body")).toBeInTheDocument();
  });

  it("falls back to the kind as its name without a title", () => {
    render(
      <VisualFigureUI {...base} kind="map" testId="map-widget">
        <div />
      </VisualFigureUI>
    );
    expect(screen.getByRole("figure", { name: "Map" })).toBeInTheDocument();
  });

  it("offers no Data button without data", () => {
    render(
      <VisualFigureUI {...base}>
        <div />
      </VisualFigureUI>
    );
    expect(
      screen.queryByRole("button", { name: /show data/i })
    ).not.toBeInTheDocument();
  });

  it("toggles a named data region from the Show data button", async () => {
    const user = userEvent.setup();
    render(
      <VisualFigureUI {...base} title="Revenue" data={<p>the table</p>}>
        <div />
      </VisualFigureUI>
    );
    const button = screen.getByRole("button", { name: "Show data" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("the table")).not.toBeInTheDocument();

    await user.click(button);
    const region = screen.getByRole("region", { name: "Data for Revenue" });
    expect(region).toContainElement(screen.getByText("the table"));
    const hide = screen.getByRole("button", { name: "Hide data" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    expect(hide).toHaveAttribute("aria-controls", region.id);

    await user.click(hide);
    expect(screen.queryByText("the table")).not.toBeInTheDocument();
  });

  it("has no axe violations, closed and open", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VisualFigureUI {...base} title="Revenue" data={<p>the table</p>}>
        <div />
      </VisualFigureUI>
    );
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole("button", { name: "Show data" }));
    await expectNoAxeViolations(container);
  });
});
