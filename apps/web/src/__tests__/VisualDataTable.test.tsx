import { jest } from "@jest/globals";
import userEvent from "@testing-library/user-event";

import { render, screen, expectNoAxeViolations } from "./test-utils";
import { VisualDataTableUI } from "../components/VisualDataTable.component";

// #796: the data behind a chart or map, as a table.

const columns = ["month", "revenue"];
const rows = [
  { month: "Jan", revenue: 10 },
  { month: "Feb", revenue: 20 },
];

const paging = {
  total: 100_000,
  page: 0,
  rowsPerPage: 10,
  onPageChange: jest.fn(),
  onRowsPerPageChange: jest.fn(),
};

describe("VisualDataTableUI", () => {
  it("renders inline rows as a named table with client search", () => {
    render(
      <VisualDataTableUI
        label="Data for Revenue"
        columns={columns}
        rows={rows}
      />
    );
    expect(
      screen.getByRole("table", { name: "Data for Revenue" })
    ).toBeInTheDocument();
    expect(screen.getByText("Feb")).toBeInTheDocument();
    expect(screen.getByTestId("table-search")).toBeInTheDocument();
  });

  it("pages a large result through the parent", () => {
    render(
      <VisualDataTableUI
        label="Data"
        columns={columns}
        rows={rows}
        paging={paging}
      />
    );
    expect(screen.getByText("1–10 of 100,000")).toBeInTheDocument();
    expect(screen.queryByTestId("table-search")).not.toBeInTheDocument();
  });

  it("states the cap when the result was cut short", () => {
    render(
      <VisualDataTableUI
        label="Data"
        columns={columns}
        rows={rows}
        paging={paging}
        capNote="Showing the first 100,000 of 1,234,567 rows."
      />
    );
    expect(
      screen.getByText("Showing the first 100,000 of 1,234,567 rows.")
    ).toBeInTheDocument();
  });

  it("explains an expired handle and offers Refresh", async () => {
    const user = userEvent.setup();
    const onRefresh = jest.fn();
    render(
      <VisualDataTableUI
        label="Data"
        columns={[]}
        rows={[]}
        expired
        onRefresh={onRefresh}
      />
    );
    expect(
      screen.getByText("This data has expired. Refresh to load it again.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("shows any other error as an alert", () => {
    render(
      <VisualDataTableUI
        label="Data"
        columns={[]}
        rows={[]}
        error={{ message: "Station not found", code: "STATION_NOT_FOUND" }}
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Station not found");
  });

  it("has no axe violations, paged and expired", async () => {
    const { container, rerender } = render(
      <VisualDataTableUI
        label="Data"
        columns={columns}
        rows={rows}
        paging={paging}
        capNote="Showing the first 100,000 of more than 100,000 rows."
      />
    );
    await expectNoAxeViolations(container);
    rerender(
      <VisualDataTableUI
        label="Data"
        columns={[]}
        rows={[]}
        expired
        onRefresh={() => {}}
      />
    );
    await expectNoAxeViolations(container);
  });
});
