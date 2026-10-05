import React from "react";

import { DataTable, type DataTableColumn } from "@portalai/core/ui";

import type { PolicyStatementInput } from "@portalai/core/contracts";

export interface PolicyStatementListUIProps {
  statements: PolicyStatementInput[];
}

const COLUMNS: DataTableColumn[] = [
  { key: "effect", label: "Effect" },
  { key: "verb", label: "Verb" },
  { key: "resourceType", label: "Resource" },
  { key: "scope", label: "Scope" },
  { key: "ownership", label: "Ownership" },
];

/**
 * #691: a policy's statements as text, for a policy that can't be edited (a
 * system policy). The editor's read-only mode rendered every control
 * disabled; a view shouldn't look like a form you're locked out of.
 */
export const PolicyStatementListUI: React.FC<PolicyStatementListUIProps> = ({
  statements,
}) => (
  <div data-testid="policy-statement-list">
    <DataTable
      columns={COLUMNS}
      rows={statements.map((s, i) => ({
        id: String(i),
        effect: s.effect,
        verb: s.verb,
        resourceType: s.resourceType,
        scope: s.resourceId === null ? "All of type" : s.resourceId,
        ownership: s.condition ?? "Any",
      }))}
      emptyMessage="No statements."
    />
  </div>
);
