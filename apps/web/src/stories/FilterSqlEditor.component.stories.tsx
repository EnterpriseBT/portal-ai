import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { ResolvedColumn } from "@portalai/core/contracts";

/** A column as the preview returns it. */
const column = (key: string, type: ResolvedColumn["type"]): ResolvedColumn => ({
  key,
  label: key,
  type,
  normalizedKey: key,
  required: false,
  enumValues: null,
  defaultValue: null,
  format: null,
  validationPattern: null,
  canonicalFormat: null,
});

import {
  FilterSqlEditorUI,
  type FilterSqlEditorUIProps,
} from "../components/FilterSqlEditor.component";

const meta = {
  title: "Components/FilterSqlEditor",
  component: FilterSqlEditorUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    value: "payload->>'status' = 'active' AND amount > cost",
    onChange: fn(),
    onBlur: fn(),
    touched: false,
    columnKeys: ["name", "amount", "cost", "payload", "location"],
    readOnly: false,
    suggest: {
      prompt: "",
      onPromptChange: fn(),
      onSuggest: fn(),
      pending: false,
      serverError: null,
      warning: null,
    },
    preview: { onRun: fn(), pending: false, serverError: null, result: null },
  },
} satisfies Meta<typeof FilterSqlEditorUI>;

export default meta;
type Story = StoryObj<FilterSqlEditorUIProps>;

export const Default: Story = { args: {} };
export const Empty: Story = { args: { value: "" } };
export const Invalid: Story = {
  args: { value: "", touched: true, error: "Filter is required" },
};
export const Suggesting: Story = {
  args: {
    suggest: {
      prompt: "Active parcels within a mile of the office",
      onPromptChange: fn(),
      onSuggest: fn(),
      pending: true,
      serverError: null,
      warning: null,
    },
  },
};
export const RevisedSuggestion: Story = {
  args: {
    suggest: {
      prompt: "Loss makers",
      onPromptChange: fn(),
      onSuggest: fn(),
      pending: false,
      serverError: null,
      warning:
        "The first suggestion was refused (unknown column: margin); this is a corrected one.",
    },
  },
};
export const WithPreview: Story = {
  args: {
    preview: {
      onRun: fn(),
      pending: false,
      serverError: null,
      result: {
        columns: [column("name", "string"), column("amount", "number")],
        records: [
          { _record_id: "r1", name: "Parcel 12", amount: 120 },
          { _record_id: "r2", name: "Parcel 40", amount: 95 },
        ],
        hasMore: true,
      },
    },
  },
};
export const ReadOnlyAfterDowngrade: Story = { args: { readOnly: true } };
