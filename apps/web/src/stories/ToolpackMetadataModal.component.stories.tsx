import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { Toolpack } from "@portalai/core/contracts";

import { ToolpackMetadataModalUI } from "../components/ToolpackMetadataModal.component";

const builtinPack: Toolpack = {
  id: "builtin:entity_management",
  kind: "builtin",
  slug: "entity_management",
  name: "Entity Management",
  description: "Create, update, and delete entity records.",
  iconSlug: "Hub",
  tools: [
    {
      name: "entity_record_create",
      description: "Create a record on an entity.",
      parameterSchema: {
        type: "object",
        properties: {
          connectorEntityId: { type: "string" },
          normalizedData: { type: "object" },
        },
        required: ["connectorEntityId", "normalizedData"],
      },
    },
  ],
} as Toolpack;

const meta = {
  title: "Components/ToolpackMetadataModalUI",
  component: ToolpackMetadataModalUI,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  args: {
    toolpack: builtinPack,
    open: true,
    onClose: fn(),
  },
} satisfies Meta<typeof ToolpackMetadataModalUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/**
 * The same pack when the organization's plan does not include it (#284). The
 * tool list still renders — the modal documents what the pack *does* — with a
 * notice stating the limit and linking to Subscription & Billing, so a badged
 * row never dead-ends in a modal that reads as fully available.
 */
export const Unentitled: Story = {
  args: { entitled: false },
};
