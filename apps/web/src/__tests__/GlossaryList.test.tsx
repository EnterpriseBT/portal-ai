import { jest } from "@jest/globals";
import React from "react";
import type { GlossaryEntry } from "@portalai/core/content";

const { render, screen, within } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { GlossaryList } = await import("../components/GlossaryList.component");
const { GlossaryCategory } = await import("@portalai/core/content");

const fixture: GlossaryEntry[] = [
  {
    term: "Connector Instance",
    category: GlossaryCategory.DataSources,
    definition: "A live connection to a data source.",
    example: "Upload a CSV file to create a connector instance.",
    relatedTerms: ["Connector Definition"],
    pageRoute: "/connectors",
  },
  {
    term: "Field Mapping",
    category: GlossaryCategory.DataModeling,
    definition: "A link from a raw field to a column definition.",
  },
  {
    term: "Station",
    category: GlossaryCategory.Analytics,
    definition: "A workspace bundling connectors and tool packs.",
    example: "Create a Sales station.",
    relatedTerms: ["Connector Instance"],
    pageRoute: "/stations",
  },
];

/**
 * Expansion is controlled since #365 — a `#glossary-entry-<slug>` anchor has
 * to be able to open an entry that is already on screen, which uncontrolled
 * `defaultExpanded` could not do. This harness holds the set so the behavior
 * tests still read as a user clicking accordions.
 */
const ControlledGlossaryList: React.FC<{
  entries?: GlossaryEntry[];
  initialExpanded?: string[];
  onSelectTerm?: (term: string) => void;
  registerEntryRef?: (slug: string, el: HTMLElement | null) => void;
}> = ({ entries = fixture, initialExpanded = [], ...rest }) => {
  const [expanded, setExpanded] = React.useState<Set<string>>(
    new Set(initialExpanded)
  );

  return (
    <GlossaryList
      entries={entries}
      expandedSlugs={expanded}
      onToggleEntry={(slug) =>
        setExpanded((prev) => {
          const next = new Set(prev);
          if (next.has(slug)) next.delete(slug);
          else next.add(slug);
          return next;
        })
      }
      {...rest}
    />
  );
};

describe("GlossaryList", () => {
  it("renders one accordion per provided entry", () => {
    render(<ControlledGlossaryList />);
    expect(
      screen.getByTestId("glossary-entry-connector-instance")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("glossary-entry-field-mapping")
    ).toBeInTheDocument();
    expect(screen.getByTestId("glossary-entry-station")).toBeInTheDocument();
  });

  it("renders the category label as a chip on each entry", () => {
    render(<ControlledGlossaryList />);
    expect(
      screen.getByTestId("glossary-category-chip-connector-instance")
    ).toHaveTextContent("Data Sources");
    expect(
      screen.getByTestId("glossary-category-chip-field-mapping")
    ).toHaveTextContent("Data Modeling");
    expect(
      screen.getByTestId("glossary-category-chip-station")
    ).toHaveTextContent("Analytics");
  });

  it("expanding an accordion reveals definition, example, related, and 'Found on'", async () => {
    const user = userEvent.setup();
    render(<ControlledGlossaryList />);

    const entry = screen.getByTestId("glossary-entry-connector-instance");
    await user.click(within(entry).getByText("Connector Instance"));

    expect(
      within(entry).getByText("A live connection to a data source.")
    ).toBeInTheDocument();
    expect(within(entry).getByText("Example")).toBeInTheDocument();
    expect(
      within(entry).getByText(
        "Upload a CSV file to create a connector instance."
      )
    ).toBeInTheDocument();
    expect(within(entry).getByText("Related")).toBeInTheDocument();
    expect(within(entry).getByText("Connector Definition")).toBeInTheDocument();
    expect(within(entry).getByText("Found on")).toBeInTheDocument();
    expect(within(entry).getByText("/connectors")).toBeInTheDocument();
  });

  it("omits 'Example' section when entry has no example", () => {
    render(
      <ControlledGlossaryList
        entries={[fixture[1]]}
        initialExpanded={["field-mapping"]}
      />
    );
    const entry = screen.getByTestId("glossary-entry-field-mapping");
    expect(within(entry).queryByText("Example")).not.toBeInTheDocument();
  });

  it("omits 'Related' section when entry has no relatedTerms", () => {
    render(
      <ControlledGlossaryList
        entries={[fixture[1]]}
        initialExpanded={["field-mapping"]}
      />
    );
    const entry = screen.getByTestId("glossary-entry-field-mapping");
    expect(within(entry).queryByText("Related")).not.toBeInTheDocument();
  });

  it("omits 'Found on' section when entry has no pageRoute", () => {
    render(
      <ControlledGlossaryList
        entries={[fixture[1]]}
        initialExpanded={["field-mapping"]}
      />
    );
    const entry = screen.getByTestId("glossary-entry-field-mapping");
    expect(within(entry).queryByText("Found on")).not.toBeInTheDocument();
  });

  it("clicking a related term invokes onSelectTerm with that term", async () => {
    const user = userEvent.setup();
    const onSelectTerm = jest.fn();
    render(
      <ControlledGlossaryList
        initialExpanded={["connector-instance"]}
        onSelectTerm={onSelectTerm}
      />
    );

    const entry = screen.getByTestId("glossary-entry-connector-instance");
    await user.click(within(entry).getByText("Connector Definition"));
    expect(onSelectTerm).toHaveBeenCalledWith("Connector Definition");
  });

  it("renders empty-state message when entries array is empty", () => {
    render(<ControlledGlossaryList entries={[]} />);
    expect(screen.getByTestId("glossary-empty")).toBeInTheDocument();
    expect(
      screen.getByText("No glossary entries match your search.")
    ).toBeInTheDocument();
  });
});

