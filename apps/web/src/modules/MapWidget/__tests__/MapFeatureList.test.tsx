import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import {
  render,
  screen,
  expectNoAxeViolations,
} from "../../../__tests__/test-utils";
import { MapFeatureListUI } from "../MapFeatureList.component";

import type { RenderedFeature } from "../utils/rendered-features.util";

// #796: the keyboard route into a map's features.

const item = (n: number): RenderedFeature => ({
  key: `s::${n}`,
  layerId: "layer-0-circle",
  source: "s",
  featureId: n,
  label: `Parcel ${n}`,
  properties: {},
  lngLat: [0, 0],
});

describe("MapFeatureListUI", () => {
  it("heads the list with the count in view", () => {
    render(
      <MapFeatureListUI
        items={[item(1), item(2)]}
        total={2}
        selectedKey={null}
        onSelect={() => {}}
      />
    );
    expect(
      screen.getByRole("heading", { level: 3, name: "Features in view (2)" })
    ).toBeInTheDocument();
  });

  it("lists each feature as a button named by its label", () => {
    render(
      <MapFeatureListUI
        items={[item(1), item(2)]}
        total={2}
        selectedKey={null}
        onSelect={() => {}}
      />
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Parcel 2" })
    ).toBeInTheDocument();
  });

  it("marks the selected feature pressed", () => {
    render(
      <MapFeatureListUI
        items={[item(1), item(2)]}
        total={2}
        selectedKey="s::2"
        onSelect={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Parcel 2" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByRole("button", { name: "Parcel 1" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("says how many more are in view past the cap", () => {
    render(
      <MapFeatureListUI
        items={[item(1)]}
        total={250}
        selectedKey={null}
        onSelect={() => {}}
      />
    );
    expect(
      screen.getByText("and 249 more. Zoom in to list them.")
    ).toBeInTheDocument();
  });

  it("says when nothing is in view", () => {
    render(
      <MapFeatureListUI
        items={[]}
        total={0}
        selectedKey={null}
        onSelect={() => {}}
      />
    );
    expect(screen.getByText("No features in view.")).toBeInTheDocument();
  });

  it("selects a feature", async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(
      <MapFeatureListUI
        items={[item(1)]}
        total={1}
        selectedKey={null}
        onSelect={onSelect}
      />
    );
    await user.click(screen.getByRole("button", { name: "Parcel 1" }));
    expect(onSelect).toHaveBeenCalledWith(item(1));
  });

  it("takes its heading level from the page", () => {
    render(
      <MapFeatureListUI
        items={[]}
        total={0}
        selectedKey={null}
        onSelect={() => {}}
        headingLevel={4}
      />
    );
    expect(screen.getByRole("heading", { level: 4 })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <MapFeatureListUI
        items={[item(1), item(2)]}
        total={300}
        selectedKey="s::1"
        onSelect={() => {}}
      />
    );
    await expectNoAxeViolations(container);
  });
});
