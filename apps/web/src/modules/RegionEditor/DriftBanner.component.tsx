import React from "react";
import { Box } from "@portalai/core/ui";

import type { DriftReportPreview } from "./utils/region-editor.types";

export interface DriftBannerUIProps {
  report: DriftReportPreview;
}

export const DriftBannerUI: React.FC<DriftBannerUIProps> = ({ report }) => {
  const severityColor =
    report.severity === "blocker"
      ? "error.main"
      : report.severity === "warn"
        ? "warning.main"
        : "info.main";
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 1,
        border: "1px solid",
        borderColor: severityColor,
        backgroundColor: `${report.severity === "blocker" ? "#fee2e2" : "#fef3c7"}`,
      }}
    >
      <Box sx={{ fontWeight: 600, mb: 0.5 }}>
        Drift halted sync {report.identityChanging ? "— identity changing" : ""}
      </Box>
      <Box sx={{ fontSize: 12, color: "text.secondary" }}>
        Workbook pinned as of {report.fetchedAt}. Editing against the same data the sync saw.
      </Box>
      {report.notes && <Box sx={{ fontSize: 12, mt: 0.5 }}>{report.notes}</Box>}
    </Box>
  );
};
