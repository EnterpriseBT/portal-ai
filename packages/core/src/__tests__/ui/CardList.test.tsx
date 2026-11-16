import React from "react";
import { render, screen, within } from "@testing-library/react";

import { CardList } from "../../ui/CardList";
import { DetailCard } from "../../ui/DetailCard";
import { expectNoAxeViolations } from "../axe.util";

// #794: a card list is a list, so a screen reader announces its size and
// moves between its items.
describe("CardList", () => {
  const renderList = () =>
    render(
      <CardList aria-label="Stations">
        <DetailCard title="Alpha" headingLevel={2} />
        <DetailCard title="Beta" headingLevel={2} />
      </CardList>
    );

  it("is a list named by its aria-label", () => {
    renderList();
    expect(screen.getByRole("list", { name: "Stations" })).toBeInTheDocument();
  });

  it("wraps each child in a list item", () => {
    renderList();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Alpha");
  });

  it("has no axe violations", async () => {
    const { container } = renderList();
    await expectNoAxeViolations(container);
  });
});
