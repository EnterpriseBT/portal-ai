import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";

import {
  CuratedViewEditorUI,
  type CuratedViewEditorUIProps,
} from "../components/CuratedViewEditorDialog.component";

const meta = {
  title: "Components/CuratedViewEditor",
  component: CuratedViewEditorUI,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
  args: {
    mode: "create",
    onClose: fn(),
    showEntitySelect: false,
    entityOptions: [],
    selectedEntityId: "ent-1",
    onEntityChange: fn(),
    fieldMappingOptions: [
      { id: "fm-1", label: "name" },
      { id: "fm-2", label: "region" },
    ],
    columnDefinitions: [],
    label: "NE Accounts",
    onLabelChange: fn(),
    keyValue: "ne_accounts",
    onKeyChange: fn(),
    description: "",
    onDescriptionChange: fn(),
    selectedFieldMappingIds: [],
    onSelectedFieldMappingIdsChange: fn(),
    filter: { combinator: "and", conditions: [] },
    onFilterChange: fn(),
    filterMode: "builder",
    onFilterModeChange: fn(),
    sqlModeGate: { kind: "allow" },
    filterSqlEditor: {
      value: "amount > cost",
      onChange: fn(),
      onBlur: fn(),
      touched: false,
      columnKeys: ["name", "region", "amount", "cost"],
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
    errors: {},
    touched: {},
    onLabelBlur: fn(),
    onKeyBlur: fn(),
    onSubmit: fn(),
    isPending: false,
    serverError: null,
    columnsReady: true,
  },
} satisfies Meta<typeof CuratedViewEditorUI>;

export default meta;
type Story = StoryObj<CuratedViewEditorUIProps>;

export const Create: Story = { args: {} };
export const Edit: Story = { args: { mode: "edit" } };
export const Saving: Story = { args: { isPending: true } };
export const WithValidationError: Story = {
  args: {
    label: "",
    errors: { label: "Label is required" },
    touched: { label: true },
  },
};
/** #644: the advanced (SQL) row filter. */
export const SqlMode: Story = { args: { filterMode: "sql" } };
/** #644: a plan without SQL filters sees an upsell on the SQL mode. */
export const SqlModeUpsell: Story = {
  args: {
    sqlModeGate: {
      kind: "upsell",
      reason: "SQL filters are available on a higher plan.",
      onUpgrade: fn(),
    },
  },
};
