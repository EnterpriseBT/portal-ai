import { jest } from "@jest/globals";
import { within } from "@testing-library/react";
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
        resourceType: "curated_view",
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
        resourceType: "curated_view",
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

  // ── view⟺page coupling (#630) ─────────────────────────────────────────────
  //
  // A `page` is gated only by the `view` verb and `view` only makes sense on a
  // page; the editor must make `view page` reachable and prevent the inert
  // `read page` / `view station` combinations that silently grant nothing.

  const lastStatement = (onChange: jest.Mock): PolicyStatementInput =>
    (
      onChange.mock.calls[
        onChange.mock.calls.length - 1
      ][0] as PolicyStatementInput[]
    )[0];

  it("coerces the verb to `view` when the resource is set to `page`", () => {
    const onChange = jest.fn();
    render(<StatementEditorUI onChange={onChange} onSearch={noSearch} />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /Resource/i }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("page"));
    expect(lastStatement(onChange)).toMatchObject({
      verb: "view",
      resourceType: "page",
    });
  });

  it("offers only a resource's valid verbs — a data row excludes view/manage/invite", () => {
    render(<StatementEditorUI onChange={jest.fn()} onSearch={noSearch} />); // read station
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /Verb/i }));
    const listbox = within(screen.getByRole("listbox"));
    expect(listbox.getByText("read")).toBeInTheDocument();
    expect(listbox.getByText("write")).toBeInTheDocument();
    expect(listbox.getByText("delete")).toBeInTheDocument();
    expect(listbox.getByText("share")).toBeInTheDocument(); // station is shareable
    expect(listbox.queryByText("view")).not.toBeInTheDocument();
    expect(listbox.queryByText("manage")).not.toBeInTheDocument();
    expect(listbox.queryByText("invite")).not.toBeInTheDocument();
  });

  it("coerces the verb to a privileged capability when the resource is a singleton", () => {
    const onChange = jest.fn();
    render(<StatementEditorUI onChange={onChange} onSearch={noSearch} />);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /Resource/i }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("billing"));
    expect(lastStatement(onChange)).toMatchObject({
      verb: "manage",
      resourceType: "billing",
    });
  });

  it("locks a page row's verb to `view` so `read page` can't be authored", () => {
    render(
      <StatementEditorUI
        onChange={jest.fn()}
        onSearch={noSearch}
        initialStatements={[
          {
            effect: "allow",
            verb: "view",
            resourceType: "page",
            resourceId: "connectors",
            condition: null,
          },
        ]}
      />
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /Verb/i }));
    const listbox = within(screen.getByRole("listbox"));
    expect(listbox.getByText("view")).toBeInTheDocument();
    expect(listbox.queryByText("read")).not.toBeInTheDocument();
    expect(listbox.queryByText("delete")).not.toBeInTheDocument();
  });

  it("coerces the verb off `view` when a page row's resource becomes a data type", () => {
    const onChange = jest.fn();
    render(
      <StatementEditorUI
        onChange={onChange}
        onSearch={noSearch}
        initialStatements={[
          {
            effect: "allow",
            verb: "view",
            resourceType: "page",
            resourceId: "connectors",
            condition: null,
          },
        ]}
      />
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: /Resource/i }));
    fireEvent.click(within(screen.getByRole("listbox")).getByText("station"));
    expect(lastStatement(onChange)).toMatchObject({
      verb: "read",
      resourceType: "station",
    });
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
