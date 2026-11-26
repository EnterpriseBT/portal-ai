import React from "react";
import { render, screen } from "@testing-library/react";

import { PageSection } from "../../ui/PageSection";
import { PageSectionGroup } from "../../ui/PageSectionGroup";
import { expectNoAxeViolations } from "../axe.util";

describe("PageSectionGroup", () => {
  it("frames several sections, each keeping its own h2", async () => {
    const { container } = render(
      <PageSectionGroup data-testid="group">
        <PageSection title="Browse by tag" variant="plain">
          <p>Tags</p>
        </PageSection>
        <PageSection title="Needs attention" variant="plain">
          <p>Jobs</p>
        </PageSection>
      </PageSectionGroup>
    );
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    ).toEqual(["Browse by tag", "Needs attention"]);
    expect(screen.getByTestId("group")).toContainElement(
      screen.getByText("Jobs")
    );
    expect(container.querySelectorAll("hr")).toHaveLength(1);
    await expectNoAxeViolations(container);
  });
});
