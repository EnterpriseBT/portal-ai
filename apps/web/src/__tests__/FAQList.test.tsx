import { jest } from "@jest/globals";
import type { FAQEntry } from "../utils/faq.util";

const { render, screen, within } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { FAQList } = await import("../components/FAQList.component");
const { FAQCategory } = await import("../utils/faq.util");

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

describe("FAQList", () => {
  it("renders one accordion per provided entry", () => {
    render(<FAQList entries={fixture} />);
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
    render(<FAQList entries={fixture} groupByCategory />);
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
    render(<FAQList entries={fixture} groupByCategory={false} />);
    expect(
      screen.queryByTestId(`faq-category-header-${FAQCategory.GettingStarted}`)
    ).not.toBeInTheDocument();
  });

  it("expanding a question reveals the answer text", async () => {
    const user = userEvent.setup();
    render(<FAQList entries={fixture} />);
    const entry = screen.getByTestId(
      "faq-entry-how-do-i-connect-my-first-data-source"
    );
    await user.click(within(entry).getByText("How do I connect my first data source?"));
    expect(
      within(entry).getByText(
        "Open the Connectors page and pick a connector definition."
      )
    ).toBeInTheDocument();
  });

  it("renders related glossary term links when present", async () => {
    const user = userEvent.setup();
    render(<FAQList entries={fixture} />);
    const entry = screen.getByTestId(
      "faq-entry-how-do-i-connect-my-first-data-source"
    );
    await user.click(within(entry).getByText("How do I connect my first data source?"));
    expect(within(entry).getByText("Related terms")).toBeInTheDocument();
    expect(within(entry).getByText("Connector Definition")).toBeInTheDocument();
    expect(within(entry).getByText("Connector Instance")).toBeInTheDocument();
  });

  it("clicking a related glossary term invokes onSelectTerm with that term", async () => {
    const user = userEvent.setup();
    const onSelectTerm = jest.fn();
    render(<FAQList entries={fixture} onSelectTerm={onSelectTerm} />);

    const entry = screen.getByTestId(
      "faq-entry-how-do-i-connect-my-first-data-source"
    );
    await user.click(within(entry).getByText("How do I connect my first data source?"));
    await user.click(within(entry).getByText("Connector Definition"));
    expect(onSelectTerm).toHaveBeenCalledWith("Connector Definition");
  });

  it("renders empty-state message when entries array is empty", () => {
    render(<FAQList entries={[]} />);
    expect(screen.getByTestId("faq-empty")).toBeInTheDocument();
    expect(
      screen.getByText("No FAQ entries match your search.")
    ).toBeInTheDocument();
  });
});
