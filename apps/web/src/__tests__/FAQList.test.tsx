import { jest } from "@jest/globals";
import React from "react";
import type { FAQEntry } from "@portalai/core/content";

const { render, screen, within } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { FAQList } = await import("../components/FAQList.component");
const { FAQCategory } = await import("@portalai/core/content");

const fixture: FAQEntry[] = [
  {
    question: "How do I connect my first data source?",
    answer: "Open the Connectors page and pick a connector definition.",
    category: FAQCategory.GettingStarted,
    relatedGlossaryTerms: ["Connector Definition", "Connector Instance"],
  },
  {
    question: "What is a Station and why do I need one?",
    answer: "A station bundles connector instances and tool packs.",
    category: FAQCategory.GettingStarted,
  },
  {
    question: "What do job statuses mean?",
    answer: "Pending, active, completed, failed, stalled, cancelled.",
    category: FAQCategory.Jobs,
  },
];

/**
 * Expansion is controlled since #365 — a `#faq-entry-<slug>` anchor has to be
 * able to open an entry that is already on screen. This harness holds the set
 * so the behavior tests still read as a user clicking accordions.
 */
const ControlledFAQList: React.FC<{
  entries?: FAQEntry[];
  groupByCategory?: boolean;
  initialExpanded?: string[];
  onSelectTerm?: (term: string) => void;
  registerEntryRef?: (slug: string, el: HTMLElement | null) => void;
}> = ({ entries = fixture, initialExpanded = [], ...rest }) => {
  const [expanded, setExpanded] = React.useState<Set<string>>(
    new Set(initialExpanded)
  );

  return (
    <FAQList
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

describe("FAQList", () => {
  it("renders one accordion per provided entry", () => {
    render(<ControlledFAQList />);
    expect(
      screen.getByTestId("faq-entry-how-do-i-connect-my-first-data-source")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("faq-entry-what-is-a-station-and-why-do-i-need-one")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("faq-entry-what-do-job-statuses-mean")
    ).toBeInTheDocument();
  });

  it("groups entries under category section headers when groupByCategory is true", () => {
    render(<ControlledFAQList groupByCategory />);
    const headers = screen.getAllByText(
      /Getting Started|Jobs & Background Tasks/
    );
    expect(headers).toHaveLength(2);
    expect(
      screen.getByTestId(`faq-category-header-${FAQCategory.GettingStarted}`)
    ).toHaveTextContent("Getting Started");
    expect(
      screen.getByTestId(`faq-category-header-${FAQCategory.Jobs}`)
    ).toHaveTextContent("Jobs & Background Tasks");
  });

  it("does not render category headers when groupByCategory is false (flat list mode)", () => {
    render(<ControlledFAQList groupByCategory={false} />);
    expect(
      screen.queryByTestId(`faq-category-header-${FAQCategory.GettingStarted}`)
    ).not.toBeInTheDocument();
  });

  it("expanding a question reveals the answer text", async () => {
    const user = userEvent.setup();
    render(<ControlledFAQList />);
    const entry = screen.getByTestId(
      "faq-entry-how-do-i-connect-my-first-data-source"
    );
    await user.click(
      within(entry).getByText("How do I connect my first data source?")
    );
    expect(
      within(entry).getByText(
        "Open the Connectors page and pick a connector definition."
      )
    ).toBeInTheDocument();
  });

  it("renders related glossary term links when present", async () => {
    const user = userEvent.setup();
    render(<ControlledFAQList />);
    const entry = screen.getByTestId(
      "faq-entry-how-do-i-connect-my-first-data-source"
    );
    await user.click(
      within(entry).getByText("How do I connect my first data source?")
    );
    expect(within(entry).getByText("Related terms")).toBeInTheDocument();
    expect(within(entry).getByText("Connector Definition")).toBeInTheDocument();
    expect(within(entry).getByText("Connector Instance")).toBeInTheDocument();
  });

  it("clicking a related glossary term invokes onSelectTerm with that term", async () => {
    const user = userEvent.setup();
    const onSelectTerm = jest.fn();
    render(<ControlledFAQList onSelectTerm={onSelectTerm} />);

    const entry = screen.getByTestId(
      "faq-entry-how-do-i-connect-my-first-data-source"
    );
    await user.click(
      within(entry).getByText("How do I connect my first data source?")
    );
    await user.click(within(entry).getByText("Connector Definition"));
    expect(onSelectTerm).toHaveBeenCalledWith("Connector Definition");
  });

  it("renders empty-state message when entries array is empty", () => {
    render(<ControlledFAQList entries={[]} />);
    expect(screen.getByTestId("faq-empty")).toBeInTheDocument();
    expect(
      screen.getByText("No FAQ entries match your search.")
    ).toBeInTheDocument();
  });
});

// ── Controlled expansion (#365) ─────────────────────────────────────

describe("FAQList expansion", () => {
  const renderControlled = (
    props: Partial<React.ComponentProps<typeof FAQList>> = {}
  ) =>
    render(
      <FAQList
        entries={fixture}
        expandedSlugs={new Set<string>()}
        onToggleEntry={jest.fn()}
        {...props}
      />
    );

  it("expands exactly the entries named in expandedSlugs", () => {
    renderControlled({
      expandedSlugs: new Set(["what-do-job-statuses-mean"]),
    });

    expect(
      within(
        screen.getByTestId("faq-entry-what-do-job-statuses-mean")
      ).getByText("Pending, active, completed, failed, stalled, cancelled.")
    ).toBeVisible();
    expect(
      within(
        screen.getByTestId("faq-entry-how-do-i-connect-my-first-data-source")
      ).getByText("Open the Connectors page and pick a connector definition.")
    ).not.toBeVisible();
  });

  it("expands per the set in grouped mode too", () => {
    renderControlled({
      groupByCategory: true,
      expandedSlugs: new Set(["what-do-job-statuses-mean"]),
    });

    expect(
      within(
        screen.getByTestId("faq-entry-what-do-job-statuses-mean")
      ).getByText("Pending, active, completed, failed, stalled, cancelled.")
    ).toBeVisible();
  });

  it("opens an entry that is already mounted when the set changes", () => {
    const { rerender } = renderControlled();
    const before = screen.getByTestId("faq-entry-what-do-job-statuses-mean");
    expect(
      within(before).getByText(
        "Pending, active, completed, failed, stalled, cancelled."
      )
    ).not.toBeVisible();

    rerender(
      <FAQList
        entries={fixture}
        expandedSlugs={new Set(["what-do-job-statuses-mean"])}
        onToggleEntry={jest.fn()}
      />
    );

    const after = screen.getByTestId("faq-entry-what-do-job-statuses-mean");
    expect(after).toBe(before); // no remount
    expect(
      within(after).getByText(
        "Pending, active, completed, failed, stalled, cancelled."
      )
    ).toBeVisible();
  });

  it("reports a toggle with the entry slug", async () => {
    const user = userEvent.setup();
    const onToggleEntry = jest.fn();
    renderControlled({ onToggleEntry });

    await user.click(
      within(
        screen.getByTestId("faq-entry-what-do-job-statuses-mean")
      ).getByText("What do job statuses mean?")
    );

    expect(onToggleEntry).toHaveBeenCalledWith("what-do-job-statuses-mean");
  });

  it("registers entry refs by slug, and clears them on unmount", () => {
    const registerEntryRef = jest.fn();
    const { unmount } = renderControlled({ registerEntryRef });

    expect(registerEntryRef).toHaveBeenCalledWith(
      "what-do-job-statuses-mean",
      expect.any(HTMLElement)
    );
    registerEntryRef.mockClear();

    unmount();
    expect(registerEntryRef).toHaveBeenCalledWith(
      "what-do-job-statuses-mean",
      null
    );
  });
});
