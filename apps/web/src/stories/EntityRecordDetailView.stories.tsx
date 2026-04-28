import type { Meta, StoryObj } from "@storybook/react";
import { EntityRecordDetailViewUI } from "../views/EntityRecordDetail.view";
import type { ConnectorEntity, EntityRecord } from "@portalai/core/models";
import type { ResolvedColumn } from "@portalai/core/contracts";

const stubEntity: ConnectorEntity = {
  id: "ent-1",
  organizationId: "org-1",
  connectorInstanceId: "inst-1",
  key: "contacts",
  label: "Contacts",
  created: 1700000000000,
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const stubRecord: EntityRecord = {
  id: "rec-f47ac10b-58cc-4372-a567-0e02b2c3d479",
  organizationId: "org-1",
  connectorEntityId: "ent-1",
  data: {},
  origin: "manual",
  validationErrors: null,
  isValid: true,
  normalizedData: {
    name: "Alice Johnson",
    email: "alice@example.com",
    age: 32,
    active: true,
    joined: "2024-01-15",
    score: 98.5,
    tags: ["admin", "editor"],
    meta: { tier: "gold", notes: "VIP customer" },
  },
  sourceId: "CONTACT-001",
  checksum: "a1b2c3d4e5f6",
  syncedAt: 1718438400000,
  created: 1700000000000,
  createdBy: "system",
  updated: 1710000000000,
  updatedBy: "user-abc",
  deleted: null,
  deletedBy: null,
};

const stubColumns: ResolvedColumn[] = [
  {
    key: "name",
    normalizedKey: "name",
    label: "Full Name",
    type: "string",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "email",
    normalizedKey: "email",
    label: "Email",
    type: "string",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "age",
    normalizedKey: "age",
    label: "Age",
    type: "number",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "active",
    normalizedKey: "active",
    label: "Active",
    type: "boolean",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "joined",
    normalizedKey: "joined",
    label: "Joined",
    type: "date",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "score",
    normalizedKey: "score",
    label: "Score",
    type: "number",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "tags",
    normalizedKey: "tags",
    label: "Tags",
    type: "array",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
  {
    key: "meta",
    normalizedKey: "meta",
    label: "Metadata",
    type: "json",
    required: false,
    enumValues: null,
    defaultValue: null,
    validationPattern: null,
    canonicalFormat: null,
    format: null,
  },
];

const meta = {
  title: "Views/EntityRecordDetailViewUI",
  component: EntityRecordDetailViewUI,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof EntityRecordDetailViewUI>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    entity: stubEntity,
    record: stubRecord,
    columns: stubColumns,
  },
};

export const MissingFields: Story = {
  args: {
    entity: stubEntity,
    record: { ...stubRecord, normalizedData: { name: "Bob Smith" } },
    columns: stubColumns,
  },
};

export const NoColumns: Story = {
  args: {
    entity: stubEntity,
    record: stubRecord,
    columns: [],
  },
};
