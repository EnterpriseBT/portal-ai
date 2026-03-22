import React from "react";

import Alert from "@mui/material/Alert";

import { sdk } from "../api/sdk";

// ── Pure UI ──────────────────────────────────────────────────────────

export interface BidirectionalConsistencyBannerUIProps {
  sourceField: string;
  inconsistentRecordCount: number;
  totalChecked: number;
}

export const BidirectionalConsistencyBannerUI: React.FC<
  BidirectionalConsistencyBannerUIProps
> = ({ sourceField, inconsistentRecordCount, totalChecked }) => (
  <Alert severity="warning">
    Array references for <strong>{sourceField}</strong> are out of sync.{" "}
    {inconsistentRecordCount} of {totalChecked} record
    {totalChecked !== 1 ? "s" : ""} have inconsistent back-references.
  </Alert>
);

// ── Container ────────────────────────────────────────────────────────

export interface BidirectionalConsistencyBannerProps {
  fieldMappingId: string;
  sourceField: string;
}

export const BidirectionalConsistencyBanner: React.FC<
  BidirectionalConsistencyBannerProps
> = ({ fieldMappingId, sourceField }) => {
  const result = sdk.fieldMappings.validateBidirectional(fieldMappingId);

  if (!result.data || result.data.isConsistent !== false) {
    return null;
  }

  return (
    <BidirectionalConsistencyBannerUI
      sourceField={sourceField}
      inconsistentRecordCount={result.data.inconsistentRecordIds.length}
      totalChecked={result.data.totalChecked}
    />
  );
};
