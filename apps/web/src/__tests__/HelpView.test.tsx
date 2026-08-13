import { jest } from "@jest/globals";
import React from "react";
import type { GettingStartedStep } from "../utils/getting-started.util";
import type { GlossaryEntry } from "@portalai/core/content";
import type { FAQEntry } from "@portalai/core/content";
import type {
  GlossaryCategory as GlossaryCategoryValue,
  FAQCategory as FAQCategoryValue,
} from "@portalai/core/content";
import type { HelpTab as HelpTabValue } from "../utils/routes.util";

const { render, screen, within } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { HelpView, HelpViewUI } = await import("../views/Help.view");
const { GlossaryCategory } = await import("@portalai/core/content");
const { FAQCategory } = await import("@portalai/core/content");
const { ApplicationRoute, HELP_TAB_INDEX, HelpTab } =
  await import("../utils/routes.util");

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
  Element.prototype.scrollIntoView =
    jest.fn() as unknown as Element["scrollIntoView"];
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

/**
 * `HelpViewUI` is controlled by the URL since #365 — it renders the tab and
 * category it is handed and reports changes back. This harness plays the part
 * the container plays in the app (hold the value, feed it back), so the
 * behavior tests below still describe what a user experiences end to end.
 * Tests that care about the *reporting* half render the UI directly with
 * fixed props and a spy.
 */
const ControlledHelpHarness: React.FC<{
  onNavigate?: (route: string) => void;
  initialTab?: HelpTabValue;
  initialCategory?: GlossaryCategoryValue | FAQCategoryValue | null;
}> = ({ onNavigate = jest.fn(), initialTab, initialCategory = null }) => {
  const [tab, setTab] = React.useState<HelpTabValue>(
    initialTab ?? HelpTab.GettingStarted
  );
  const [glossaryCategory, setGlossaryCategory] =
    React.useState<GlossaryCategoryValue | null>(
      initialTab === HelpTab.Glossary
        ? (initialCategory as GlossaryCategoryValue | null)
        : null
    );
  const [faqCategory, setFaqCategory] = React.useState<FAQCategoryValue | null>(
    initialTab === HelpTab.Faq
      ? (initialCategory as FAQCategoryValue | null)
      : null
  );

  return (
    <HelpViewUI
      steps={stepsFixture}
      glossaryEntries={glossaryFixture}
      faqEntries={faqFixture}
      onNavigate={onNavigate}
      tabIndex={HELP_TAB_INDEX[tab]}
      glossaryCategory={glossaryCategory}
      faqCategory={faqCategory}
      onTabChange={(nextTab) => {
        // Mirrors the container: a tab change drops the category param.
        setTab(nextTab);
        setGlossaryCategory(null);
        setFaqCategory(null);
      }}
      onCategoryChange={(nextTab, category) => {
        setTab(nextTab);
        if (nextTab === HelpTab.Glossary) {
          setGlossaryCategory(category as GlossaryCategoryValue | null);
        } else if (nextTab === HelpTab.Faq) {
          setFaqCategory(category as FAQCategoryValue | null);
        }
      }}
    />
  );
};

const renderUI = (onNavigate = jest.fn()) =>
  render(<ControlledHelpHarness onNavigate={onNavigate} />);

/** Renders the pure UI with fixed props — for asserting what it reports. */
const renderControlled = (
  props: Partial<React.ComponentProps<typeof HelpViewUI>> = {}
) =>
  render(
    <HelpViewUI
      steps={stepsFixture}
      glossaryEntries={glossaryFixture}
      faqEntries={faqFixture}
      onNavigate={jest.fn()}
      tabIndex={0}
      glossaryCategory={null}
      faqCategory={null}
      onTabChange={jest.fn()}
      onCategoryChange={jest.fn()}
      {...props}
    />
  );

// ── 5.1 — HelpViewUI ────────────────────────────────────────────────

