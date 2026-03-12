import { render, screen } from "./test-utils";
import { EmptyResults } from "../components/EmptyResults.component";

describe("EmptyResults", () => {
  it("should match snapshot", () => {
    const { container } = render(<EmptyResults />);
    expect(container.firstChild).toMatchSnapshot();
  });

  it("should display the heading", () => {
    render(<EmptyResults />);
    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  it("should display the description", () => {
    render(<EmptyResults />);
    expect(
      screen.getByText(
        "Try adjusting your search or filter to find what you are looking for."
      )
    ).toBeInTheDocument();
  });
});
