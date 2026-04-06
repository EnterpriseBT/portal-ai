import type { Meta, StoryObj } from "@storybook/react";
import { EntityRecordMetadata } from "../components/EntityRecordMetadata.component";
import type { EntityRecord } from "@portalai/core/models";

const stubRecord: EntityRecord = {
  id: "rec-f47ac10b-58cc-4372-a567-0e02b2c3d479",
  organizationId: "org-1",
  connectorEntityId: "ent-3b4c5d6e-7f8a-9b0c-1d2e-3f4a5b6c7d8e",
  data: { first_name: "Alice", last_name: "Johnson" },
  normalizedData: { first_name: "Alice", last_name: "Johnson" },
  sourceId: "CONTACT-001",
  checksum: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  syncedAt: 1718438400000,
  origin: "sync",
  created: 1700000000000,
  createdBy: "system",
  updated: 1710000000000,
  updatedBy: "user-abc",
  deleted: null,
  deletedBy: null,
};

const meta = {
  title: "Components/EntityRecordMetadata",
  component: EntityRecordMetadata,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof EntityRecordMetadata>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { record: stubRecord } };

export const NeverSynced: Story = {
  args: { record: { ...stubRecord, syncedAt: null as unknown as number } },
};

export const NeverUpdated: Story = {
  args: { record: { ...stubRecord, updated: null, updatedBy: null } },
};
