import { jest } from "@jest/globals";

const { render, screen, fireEvent, expectNoAxeViolations } =
  await import("./test-utils");
const { OrphanedRegionsNoticeUI } =
  await import("../components/OrphanedRegionsNotice.component");

// #1009: regions whose sheet is gone, listed with a way to resolve each.
describe("OrphanedRegionsNoticeUI", () => {
  const orphans = [
    {
      region: { id: "r1" } as never,
      sheetName: "Q3",
      boundsA1: "B2:F40",
      targetEntityLabel: "Contacts",
    },
    {
      region: { id: "r2" } as never,
      sheetName: "Q4",
      boundsA1: "A1:C9",
      targetEntityLabel: null,
    },
  ];
  const sheets = [
    { id: "s1", name: "Q1" },
    { id: "s2", name: "Q2" },
  ];
  const props = {
    orphans,
    sheets,
    attempted: false,
    onMove: jest.fn(),
    onDelete: jest.fn(),
  };

  it("names each region and the sheet it was on", () => {
    render(<OrphanedRegionsNoticeUI {...props} />);
    expect(
      screen.getByText(
        'B2:F40 (Contacts) was on sheet "Q3", which is no longer in the workbook.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'A1:C9 was on sheet "Q4", which is no longer in the workbook.'
      )
    ).toBeInTheDocument();
  });

  it("moves a region to the chosen sheet", () => {
    const onMove = jest.fn();
    render(<OrphanedRegionsNoticeUI {...props} onMove={onMove} />);
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Move B2:F40 to sheet" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Q2" }));
    expect(onMove).toHaveBeenCalledWith("r1", "s2");
  });

  it("deletes a region", () => {
    const onDelete = jest.fn();
    render(<OrphanedRegionsNoticeUI {...props} onDelete={onDelete} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete region A1:C9" })
    );
    expect(onDelete).toHaveBeenCalledWith("r2");
  });

  it("asks to resolve them first after an attempted Interpret, and takes focus", () => {
    const { rerender } = render(<OrphanedRegionsNoticeUI {...props} />);
    expect(screen.queryByText(/Resolve these before interpreting/)).toBeNull();
    rerender(<OrphanedRegionsNoticeUI {...props} attempted />);
    expect(
      screen.getByText(/Resolve these before interpreting/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Regions whose sheet is missing" })
    ).toHaveFocus();
  });

  it("has no axe violations after an attempted Interpret", async () => {
    const { container } = render(
      <OrphanedRegionsNoticeUI {...props} attempted />
    );
    await expectNoAxeViolations(container);
  });
});
