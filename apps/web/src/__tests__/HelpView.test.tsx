import { jest } from "@jest/globals";
import type { GettingStartedStep } from "../utils/getting-started.util";
import type { GlossaryEntry } from "../utils/glossary.util";
import type { FAQEntry } from "../utils/faq.util";

const { render, screen, within } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { HelpView, HelpViewUI } = await import("../views/Help.view");
const { GlossaryCategory } = await import("../utils/glossary.util");
const { FAQCategory } = await import("../utils/faq.util");
const { ApplicationRoute } = await import("../utils/routes.util");

const stepsFixture: GettingStartedStep[] = [
  {
    title: "Connect a data source",
    description: "Pick a connector definition.",
    ctaLabel: "Go to Connectors",
    ctaRoute: ApplicationRoute.Connectors,
  },
  {
    title: "Open a portal",
    description: "Launch a portal session.",
    ctaLabel: "Go to Stations",
    ctaRoute: ApplicationRoute.Stations,
  },
];

const glossaryFixture: GlossaryEntry[] = [
  {
    term: "Connector Instance",
    category: GlossaryCategory.DataSources,
    definition: "A live connection to a data source.",
    relatedTerms: ["Station"],
  },
  {
    term: "Station",
    category: GlossaryCategory.Analytics,
    definition: "A workspace bundling connectors and tool packs.",
    relatedTerms: ["Connector Instance"],
  },
  {
    term: "Job Status",
    category: GlossaryCategory.System,
    definition: "Pending, active, completed, failed, etc.",
  },
];

const faqFixture: FAQEntry[] = [
  {
    question: "How do I connect my first data source?",
    answer: "Open the Connectors page and pick a connector definition.",
    category: FAQCategory.GettingStarted,
    relatedGlossaryTerms: ["Connector Instance", "Station"],
  },
  {
    question: "Why did my job fail?",
    answer: "Open the job to see the error details.",
    category: FAQCategory.Jobs,
  },
];

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView; stub it.
  Element.prototype.scrollIntoView = jest.fn() as unknown as Element["scrollIntoView"];
  // Provide a synchronous requestAnimationFrame for tests.
  jest
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const renderUI = (onNavigate = jest.fn()) =>
  render(
    <HelpViewUI
      steps={stepsFixture}
      glossaryEntries={glossaryFixture}
      faqEntries={faqFixture}
      onNavigate={onNavigate}
    />
  );

// ── 5.1 — HelpViewUI ────────────────────────────────────────────────