// ── Controlled expansion (#365) ─────────────────────────────────────

describe("GlossaryList expansion", () => {
  const renderControlled = (
    props: Partial<React.ComponentProps<typeof GlossaryList>> = {}
  ) =>
    render(
      <GlossaryList
        entries={fixture}
        expandedSlugs={new Set<string>()}
        onToggleEntry={jest.fn()}
        {...props}
      />
    );

  it("expands exactly the entries named in expandedSlugs", () => {
    renderControlled({ expandedSlugs: new Set(["station"]) });

    expect(
      within(screen.getByTestId("glossary-entry-station")).getByText(
        "A workspace bundling connectors and tool packs."
      )
    ).toBeVisible();
    expect(
      within(screen.getByTestId("glossary-entry-field-mapping")).getByText(
        "A link from a raw field to a column definition."
      )
    ).not.toBeVisible();
  });

  it("opens an entry that is already mounted when the set changes", () => {
    // The bug uncontrolled `defaultExpanded` had: an accordion already on
    // screen ignored a later expansion request, so a deep link scrolled to a
    // collapsed entry. The node must stay the same and still open.
    const { rerender } = renderControlled();
    const before = screen.getByTestId("glossary-entry-station");
    expect(
      within(before).getByText(
        "A workspace bundling connectors and tool packs."
      )
    ).not.toBeVisible();

    rerender(
      <GlossaryList
        entries={fixture}
        expandedSlugs={new Set(["station"])}
        onToggleEntry={jest.fn()}
      />
    );

    const after = screen.getByTestId("glossary-entry-station");
    expect(after).toBe(before); // no remount
    expect(
      within(after).getByText("A workspace bundling connectors and tool packs.")
    ).toBeVisible();
  });

  it("reports a toggle with the entry slug", async () => {
    const user = userEvent.setup();
    const onToggleEntry = jest.fn();
    renderControlled({ onToggleEntry });

    await user.click(
      within(screen.getByTestId("glossary-entry-station")).getByText("Station")
    );

    expect(onToggleEntry).toHaveBeenCalledWith("station");
  });

  it("registers entry refs by slug, and clears them on unmount", () => {
    const registerEntryRef = jest.fn();
    const { unmount } = renderControlled({ registerEntryRef });

    expect(registerEntryRef).toHaveBeenCalledWith(
      "station",
      expect.any(HTMLElement)
    );
    registerEntryRef.mockClear();

    unmount();
    expect(registerEntryRef).toHaveBeenCalledWith("station", null);
  });
});
