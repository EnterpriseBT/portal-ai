import React, { useState } from "react";

import { jest } from "@jest/globals";

import type { TagMatch } from "../components/BrowseByTag.component";

const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { BrowseByTagUI } = await import("../components/BrowseByTag.component");

const tags = [
  { tag: { id: "t1", name: "Finance", color: "#2e7d32" }, count: 2 },
  { tag: { id: "t2", name: "Field ops", color: null }, count: 1 },
];
const MATCHES: Record<string, TagMatch[]> = {
  t1: [
    { id: "s1", name: "Finance Close", type: "station", href: "/stations/s1" },
    { id: "v1", name: "GL accounts", type: "view", href: "/views/v1" },
  ],
  t2: [
    {
      id: "c1",
      name: "Inspections CSV",
      type: "connector",
      href: "/connectors/c1",
    },
  ],
};

/** Holds the selection the way the container will. */
const Stateful: React.FC = () => {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <BrowseByTagUI
      tags={tags}
      selectedTagId={selected}
      onSelectTag={setSelected}
      matches={selected ? MATCHES[selected] : undefined}
    />
  );
};

describe("BrowseByTagUI", () => {
  it("lists each tag as a toggle with its count, in order", async () => {
    const { container } = render(<Stateful />);
    const list = screen.getByRole("list", { name: "Tags" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((b) => b.textContent)
    ).toEqual(["Finance (2)", "Field ops (1)"]);
    expect(screen.queryByRole("list", { name: /^Tagged/ })).toBeNull();
    await expectNoAxeViolations(container);
  });

  it("lists what has a tag when it's pressed, with each type, and hides it on a second press", async () => {
    const { container } = render(<Stateful />);
    const finance = screen.getByRole("button", { name: "Finance (2)" });
    await userEvent.click(finance);
    expect(finance).toHaveAttribute("aria-pressed", "true");
    const matches = screen.getByRole("list", { name: "Tagged Finance" });
    const links = within(matches).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Finance CloseStation",
      "GL accountsView",
    ]);
    expect(links[0]).toHaveAttribute("href", "/stations/s1");
    // The chip points at what it shows.
    expect(
      document.getElementById(finance.getAttribute("aria-controls") ?? "")
    ).toContainElement(matches);
    await expectNoAxeViolations(container);

    await userEvent.click(finance);
    expect(finance).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("list", { name: "Tagged Finance" })).toBeNull();
  });

  it("switches to another tag's matches", async () => {
    render(<Stateful />);
    await userEvent.click(screen.getByRole("button", { name: "Finance (2)" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Field ops (1)" })
    );
    expect(screen.queryByRole("list", { name: "Tagged Finance" })).toBeNull();
    expect(
      within(screen.getByRole("list", { name: "Tagged Field ops" })).getByRole(
        "link",
        { name: /Inspections CSV/ }
      )
    ).toHaveAttribute("href", "/connectors/c1");
  });

  it.each([
    ["loading", "status", "Loading items tagged Finance…"],
    ["error", "alert", "Couldn't load the items tagged Finance."],
  ] as const)(
    "shows the %s state for the selected tag",
    async (status, role, text) => {
      const { container } = render(
        <BrowseByTagUI
          tags={tags}
          selectedTagId="t1"
          onSelectTag={jest.fn()}
          matchesStatus={status}
        />
      );
      expect(screen.getByRole(role)).toHaveTextContent(text);
      await expectNoAxeViolations(container);
    }
  );

  it("says when nothing visible has the tag", () => {
    render(
      <BrowseByTagUI
        tags={tags}
        selectedTagId="t1"
        onSelectTag={jest.fn()}
        matches={[]}
      />
    );
    expect(
      screen.getByText("Nothing you can see has this tag.")
    ).toBeInTheDocument();
  });

  it("shows the matches' search and paging only while a tag is selected", () => {
    const toolbar = <div data-testid="matches-toolbar" />;
    const { rerender } = render(
      <BrowseByTagUI
        tags={tags}
        selectedTagId={null}
        onSelectTag={jest.fn()}
        matchesToolbar={toolbar}
      />
    );
    expect(screen.queryByTestId("matches-toolbar")).toBeNull();
    rerender(
      <BrowseByTagUI
        tags={tags}
        selectedTagId="t1"
        onSelectTag={jest.fn()}
        matches={MATCHES.t1}
        matchesToolbar={toolbar}
      />
    );
    const finance = screen.getByRole("button", { name: "Finance (2)" });
    // The toolbar sits in the region the chip controls, above the list.
    const region = document.getElementById(
      finance.getAttribute("aria-controls") ?? ""
    );
    expect(region).toContainElement(screen.getByTestId("matches-toolbar"));
    expect(
      screen
        .getByTestId("matches-toolbar")
        .compareDocumentPosition(
          screen.getByRole("list", { name: "Tagged Finance" })
        ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("says when a search matched nothing, distinct from an empty tag", () => {
    render(
      <BrowseByTagUI
        tags={tags}
        selectedTagId="t1"
        onSelectTag={jest.fn()}
        matches={[]}
        matchesFiltered
      />
    );
    expect(
      screen.getByText("No items tagged Finance match your search.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing you can see has this tag.")
    ).not.toBeInTheDocument();
  });

  it("clears a selected tag that's no longer listed", () => {
    const onSelectTag = jest.fn();
    render(
      <BrowseByTagUI
        tags={tags}
        selectedTagId="gone"
        onSelectTag={onSelectTag}
      />
    );
    expect(onSelectTag).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("list", { name: /^Tagged/ })).toBeNull();
  });

  it("shows a teaching empty state", async () => {
    const { container } = render(
      <BrowseByTagUI tags={[]} selectedTagId={null} onSelectTag={jest.fn()} />
    );
    expect(screen.getByText("No tags yet")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "How do tags work?" })
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