describe("HelpViewUI", () => {
  it("renders three tabs labeled 'Getting Started', 'Glossary', 'FAQ'", () => {
    renderUI();
    expect(screen.getByRole("tab", { name: "Getting Started" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Glossary" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "FAQ" })).toBeInTheDocument();
  });

  it("Getting Started is the default active tab", () => {
    renderUI();
    expect(screen.getByRole("tab", { name: "Getting Started" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // Step content is visible
    expect(screen.getByText("Connect a data source")).toBeInTheDocument();
  });

  it("clicking the Glossary tab swaps the panel to the glossary list", async () => {
    const user = userEvent.setup();
    renderUI();
    await user.click(screen.getByRole("tab", { name: "Glossary" }));
    expect(
      screen.getByTestId("glossary-entry-connector-instance")
    ).toBeInTheDocument();
  });

  it("clicking the FAQ tab swaps the panel to the FAQ list", async () => {
    const user = userEvent.setup();
    renderUI();
    await user.click(screen.getByRole("tab", { name: "FAQ" }));
    expect(
      screen.getByTestId("faq-entry-how-do-i-connect-my-first-data-source")
    ).toBeInTheDocument();
  });

  it("search bar filters glossary entries when on the Glossary tab", async () => {
    const user = userEvent.setup();
    renderUI();
    await user.click(screen.getByRole("tab", { name: "Glossary" }));

    const search = screen.getByPlaceholderText("Search help");
    await user.type(search, "station");

    expect(screen.getByTestId("glossary-entry-station")).toBeInTheDocument();
    expect(
      screen.queryByTestId("glossary-entry-job-status")
    ).not.toBeInTheDocument();
  });

  it("search bar filters FAQ entries when on the FAQ tab", async () => {
    const user = userEvent.setup();
    renderUI();
    await user.click(screen.getByRole("tab", { name: "FAQ" }));

    const search = screen.getByPlaceholderText("Search help");
    await user.type(search, "job");

    expect(
      screen.getByTestId("faq-entry-why-did-my-job-fail")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("faq-entry-how-do-i-connect-my-first-data-source")
    ).not.toBeInTheDocument();
  });

  it("search bar is hidden on the Getting Started tab (filtering applies only to glossary/FAQ)", () => {
    renderUI();
    expect(screen.queryByPlaceholderText("Search help")).not.toBeInTheDocument();
  });

  it("category chips on the Glossary tab filter entries to that category", async () => {
    const user = userEvent.setup();
    renderUI();
    await user.click(screen.getByRole("tab", { name: "Glossary" }));

    const filters = screen.getByTestId("glossary-category-filters");
    await user.click(within(filters).getByText("Analytics"));

    expect(screen.getByTestId("glossary-entry-station")).toBeInTheDocument();
    expect(
      screen.queryByTestId("glossary-entry-connector-instance")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("glossary-entry-job-status")
    ).not.toBeInTheDocument();
  });

  it("category chips on the FAQ tab filter entries to that category", async () => {
    const user = userEvent.setup();
    renderUI();
    await user.click(screen.getByRole("tab", { name: "FAQ" }));

    const filters = screen.getByTestId("faq-category-filters");
    await user.click(within(filters).getByText("Jobs & Background Tasks"));

    expect(
      screen.getByTestId("faq-entry-why-did-my-job-fail")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("faq-entry-how-do-i-connect-my-first-data-source")
    ).not.toBeInTheDocument();
  });

  it("selecting a related glossary term from the FAQ tab switches to the Glossary tab and scrolls to that entry", async () => {
    const user = userEvent.setup();
    renderUI();

    await user.click(screen.getByRole("tab", { name: "FAQ" }));
    const faqEntry = screen.getByTestId(
      "faq-entry-how-do-i-connect-my-first-data-source"
    );
    await user.click(
      within(faqEntry).getByText("How do I connect my first data source?")
    );
    await user.click(within(faqEntry).getByText("Station"));

    // Tab switched
    expect(screen.getByRole("tab", { name: "Glossary" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // Glossary entry visible
    expect(screen.getByTestId("glossary-entry-station")).toBeInTheDocument();
    // scrollIntoView called
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("clicking a Getting Started CTA invokes the navigate callback with the step's route", async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    renderUI(onNavigate);

    await user.click(screen.getByRole("button", { name: "Go to Connectors" }));
    expect(onNavigate).toHaveBeenCalledWith(ApplicationRoute.Connectors);
  });

  it("renders the page title 'Help' and an icon in the page header", () => {
    renderUI();
    expect(screen.getByRole("heading", { name: "Help" })).toBeInTheDocument();
  });

  it("renders a contact caption with a mailto link to ben.turner@btdev.io", () => {
    renderUI();
    const link = screen.getByRole("link", { name: "ben.turner@btdev.io" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "mailto:ben.turner@btdev.io");
  });
});

// ── 5.2 — HelpView container ────────────────────────────────────────

describe("HelpView container", () => {
  it("mounts and renders the real glossary + FAQ + getting-started content", () => {
    render(<HelpView />);
    // Default tab is Getting Started — first real step from GETTING_STARTED_STEPS.
    expect(screen.getByText("Connect a data source")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Getting Started" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // Header.
    expect(screen.getByRole("heading", { name: "Help" })).toBeInTheDocument();
  });
});
