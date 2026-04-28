import { jest } from "@jest/globals";
import type { GlossaryEntry } from "../utils/glossary.util";

const { render, screen, within } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { GlossaryList } = await import("../components/GlossaryList.component");
const { GlossaryCategory } = await import("../utils/glossary.util");

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

describe("GlossaryList", () => {
  it("renders one accordion per provided entry", () => {
    render(<GlossaryList entries={fixture} />);
    expect(
      screen.getByTestId("glossary-entry-connector-instance")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("glossary-entry-field-mapping")
    ).toBeInTheDocument();
    expect(screen.getByTestId("glossary-entry-station")).toBeInTheDocument();
  });

  it("renders the category label as a chip on each entry", () => {
    render(<GlossaryList entries={fixture} />);
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
    render(<GlossaryList entries={fixture} />);

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
      <GlossaryList entries={[fixture[1]]} expandedTerm="Field Mapping" />
    );
    const entry = screen.getByTestId("glossary-entry-field-mapping");
    expect(within(entry).queryByText("Example")).not.toBeInTheDocument();
  });

  it("omits 'Related' section when entry has no relatedTerms", () => {
    render(
      <GlossaryList entries={[fixture[1]]} expandedTerm="Field Mapping" />
    );
    const entry = screen.getByTestId("glossary-entry-field-mapping");
    expect(within(entry).queryByText("Related")).not.toBeInTheDocument();
  });

  it("omits 'Found on' section when entry has no pageRoute", () => {
    render(
      <GlossaryList entries={[fixture[1]]} expandedTerm="Field Mapping" />
    );
    const entry = screen.getByTestId("glossary-entry-field-mapping");
    expect(within(entry).queryByText("Found on")).not.toBeInTheDocument();
  });

  it("clicking a related term invokes onSelectTerm with that term", async () => {
    const user = userEvent.setup();
    const onSelectTerm = jest.fn();
    render(
      <GlossaryList
        entries={fixture}
        expandedTerm="Connector Instance"
        onSelectTerm={onSelectTerm}
      />
    );

    const entry = screen.getByTestId("glossary-entry-connector-instance");
    await user.click(within(entry).getByText("Connector Definition"));
    expect(onSelectTerm).toHaveBeenCalledWith("Connector Definition");
  });

  it("renders empty-state message when entries array is empty", () => {
    render(<GlossaryList entries={[]} />);
    expect(screen.getByTestId("glossary-empty")).toBeInTheDocument();
    expect(
      screen.getByText("No glossary entries match your search.")
    ).toBeInTheDocument();
  });
});
