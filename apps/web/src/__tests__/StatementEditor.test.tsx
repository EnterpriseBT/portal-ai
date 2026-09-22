import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "./test-utils";
import {
  StatementEditorUI,
  rowsToStatements,
  statementsToRows,
  type StatementRow,
} from "../modules/AccessAuthoring/StatementEditor.component";
import type { PolicyStatementInput } from "@portalai/core/contracts";

const noSearch = async () => [];

describe("rowsToStatements (#622 fan-out)", () => {
  it("an instance row with N object ids flattens to N statements", () => {
    const rows: StatementRow[] = [
      {
        effect: "allow",
        verb: "read",
        resourceType: "station",
        scope: "instance",
        condition: "",
        objectIds: ["st-1", "st-2", "st-3"],
      },
    ];
    const statements = rowsToStatements(rows);
    expect(statements).toHaveLength(3);
    expect(statements.map((s) => s.resourceId)).toEqual([
      "st-1",
      "st-2",
      "st-3",
    ]);
    expect(statements.every((s) => s.condition === null)).toBe(true);
  });

  it("a class row emits one statement carrying its ownership condition", () => {
    const rows: StatementRow[] = [
      {
        effect: "allow",
        verb: "read",
        resourceType: "station",
        scope: "class",
        condition: "created_by_caller",
        objectIds: [],
      },
    ];
    expect(rowsToStatements(rows)).toEqual([
      {
        effect: "allow",
        verb: "read",
        resourceType: "station",
        resourceId: null,
        condition: "created_by_caller",
      },
    ]);
  });

  it("statementsToRows round-trips class + instance statements", () => {
    const statements: PolicyStatementInput[] = [
      {
        effect: "allow",
        verb: "read",
        resourceType: "view",
        resourceId: "view-1",
        condition: null,
      },
      {
        effect: "deny",
        verb: "write",
        resourceType: "station",
        resourceId: null,
        condition: "created_by_caller",
      },
    ];
    const rows = statementsToRows(statements);
    expect(rows[0].scope).toBe("instance");
    expect(rows[0].objectIds).toEqual(["view-1"]);
    expect(rows[1].scope).toBe("class");
    expect(rows[1].condition).toBe("created_by_caller");
  });
});

describe("StatementEditorUI (#622)", () => {
  it("emits the default row at mount so a no-edit save is non-empty", () => {
    // Regression: the parent's statements state must reflect the visible default
    // row without any user edit — otherwise Save sends [] and the server rejects
    // it (400 ORGANIZATION_INVALID_PAYLOAD) despite a row being shown.
    const onChange = jest.fn();
    render(<StatementEditorUI onChange={onChange} onSearch={noSearch} />);
    expect(onChange).toHaveBeenCalled();
    const first = onChange.mock.calls[0][0] as PolicyStatementInput[];
    expect(first).toEqual([
      {
        effect: "allow",
        verb: "read",
        resourceType: "station",
        resourceId: null,
        condition: null,
      },
    ]);
  });

  it("emits the seeded statements at mount when editing", () => {
    const onChange = jest.fn();
    const initial: PolicyStatementInput[] = [
      {
        effect: "allow",
        verb: "read",
        resourceType: "view",
        resourceId: "view-1",
        condition: null,
      },
    ];
    render(
      <StatementEditorUI
        onChange={onChange}
        onSearch={noSearch}
        initialStatements={initial}
      />
    );
    expect(onChange.mock.calls[0][0]).toEqual(initial);
  });

  it("renders a default class row and emits on adding a statement", () => {
    const onChange = jest.fn();
    render(<StatementEditorUI onChange={onChange} onSearch={noSearch} />);
    expect(screen.getByTestId("statement-row-0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add statement/i }));
    // Two rows → two statements emitted.
    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    const last = calls[calls.length - 1][0] as PolicyStatementInput[];
    expect(last).toHaveLength(2);
  });

  it("disables every control and hides Add when readOnly", () => {
    render(
      <StatementEditorUI
        onChange={jest.fn()}
        onSearch={noSearch}
        readOnly
        initialStatements={[
          {
            effect: "allow",
            verb: "*",
            resourceType: "*",
            resourceId: null,
            condition: null,
          },
        ]}
      />
    );
    // The Add affordance is gone in read-only.
    expect(
      screen.queryByRole("button", { name: /Add statement/i })
    ).not.toBeInTheDocument();
    // The statement selects are disabled (a system policy can't be edited here).
    const effect = screen.getByRole("combobox", { name: /Effect/i });
    expect(effect).toHaveAttribute("aria-disabled", "true");
  });

  it("seeds rows from initialStatements", () => {
    render(
      <StatementEditorUI
        onChange={jest.fn()}
        onSearch={noSearch}
        initialStatements={[
          {
            effect: "allow",
            verb: "read",
            resourceType: "station",
            resourceId: null,
            condition: null,
          },
          {
            effect: "allow",
            verb: "write",
            resourceType: "pin",
            resourceId: null,
            condition: null,
          },
        ]}
      />
    );
    expect(screen.getByTestId("statement-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("statement-row-1")).toBeInTheDocument();
  });
});
