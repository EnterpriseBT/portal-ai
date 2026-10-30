import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";

import { MapAttributionUI } from "../MapAttribution.component";

describe("MapAttributionUI (#928)", () => {
  it("renders each attribution's text and allow-listed links", () => {
    render(
      <MapAttributionUI
        attributions={[
          [
            { text: "© " },
            {
              text: "OpenStreetMap",
              href: "https://www.openstreetmap.org/copyright",
            },
            { text: " contributors" },
          ],
          [{ text: "© Corp tiles" }],
        ]}
      />
    );
    const box = screen.getByTestId("map-attribution");
    expect(box).toHaveTextContent(
      "© OpenStreetMap contributors | © Corp tiles"
    );
    const link = screen.getByRole("link", { name: "OpenStreetMap" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.openstreetmap.org/copyright"
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders nothing when there is nothing to credit", () => {
    render(<MapAttributionUI attributions={[]} />);
    expect(screen.queryByTestId("map-attribution")).toBeNull();
  });
});
