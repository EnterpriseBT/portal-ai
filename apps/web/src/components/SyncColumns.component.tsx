import React from "react";

import type { ColumnDefinitionSummary } from "@portalai/core/contracts";

/** Syncs column definitions from the API response into parent state. */
export const SyncColumns: React.FC<{
  columns: ColumnDefinitionSummary[];
  setColumns: (cols: ColumnDefinitionSummary[]) => void;
  children: React.ReactNode;
}> = ({ columns, setColumns, children }) => {
  const prevRef = React.useRef<ColumnDefinitionSummary[]>([]);
  React.useEffect(() => {
    if (columns.length > 0 && columns !== prevRef.current) {
      prevRef.current = columns;
      setColumns(columns);
    }
  }, [columns, setColumns]);
  return <>{children}</>;
};
