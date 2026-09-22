import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "./test-utils";
import { AccessAuthoringUI } from "../modules/AccessAuthoring/AccessAuthoring.component";

const baseProps = {
  section: "policies" as const,
  onSectionChange: jest.fn(),
  isLoading: false,
  onNew: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
};

const rows = [
  { id: "sys-1", name: "FullAccess", system: true, detail: "1 statement(s)" },
  { id: "cus-1", name: "Analysts", system: false, detail: "2 statement(s)" },
];

describe("AccessAuthoringUI (#622)", () => {
  it("lists items and offers New", () => {
    render(<AccessAuthoringUI {...baseProps} rows={rows} />);
    expect(screen.getByText("FullAccess")).toBeInTheDocument();
    expect(screen.getByText("Analysts")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /New polic/i }));
    expect(baseProps.onNew).toHaveBeenCalled();
  });

  it("a system item is read-only — edit present, delete absent", () => {
    render(<AccessAuthoringUI {...baseProps} rows={rows} />);
    // System row: edit yes, delete no.
    expect(screen.getByLabelText("edit FullAccess")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("delete FullAccess")
    ).not.toBeInTheDocument();
    // Custom row: both.
    expect(screen.getByLabelText("edit Analysts")).toBeInTheDocument();
    expect(screen.getByLabelText("delete Analysts")).toBeInTheDocument();
  });

  it("delete + edit fire with the row id", () => {
    render(<AccessAuthoringUI {...baseProps} rows={rows} />);
    fireEvent.click(screen.getByLabelText("delete Analysts"));
    expect(baseProps.onDelete).toHaveBeenCalledWith("cus-1");
    fireEvent.click(screen.getByLabelText("edit Analysts"));
    expect(baseProps.onEdit).toHaveBeenCalledWith("cus-1");
  });

  it("shows an empty state when there are no rows", () => {
    render(<AccessAuthoringUI {...baseProps} rows={[]} />);
    expect(screen.getByText(/No policies yet/i)).toBeInTheDocument();
  });
});
