import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import { Box } from "@portalai/core/ui";
import React from "react";

import { AdvancedFilterBuilderUI } from "../components/AdvancedFilterBuilder.component";

import type { FilterExpression, ResolvedColumn } from "@portalai/core/contracts";

// ── Sample data ─────────────────────────────────────────────────────

const sampleColumns: ResolvedColumn[] = [
  { key: "name", normalizedKey: "name", label: "Name", type: "string", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "email", normalizedKey: "email", label: "Email", type: "string", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "age", normalizedKey: "age", label: "Age", type: "number", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "active", normalizedKey: "active", label: "Active", type: "boolean", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "signup_date", normalizedKey: "signup_date", label: "Signup Date", type: "date", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "last_login", normalizedKey: "last_login", label: "Last Login", type: "datetime", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "status", normalizedKey: "status", label: "Status", type: "enum", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "tags", normalizedKey: "tags", label: "Tags", type: "array", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "metadata", normalizedKey: "metadata", label: "Metadata", type: "json", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
  { key: "manager_id", normalizedKey: "manager_id", label: "Manager", type: "reference", required: false, enumValues: null, defaultValue: null, validationPattern: null, canonicalFormat: null, format: null },
];

const emptyExpression: FilterExpression = {
  combinator: "and",
  conditions: [],
};

const populatedExpression: FilterExpression = {
  combinator: "and",
  conditions: [
    { field: "name", operator: "contains", value: "Alice" },
    { field: "age", operator: "gte", value: 18 },
    { field: "active", operator: "eq", value: true },
    {
      combinator: "or",
      conditions: [
        { field: "status", operator: "eq", value: "active" },
        { field: "status", operator: "eq", value: "trial" },
      ],
    },
  ],
};

const maxDepthExpression: FilterExpression = {
  combinator: "and",
  conditions: [
    { field: "name", operator: "eq", value: "test" },
    {
      combinator: "or",
      conditions: [
        { field: "age", operator: "gt", value: 21 },
        {
          combinator: "and",
          conditions: [
            { field: "active", operator: "eq", value: true },
            {
              combinator: "or",
              conditions: [
                { field: "status", operator: "eq", value: "active" },
                { field: "signup_date", operator: "gte", value: "2024-01-01" },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const betweenExpression: FilterExpression = {
  combinator: "and",
  conditions: [
    { field: "age", operator: "between", value: ["18", "65"] },
    { field: "signup_date", operator: "between", value: ["2023-01-01", "2024-12-31"] },
  ],
};

const emptyCheckExpression: FilterExpression = {
  combinator: "or",
  conditions: [
    { field: "email", operator: "is_empty", value: null },
    { field: "metadata", operator: "is_not_empty", value: null },
    { field: "tags", operator: "contains", value: "important" },
  ],
};

// ── Meta ────────────────────────────────────────────────────────────

const meta = {
  title: "Components/AdvancedFilterBuilder",
  component: AdvancedFilterBuilderUI,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <Box sx={{ p: 2, maxWidth: 800 }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    onChange: fn(),
    columnDefinitions: sampleColumns,
  },
} satisfies Meta<typeof AdvancedFilterBuilderUI>;

export default meta;
type Story = StoryObj<typeof meta>;

// ── Stories ─────────────────────────────────────────────────────────

/** Empty state — no conditions, ready for the user to add filters. */
export const Empty: Story = {
  args: {
    expression: emptyExpression,
  },
};

/** Populated with multiple conditions including a nested OR group. */
export const Populated: Story = {
  args: {
    expression: populatedExpression,
  },
};

/** Maximum nesting depth reached (4 levels) — "Add Group" buttons at the deepest level are disabled. */
export const MaxDepthReached: Story = {
  args: {
    expression: maxDepthExpression,
  },
};

/** Between operators showing dual-input fields for numbers and dates. */
export const BetweenOperators: Story = {
  args: {
    expression: betweenExpression,
  },
};

/** Empty/not-empty and array operators. */
export const EmptyAndArrayOperators: Story = {
  args: {
    expression: emptyCheckExpression,
  },
};

/** No columns available — shows the empty message. */
export const NoColumns: Story = {
  args: {
    expression: emptyExpression,
    columnDefinitions: [],
  },
};

/** Interactive story with live state. */
const InteractiveContent: React.FC = () => {
  const [expression, setExpression] = React.useState<FilterExpression>(emptyExpression);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <AdvancedFilterBuilderUI
        expression={expression}
        onChange={setExpression}
        columnDefinitions={sampleColumns}
      />
      <Box
        component="pre"
        sx={{
          p: 2,
          bgcolor: "grey.100",
          borderRadius: 1,
          fontSize: 12,
          overflow: "auto",
        }}
      >
        {JSON.stringify(expression, null, 2)}
      </Box>
    </Box>
  );
};

export const Interactive: Story = {
  args: {
    expression: emptyExpression,
  },
  render: () => <InteractiveContent />,
};
