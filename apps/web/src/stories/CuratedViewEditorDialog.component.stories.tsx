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
