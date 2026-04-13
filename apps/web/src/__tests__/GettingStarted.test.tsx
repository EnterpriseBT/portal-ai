import { jest } from "@jest/globals";
import type { GettingStartedStep } from "../utils/getting-started.util";

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { GettingStarted } = await import(
  "../components/GettingStarted.component"
);
const { ApplicationRoute } = await import("../utils/routes.util");

const fixture: GettingStartedStep[] = [
  {
    title: "Connect a data source",
    description: "Pick a connector definition and configure it.",
    ctaLabel: "Go to Connectors",
    ctaRoute: ApplicationRoute.Connectors,
  },
  {
    title: "Map your fields",
    description: "Open the entity and map fields to column definitions.",
    ctaLabel: "Go to Entities",
    ctaRoute: ApplicationRoute.Entities,
  },
  {
    title: "Create a station",
    description: "Bundle connectors with tool packs.",
    ctaLabel: "Go to Stations",
    ctaRoute: ApplicationRoute.Stations,
  },
  {
    title: "Open a portal",
    description: "Launch a portal session and start asking questions.",
    ctaLabel: "Go to Stations",
    ctaRoute: ApplicationRoute.Stations,
  },
];

describe("GettingStarted", () => {
  it("renders all four steps in order with title, description, and step number", () => {
    render(<GettingStarted steps={fixture} onNavigate={jest.fn()} />);
    for (let i = 0; i < fixture.length; i++) {
      const stepNumber = i + 1;
      const card = screen.getByTestId(`getting-started-step-${stepNumber}`);
      expect(card).toHaveTextContent(fixture[i].title);
      expect(card).toHaveTextContent(fixture[i].description);
    }
  });

  it("clicking a step's CTA invokes onNavigate with the step's route", async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    render(<GettingStarted steps={fixture} onNavigate={onNavigate} />);

    const connectorsButtons = screen.getAllByRole("button", {
      name: "Go to Connectors",
    });
    await user.click(connectorsButtons[0]);
    expect(onNavigate).toHaveBeenCalledWith(ApplicationRoute.Connectors);

    onNavigate.mockClear();
    const entitiesButton = screen.getByRole("button", { name: "Go to Entities" });
    await user.click(entitiesButton);
    expect(onNavigate).toHaveBeenCalledWith(ApplicationRoute.Entities);
  });

  it("step numbers render as 1, 2, 3, 4", () => {
    render(<GettingStarted steps={fixture} onNavigate={jest.fn()} />);
    for (let i = 1; i <= 4; i++) {
      expect(
        screen.getByTestId(`getting-started-step-number-${i}`)
      ).toHaveTextContent(String(i));
    }
  });
});
