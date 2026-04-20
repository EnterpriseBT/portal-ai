import { render, screen } from "../../../__tests__/test-utils";

import { SampleFiles } from "../SampleFiles.component";

describe("SampleFiles", () => {
  it("renders a prompt explaining what the links are", () => {
    render(<SampleFiles />);
    expect(screen.getByText(/recommended layout/i)).toBeInTheDocument();
  });

  it("renders a CSV sample link pointing at /samples/sample-contacts.csv", () => {
    render(<SampleFiles />);
    const csvLink = screen.getByRole("link", { name: "sample-contacts.csv" });
    expect(csvLink).toHaveAttribute("href", "/samples/sample-contacts.csv");
    expect(csvLink).toHaveAttribute("download", "sample-contacts.csv");
  });

  it("renders an XLSX sample link pointing at /samples/sample-data.xlsx", () => {
    render(<SampleFiles />);
    const xlsxLink = screen.getByRole("link", { name: "sample-data.xlsx" });
    expect(xlsxLink).toHaveAttribute("href", "/samples/sample-data.xlsx");
    expect(xlsxLink).toHaveAttribute("download", "sample-data.xlsx");
  });

  it("describes the XLSX sample as multi-sheet", () => {
    render(<SampleFiles />);
    expect(screen.getByText(/Multi-sheet/i)).toBeInTheDocument();
  });
});
