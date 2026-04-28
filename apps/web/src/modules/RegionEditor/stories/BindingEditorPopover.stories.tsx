import React, { useRef, useState, useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { fn } from "@storybook/test";
import type { SelectOption } from "@portalai/core/ui";

import { BindingEditorPopoverUI } from "../BindingEditorPopover.component";
import type { BindingEditorPopoverUIProps } from "../BindingEditorPopover.component";
import type { ColumnBindingDraft } from "../utils/region-editor.types";

const baseBinding: ColumnBindingDraft = {
  sourceLocator: "header:Email",
  columnDefinitionId: "coldef_email",
  columnDefinitionLabel: "Email",
  confidence: 0.9,
};

const columnDefinitionSearch: BindingEditorPopoverUIProps["columnDefinitionSearch"] =
  {
    onSearch: async (q: string) => {
      const all: SelectOption[] = [
        { value: "coldef_email", label: "Email" },
        { value: "coldef_name", label: "Name" },
        { value: "coldef_revenue", label: "Revenue" },
        { value: "coldef_customer_ref", label: "Customer (reference)" },
        { value: "coldef_region", label: "Region (enum)" },
      ];
      if (!q) return all;
      const needle = q.toLowerCase();
      return all.filter((o) => o.label.toLowerCase().includes(needle));
    },
    onSearchPending: false,
    onSearchError: null,
    getById: async (id: string) => {
      const map: Record<string, SelectOption> = {
        coldef_email: { value: "coldef_email", label: "Email" },
        coldef_name: { value: "coldef_name", label: "Name" },
        coldef_revenue: { value: "coldef_revenue", label: "Revenue" },
        coldef_customer_ref: {
          value: "coldef_customer_ref",
          label: "Customer (reference)",
        },
        coldef_region: { value: "coldef_region", label: "Region (enum)" },
      };
      return map[id] ?? null;
    },
    getByIdPending: false,
    getByIdError: null,
    labelMap: {
      coldef_email: "Email",
      coldef_name: "Name",
      coldef_revenue: "Revenue",
      coldef_customer_ref: "Customer (reference)",
      coldef_region: "Region (enum)",
    },
  };

// The popover anchors off a DOM element; stories mount a dummy anchor to give
// MUI's Popover a target so positioning + portal rendering behave like prod.
const AnchorHarness: React.FC<{
  initialDraft: ColumnBindingDraft;
  columnDefinitionType?: BindingEditorPopoverUIProps["columnDefinitionType"];
  columnDefinitionDescription?: BindingEditorPopoverUIProps["columnDefinitionDescription"];
  referenceEntityOptions?: BindingEditorPopoverUIProps["referenceEntityOptions"];
  referenceFieldOptions?: BindingEditorPopoverUIProps["referenceFieldOptions"];
  errors?: BindingEditorPopoverUIProps["errors"];
  serverError?: BindingEditorPopoverUIProps["serverError"];
}> = ({
  initialDraft,
  columnDefinitionType,
  columnDefinitionDescription,
  referenceEntityOptions,
  referenceFieldOptions,
  errors = {},
  serverError = null,
}) => {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<ColumnBindingDraft>(initialDraft);

  useEffect(() => {
    if (anchorRef.current) setAnchorEl(anchorRef.current);
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <button ref={anchorRef} style={{ padding: 8 }} type="button">
        Anchor chip (click disabled in story)
      </button>
      <BindingEditorPopoverUI
        open={anchorEl !== null}
        anchorEl={anchorEl}
        binding={initialDraft}
        draft={draft}
        columnDefinitionType={columnDefinitionType}
        columnDefinitionDescription={columnDefinitionDescription}
        columnDefinitionSearch={columnDefinitionSearch}
        referenceEntityOptions={referenceEntityOptions}
        referenceFieldOptions={referenceFieldOptions}
        errors={errors}
        serverError={serverError}
        onChange={(patch) => {
          setDraft((prev) => ({ ...prev, ...patch }));
          fn()(patch);
        }}
        onApply={fn()}
        onCancel={fn()}
      />
    </div>
  );
};

const meta = {
  title: "Modules/RegionEditor/BindingEditorPopoverUI",
  component: AnchorHarness,
  parameters: { layout: "padded" },
  tags: ["autodocs"],
} satisfies Meta<typeof AnchorHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const StringColumn: Story = {
  name: "String column — no per-type editor",
  args: {
    initialDraft: baseBinding,
    columnDefinitionType: "string",
    columnDefinitionDescription: "Primary email contact for the entity.",
  },
};

export const ReferenceColumn: Story = {
  name: "Reference column — staged + DB options",
  args: {
    initialDraft: {
      ...baseBinding,
      sourceLocator: "header:Customer",
      columnDefinitionId: "coldef_customer_ref",
      columnDefinitionLabel: "Customer (reference)",
    },
    columnDefinitionType: "reference",
    columnDefinitionDescription: "Reference to a Customer entity.",
    referenceEntityOptions: [
      { value: "staged_customers", label: "Customers (this import)" },
      { value: "existing_customers", label: "Customers (existing)" },
    ],
    referenceFieldOptions: [
      { value: "id", label: "id" },
      { value: "email", label: "email" },
    ],
  },
};

export const EnumColumn: Story = {
  name: "Enum column — values input visible",
  args: {
    initialDraft: {
      ...baseBinding,
      sourceLocator: "header:Region",
      columnDefinitionId: "coldef_region",
      columnDefinitionLabel: "Region (enum)",
      enumValues: ["NA", "EMEA", "APAC"],
    },
    columnDefinitionType: "enum",
    columnDefinitionDescription: "Sales region.",
  },
};

export const ExcludedState: Story = {
  name: "Excluded — editors disabled, info alert",
  args: {
    initialDraft: { ...baseBinding, excluded: true },
    columnDefinitionType: "string",
  },
};

export const NormalizedKeyValidationError: Story = {
  name: "Validation — normalizedKey regex violation",
  args: {
    initialDraft: { ...baseBinding, normalizedKey: "Bad Key" },
    columnDefinitionType: "string",
    errors: {
      normalizedKey:
        "Must be lowercase snake_case (letters, digits, underscores; start with a letter).",
    },
  },
};

export const ServerErrorAlert: Story = {
  name: "Server error — rendered via FormAlert",
  args: {
    initialDraft: baseBinding,
    columnDefinitionType: "string",
    serverError: {
      message: "Reference unresolvable",
      code: "LAYOUT_PLAN_INVALID_REFERENCE",
    },
  },
};
