import type { Meta, StoryObj } from "@storybook/react";
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
  FilterSqlPreviewUI,
  type FilterSqlPreviewUIProps,
} from "../components/FilterSqlPreview.component";

const columns = [column("name", "string"), column("payload", "json")];

const meta = {
  title: "Components/FilterSqlPreview",
  component: FilterSqlPreviewUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: { pending: false, serverError: null, result: null },
} satisfies Meta<typeof FilterSqlPreviewUI>;

export default meta;
type Story = StoryObj<FilterSqlPreviewUIProps>;

export const Loading: Story = { args: { pending: true } };
export const Refused: Story = {
  args: {
    serverError: {
      message: "argument of WHERE must be type boolean, not type integer",
      code: "CURATED_VIEW_INVALID_FILTER_SQL",
    },
  },
};
export const NoMatches: Story = {
  args: { result: { columns, records: [], hasMore: false } },
};
export const Rows: Story = {
  args: {
    result: {
      columns,
      records: [
        { _record_id: "r1", name: "Parcel 12", payload: { status: "active" } },
        { _record_id: "r2", name: "Parcel 40", payload: { status: "active" } },
      ],
      hasMore: true,
    },
  },
};
