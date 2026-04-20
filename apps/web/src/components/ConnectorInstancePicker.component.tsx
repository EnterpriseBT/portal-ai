import React from "react";

import { MultiSearchableSelect } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import { sdk } from "../api/sdk";

export interface ConnectorInstancePickerProps {
  selected: string[];
  onChange: (ids: string[]) => void;
}

export const ConnectorInstancePicker: React.FC<
  ConnectorInstancePickerProps
> = ({ selected, onChange }) => {
  const { data, isLoading } = sdk.connectorInstances.list({
    limit: 100,
    offset: 0,
    sortBy: "name",
    sortOrder: "asc",
  });

  const options: SelectOption[] = (data?.connectorInstances ?? []).map(
    (ci) => ({ value: ci.id, label: ci.name })
  );

  return (
    <MultiSearchableSelect
      options={options}
      value={selected}
      onChange={onChange}
      label="Connector Instances"
      placeholder={isLoading ? "Loading..." : "Select instances..."}
      disabled={isLoading}
    />
  );
};
