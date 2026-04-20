import type { Meta, StoryObj } from "@storybook/react";
import { EntityRecordFieldValue } from "../components/EntityRecordFieldValue.component";

const meta = {
  title: "Components/EntityRecordFieldValue",
  component: EntityRecordFieldValue,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
} satisfies Meta<typeof EntityRecordFieldValue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StringType: Story = {
  args: { value: "hello world", type: "string" },
};
export const NumberType: Story = { args: { value: 42000, type: "number" } };
export const BooleanTrue: Story = { args: { value: true, type: "boolean" } };
export const BooleanFalse: Story = { args: { value: false, type: "boolean" } };
export const DateType: Story = { args: { value: "2024-06-15", type: "date" } };
export const DatetimeType: Story = {
  args: { value: 1718438400000, type: "datetime" },
};
export const JsonObject: Story = {
  args: {
    value: {
      id: 1,
      name: "Alice",
      roles: ["admin", "editor"],
      meta: { active: true },
    },
    type: "json",
  },
};
export const ArrayType: Story = {
  args: { value: ["apple", "banana", "cherry"], type: "array" },
};
export const NullValue: Story = { args: { value: null, type: "string" } };
export const UndefinedValue: Story = {
  args: { value: undefined, type: "number" },
};
