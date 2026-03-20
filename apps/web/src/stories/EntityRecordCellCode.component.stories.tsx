import type { Meta, StoryObj } from "@storybook/react";
import { EntityRecordCellCode } from "../components/EntityRecordCellCode.component";

const meta = {
  title: "Components/EntityRecordCellCode",
  component: EntityRecordCellCode,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof EntityRecordCellCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const JsonObject: Story = {
  args: {
    value: { id: 1, name: "Alice", active: true },
    type: "json",
  },
};

export const JsonNested: Story = {
  args: {
    value: { user: { id: 1, roles: ["admin", "editor"] }, meta: { v: 2 } },
    type: "json",
  },
};

export const ArrayValue: Story = {
  args: {
    value: ["apple", "banana", "cherry"],
    type: "array",
  },
};

export const Truncated: Story = {
  args: {
    value: { description: "This is a very long description that will be truncated because it exceeds the default maxLength of eighty characters" },
    type: "json",
  },
};

export const CustomMaxLength: Story = {
  args: {
    value: { a: 1, b: 2, c: 3 },
    type: "json",
    maxLength: 10,
  },
};