describe("HelpViewUI", () => {
  it("renders three tabs labeled 'Getting Started', 'Glossary', 'FAQ'", () => {
    renderUI();
    expect(
      screen.getByRole("tab", { name: "Getting Started" })
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Glossary" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "FAQ" })).toBeInTheDocument();
  });

  it("Getting Started is the default active tab", () => {
    renderUI();
    expect(
      screen.getByRole("tab", { name: "Getting Started" })
    ).toHaveAttribute("aria-selected", "true");
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
    expect(
      screen.queryByPlaceholderText("Search help")
    ).not.toBeInTheDocument();
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

// ── 5.1b — HelpViewUI is driven by the URL (#365) ───────────────────

describe("HelpViewUI (controlled by props)", () => {
  it("renders the tab it is handed, with no Getting Started first paint", () => {
    renderControlled({ tabIndex: HELP_TAB_INDEX[HelpTab.Faq] });

    expect(screen.getByRole("tab", { name: "FAQ" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(
      screen.getByRole("tab", { name: "Getting Started" })
    ).toHaveAttribute("aria-selected", "false");
    // The FAQ panel's content is present on the very first render — a deep
    // link must not flash the default tab on its way to the right one.
    expect(
      screen.getByTestId("faq-entry-how-do-i-connect-my-first-data-source")
    ).toBeInTheDocument();
  });

  it("renders the FAQ category it is handed as the active chip, ungrouped", () => {
    renderControlled({
      tabIndex: HELP_TAB_INDEX[HelpTab.Faq],
      faqCategory: FAQCategory.Jobs,
    });

    const filters = screen.getByTestId("faq-category-filters");
    expect(
      within(filters)
        .getByText("Jobs & Background Tasks")
        .closest(".MuiChip-root")
    ).toHaveClass("MuiChip-colorPrimary");
    // A category filter flattens the grouped render.
    expect(
      screen.queryByTestId("faq-category-header-jobs")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("faq-entry-why-did-my-job-fail")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("faq-entry-how-do-i-connect-my-first-data-source")
    ).not.toBeInTheDocument();
  });

  it("renders the glossary category it is handed as the active chip", () => {
    renderControlled({
      tabIndex: HELP_TAB_INDEX[HelpTab.Glossary],
      glossaryCategory: GlossaryCategory.Analytics,
    });

    const filters = screen.getByTestId("glossary-category-filters");
    expect(
      within(filters).getByText("Analytics").closest(".MuiChip-root")
    ).toHaveClass("MuiChip-colorPrimary");
    expect(screen.getByTestId("glossary-entry-station")).toBeInTheDocument();
    expect(
      screen.queryByTestId("glossary-entry-connector-instance")
    ).not.toBeInTheDocument();
  });

  it("reports a tab click without moving the tab itself", async () => {
    const user = userEvent.setup();
    const onTabChange = jest.fn();
    renderControlled({ onTabChange });

    await user.click(screen.getByRole("tab", { name: "FAQ" }));

    expect(onTabChange).toHaveBeenCalledWith(HelpTab.Faq);
    // The URL owns the tab — the UI must not move on its own.
    expect(
      screen.getByRole("tab", { name: "Getting Started" })
    ).toHaveAttribute("aria-selected", "true");
  });

  it("reports a category chip click with its tab", async () => {
    const user = userEvent.setup();
    const onCategoryChange = jest.fn();
    renderControlled({
      tabIndex: HELP_TAB_INDEX[HelpTab.Glossary],
      onCategoryChange,
    });

    const filters = screen.getByTestId("glossary-category-filters");
    await user.click(within(filters).getByText("Analytics"));

    expect(onCategoryChange).toHaveBeenCalledWith(
      HelpTab.Glossary,
      GlossaryCategory.Analytics
    );
  });

  it("reports null when the active chip is clicked again", async () => {
    const user = userEvent.setup();
    const onCategoryChange = jest.fn();
    renderControlled({
      tabIndex: HELP_TAB_INDEX[HelpTab.Faq],
      faqCategory: FAQCategory.Jobs,
      onCategoryChange,
    });

    const filters = screen.getByTestId("faq-category-filters");
    await user.click(within(filters).getByText("Jobs & Background Tasks"));

    expect(onCategoryChange).toHaveBeenCalledWith(HelpTab.Faq, null);
  });

  it("reports null when the All chip is clicked", async () => {
    const user = userEvent.setup();
    const onCategoryChange = jest.fn();
    renderControlled({
      tabIndex: HELP_TAB_INDEX[HelpTab.Glossary],
      glossaryCategory: GlossaryCategory.Analytics,
      onCategoryChange,
    });

    const filters = screen.getByTestId("glossary-category-filters");
    await user.click(within(filters).getByText("All"));

    expect(onCategoryChange).toHaveBeenCalledWith(HelpTab.Glossary, null);
  });
});

// ── 5.2 — HelpView container ────────────────────────────────────────

describe("HelpView container", () => {
  it("mounts and renders the real glossary + FAQ + getting-started content", () => {
    render(<HelpView />);
    // Default tab is Getting Started — first real step from GETTING_STARTED_STEPS.
    expect(screen.getByText("Connect a data source")).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Getting Started" })
    ).toHaveAttribute("aria-selected", "true");
    // Header.
    expect(screen.getByRole("heading", { name: "Help" })).toBeInTheDocument();
  });
});
