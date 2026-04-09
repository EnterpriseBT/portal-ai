import { jest } from "@jest/globals";
import { render, screen } from "./test-utils";
import userEvent from "@testing-library/user-event";
import {
  AdvancedFilterBuilderUI,
} from "../components/AdvancedFilterBuilder.component";

import type { AdvancedFilterBuilderProps } from "../components/AdvancedFilterBuilder.component";
import type { FilterExpression, ResolvedColumn } from "@portalai/core/contracts";

// ── Test data ───────────────────────────────────────────────────────

const columnDefs: ResolvedColumn[] = [
  { key: "name", normalizedKey: "name", label: "Name", type: "string", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "age", normalizedKey: "age", label: "Age", type: "number", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "active", normalizedKey: "active", label: "Active", type: "boolean", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "created_at", normalizedKey: "created_at", label: "Created At", type: "date", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "status", normalizedKey: "status", label: "Status", type: "enum", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
];

const emptyExpression: FilterExpression = {
  combinator: "and",
  conditions: [],
};

const singleConditionExpr: FilterExpression = {
  combinator: "and",
  conditions: [{ field: "name", operator: "eq", value: "Alice" }],
};

const multiConditionExpr: FilterExpression = {
  combinator: "and",
  conditions: [
    { field: "name", operator: "eq", value: "Alice" },
    { field: "age", operator: "gt", value: 18 },
  ],
};

const nestedExpr: FilterExpression = {
  combinator: "and",
  conditions: [
    { field: "name", operator: "eq", value: "Alice" },
    {
      combinator: "or",
      conditions: [
        { field: "status", operator: "eq", value: "active" },
        { field: "status", operator: "eq", value: "trial" },
      ],
    },
  ],
};

function makeProps(
  overrides: Partial<AdvancedFilterBuilderProps> = {},
): AdvancedFilterBuilderProps {
  return {
    expression: emptyExpression,
    onChange: jest.fn(),
    columnDefinitions: columnDefs,
    ...overrides,
  };
}

// ── Rendering ───────────────────────────────────────────────────────

describe("AdvancedFilterBuilderUI", () => {
  describe("empty state", () => {
    it("should render the AND/OR toggle", () => {
      render(<AdvancedFilterBuilderUI {...makeProps()} />);
      expect(screen.getByText("AND")).toBeInTheDocument();
      expect(screen.getByText("OR")).toBeInTheDocument();
    });

    it("should render add condition and add group buttons", () => {
      render(<AdvancedFilterBuilderUI {...makeProps()} />);
      expect(screen.getByText("Condition")).toBeInTheDocument();
      expect(screen.getByText("Group")).toBeInTheDocument();
    });

    it("should show message when no column definitions", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({ columnDefinitions: [] })}
        />,
      );
      expect(screen.getByText(/no columns available/i)).toBeInTheDocument();
    });
  });

  describe("with conditions", () => {
    it("should render condition rows for each condition", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({ expression: multiConditionExpr })}
        />,
      );
      // Each condition has a column select — check "Name" and "Age" are present as select values
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Age")).toBeInTheDocument();
    });

    it("should render operator selects with type-appropriate operators", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({
            expression: {
              combinator: "and",
              conditions: [{ field: "active", operator: "eq", value: true }],
            },
          })}
        />,
      );
      // Boolean only has "is" and "is not"
      expect(screen.getByText("is")).toBeInTheDocument();
    });

    it("should render nested groups", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({ expression: nestedExpr })}
        />,
      );
      // Should have multiple AND/OR toggles (root + nested)
      const andButtons = screen.getAllByText("AND");
      expect(andButtons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("add condition", () => {
    it("should call onChange with a new condition when add condition is clicked", async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({ onChange })}
        />,
      );

      await user.click(screen.getByText("Condition"));

      expect(onChange).toHaveBeenCalledTimes(1);
      const newExpr = onChange.mock.calls[0][0] as FilterExpression;
      expect(newExpr.conditions).toHaveLength(1);
      expect(newExpr.conditions[0]).toHaveProperty("field", "name");
      expect(newExpr.conditions[0]).toHaveProperty("operator", "eq");
    });
  });

  describe("add group", () => {
    it("should call onChange with a new nested group when add group is clicked", async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({ onChange })}
        />,
      );

      await user.click(screen.getByText("Group"));

      expect(onChange).toHaveBeenCalledTimes(1);
      const newExpr = onChange.mock.calls[0][0] as FilterExpression;
      expect(newExpr.conditions).toHaveLength(1);
      const nestedGroup = newExpr.conditions[0];
      expect(nestedGroup).toHaveProperty("combinator", "and");
    });
  });

  describe("remove condition", () => {
    it("should call onChange without the removed condition", async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({ expression: singleConditionExpr, onChange })}
        />,
      );

      // The delete button for the condition row
      const deleteButtons = screen.getAllByRole("button").filter(
        (btn) => btn.querySelector('[data-testid="DeleteOutlineIcon"]'),
      );
      expect(deleteButtons.length).toBeGreaterThanOrEqual(1);

      await user.click(deleteButtons[0]);

      expect(onChange).toHaveBeenCalledTimes(1);
      const newExpr = onChange.mock.calls[0][0] as FilterExpression;
      expect(newExpr.conditions).toHaveLength(0);
    });
  });

  describe("combinator toggle", () => {
    it("should switch from AND to OR when OR is clicked", async () => {
      const user = userEvent.setup();
      const onChange = jest.fn();
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({
            expression: singleConditionExpr,
            onChange,
          })}
        />,
      );

      await user.click(screen.getAllByText("OR")[0]);

      expect(onChange).toHaveBeenCalledTimes(1);
      const newExpr = onChange.mock.calls[0][0] as FilterExpression;
      expect(newExpr.combinator).toBe("or");
    });
  });

  describe("max depth enforcement", () => {
    it("should disable add group button when max depth reached", () => {
      // Build expression at depth 4 (MAX_FILTER_DEPTH)
      const deepExpr: FilterExpression = {
        combinator: "and",
        conditions: [
          {
            combinator: "or",
            conditions: [
              {
                combinator: "and",
                conditions: [
                  {
                    combinator: "or",
                    conditions: [
                      { field: "name", operator: "eq", value: "x" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      render(
        <AdvancedFilterBuilderUI
          {...makeProps({ expression: deepExpr })}
        />,
      );

      // The innermost "Group" button should be disabled
      const groupButtons = screen.getAllByText("Group");
      const lastGroupButton = groupButtons[groupButtons.length - 1];
      expect(lastGroupButton.closest("button")).toBeDisabled();
    });
  });

  describe("max conditions enforcement", () => {
    it("should disable add condition button when max conditions reached", () => {
      const conditions = Array.from({ length: 20 }, (_, i) => ({
        field: "name",
        operator: "eq" as const,
        value: `v${i}`,
      }));
      const maxExpr: FilterExpression = {
        combinator: "and",
        conditions,
      };

      render(
        <AdvancedFilterBuilderUI
          {...makeProps({ expression: maxExpr })}
        />,
      );

      const conditionButtons = screen.getAllByText("Condition");
      conditionButtons.forEach((btn) => {
        expect(btn.closest("button")).toBeDisabled();
      });
    });
  });

  describe("value inputs by type", () => {
    it("should render a text input for string columns", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({ expression: singleConditionExpr })}
        />,
      );
      // There should be a text input with the value "Alice"
      const input = screen.getByDisplayValue("Alice");
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute("type", "text");
    });

    it("should render a number input for number columns", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({
            expression: {
              combinator: "and",
              conditions: [{ field: "age", operator: "gt", value: 25 }],
            },
          })}
        />,
      );
      const input = screen.getByDisplayValue("25");
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute("type", "number");
    });

    it("should render a switch for boolean columns", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({
            expression: {
              combinator: "and",
              conditions: [{ field: "active", operator: "eq", value: true }],
            },
          })}
        />,
      );
      expect(screen.getByText("True")).toBeInTheDocument();
    });

    it("should render a date input for date columns", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({
            expression: {
              combinator: "and",
              conditions: [{ field: "created_at", operator: "eq", value: "2024-01-15" }],
            },
          })}
        />,
      );
      const input = screen.getByDisplayValue("2024-01-15");
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute("type", "date");
    });

    it("should not render value input for is_empty operator", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({
            expression: {
              combinator: "and",
              conditions: [{ field: "name", operator: "is_empty", value: null }],
            },
          })}
        />,
      );
      // No text input should be rendered for the value
      expect(screen.queryByPlaceholderText("Value")).not.toBeInTheDocument();
    });

    it("should render two number inputs for between operator on number", () => {
      render(
        <AdvancedFilterBuilderUI
          {...makeProps({
            expression: {
              combinator: "and",
              conditions: [{ field: "age", operator: "between", value: ["10", "50"] }],
            },
          })}
        />,
      );
      expect(screen.getByPlaceholderText("Min")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Max")).toBeInTheDocument();
    });
  });
});
