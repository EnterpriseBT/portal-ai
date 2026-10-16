import React from "react";

import type { Meta, StoryObj } from "@storybook/react";
import Box from "@mui/material/Box";

import { KeyValueTableUI } from "../components/KeyValueTable.component";
import {
  newKeyValueRow,
  validateKeyValueRows,
  keyValueRowErrorKey,
  type KeyValueRow,
} from "../utils/key-value-rows.util";

const meta = {
  title: "Components/KeyValueTable",
  component: KeyValueTableUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: { rows: [], onChange: () => {} },
} satisfies Meta<typeof KeyValueTableUI>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Stateful wrapper so a story can be edited in place, validating as it goes. */
const Editable: React.FC<{ initial: KeyValueRow[]; itemNoun?: string }> = ({
  initial,
  itemNoun,
}) => {
  const [rows, setRows] = React.useState(initial);
  const errors = validateKeyValueRows(rows, "rows");
  return (
    <Box sx={{ maxWidth: 640 }}>
      <KeyValueTableUI
        rows={rows}
        onChange={setRows}
        itemNoun={itemNoun}
        emptyHint="No query parameters. Add one to send it with every request."
        keyErrors={rows.map((r) => errors[keyValueRowErrorKey("rows", r.id)])}
      />
    </Box>
  );
};

export const Empty: Story = {
  render: () => <Editable initial={[]} />,
};

export const QueryParameters: Story = {
  render: () => (
    <Editable
      initial={[
        newKeyValueRow("where", "1=1"),
        newKeyValueRow("outFields", "*"),
        newKeyValueRow("resultOffset", "{{cursor}}"),
      ]}
    />
  ),
};

/** #808: a duplicate key and a value with no key are inline errors. */
export const WithErrors: Story = {
  render: () => (
    <Editable
      initial={[
        newKeyValueRow("f", "json"),
        newKeyValueRow("f", "geojson"),
        newKeyValueRow("", "orphan value"),
      ]}
    />
  ),
};

/** The same table for request headers (#809). */
export const Headers: Story = {
  render: () => (
    <Editable
      itemNoun="header"
      initial={[newKeyValueRow("Accept", "application/geo+json")]}
    />
  ),
};
