import React, { useEffect, useRef } from "react";

import Alert from "@mui/material/Alert";

import { Button, Select, Stack, Typography } from "@portalai/core/ui";

import type { OrphanedRegion } from "../workflows/FileUploadConnector/utils/layout-plan-mapping.util";

export interface OrphanedRegionsNoticeUIProps {
  /** Regions whose sheet is no longer in the workbook. */
  orphans: OrphanedRegion[];
  /** The workbook's sheets, the destinations "Move to sheet…" offers. */
  sheets: { id: string; name: string }[];
  /** True once Interpret was refused while orphans remain: the notice says
   *  so and takes focus. */
  attempted: boolean;
  onMove: (regionId: string, sheetId: string) => void;
  onDelete: (regionId: string) => void;
}

/**
 * #1009: Edit layout's list of regions whose sheet was deleted or renamed at
 * the source. Each can be moved to a sheet (its settings kept) or deleted;
 * Interpret waits until none remain, since the server would refuse them.
 */
export const OrphanedRegionsNoticeUI: React.FC<
  OrphanedRegionsNoticeUIProps
> = ({ orphans, sheets, attempted, onMove, onDelete }) => {
  const rootRef = useRef<HTMLDivElement>(null);

  // The refusal is reported here, so focus follows it.
  useEffect(() => {
    if (attempted) rootRef.current?.focus();
  }, [attempted]);

  if (orphans.length === 0) return null;

  return (
    <Alert
      ref={rootRef}
      severity="warning"
      role="region"
      aria-label="Regions whose sheet is missing"
      tabIndex={-1}
    >
      <Stack spacing={1.5}>
        {orphans.map((orphan) => {
          const label = orphan.targetEntityLabel
            ? `${orphan.boundsA1} (${orphan.targetEntityLabel})`
            : orphan.boundsA1;
          return (
            <Stack key={orphan.region.id} spacing={1}>
              <Typography variant="body2">
                {`${label} was on sheet "${orphan.sheetName}", which is no longer in the workbook.`}
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
              >
                <Select
                  label={`Move ${orphan.boundsA1} to sheet`}
                  value=""
                  placeholder="Move to sheet…"
                  options={sheets.map((s) => ({ value: s.id, label: s.name }))}
                  onChange={(e) => onMove(orphan.region.id, e.target.value)}
                />
                <Button
                  type="button"
                  size="small"
                  variant="outlined"
                  color="error"
                  aria-label={`Delete region ${orphan.boundsA1}`}
                  onClick={() => onDelete(orphan.region.id)}
                >
                  Delete
                </Button>
              </Stack>
            </Stack>
          );
        })}
        {attempted && (
          <Typography variant="subtitle2" component="p">
            Resolve these before interpreting.
          </Typography>
        )}
      </Stack>
    </Alert>
  );
};
