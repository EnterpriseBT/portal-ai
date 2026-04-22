import { render, screen } from "../../../__tests__/test-utils";

import { SampleFiles } from "../SampleFiles.component";

describe("SampleFiles", () => {
  it("renders a prompt explaining what the links are", () => {
    render(<SampleFiles />);
    expect(screen.getByText(/recommended layout/i)).toBeInTheDocument();
  });

  it("renders the region-segmentation-matrix CSV link", () => {
    render(<SampleFiles />);
    const link = screen.getByRole("link", {
      name: "region-segmentation-matrix.csv",
    });
    expect(link).toHaveAttribute(
      "href",
      "/samples/region-segmentation-matrix.csv"
    );
    expect(link).toHaveAttribute("download", "region-segmentation-matrix.csv");
  });

  it("renders the region-segmentation-matrix XLSX link", () => {
    render(<SampleFiles />);
    const link = screen.getByRole("link", {
      name: "region-segmentation-matrix.xlsx",
    });
    expect(link).toHaveAttribute(
      "href",
      "/samples/region-segmentation-matrix.xlsx"
    );
    expect(link).toHaveAttribute("download", "region-segmentation-matrix.xlsx");
  });
});
