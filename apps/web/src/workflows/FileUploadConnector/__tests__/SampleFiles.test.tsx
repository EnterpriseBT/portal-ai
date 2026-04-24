import { render, screen } from "../../../__tests__/test-utils";

import { SampleFiles } from "../SampleFiles.component";

describe("SampleFiles", () => {
  it("renders a prompt explaining what the links are", () => {
    render(<SampleFiles />);
    expect(screen.getByText(/recommended layout/i)).toBeInTheDocument();
  });

  it("renders the supported-layouts CSV link", () => {
    render(<SampleFiles />);
    const link = screen.getByRole("link", {
      name: "supported_layouts.csv",
    });
    expect(link).toHaveAttribute("href", "/samples/supported_layouts.csv");
    expect(link).toHaveAttribute("download", "supported_layouts.csv");
  });

  it("renders the supported-layouts XLSX link", () => {
    render(<SampleFiles />);
    const link = screen.getByRole("link", {
      name: "supported_layouts.xlsx",
    });
    expect(link).toHaveAttribute("href", "/samples/supported_layouts.xlsx");
    expect(link).toHaveAttribute("download", "supported_layouts.xlsx");
  });
});
