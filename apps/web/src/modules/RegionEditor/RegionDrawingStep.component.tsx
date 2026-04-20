import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Stack,
  Typography,
  Tabs,
  Button,
  Select,
} from "@portalai/core/ui";
import MuiTab from "@mui/material/Tab";
import MuiChip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { SelectOption } from "@portalai/core/ui";

import { SheetCanvasUI } from "./SheetCanvas.component";
import { EntityLegendUI } from "./EntityLegend.component";
import { RegionConfigurationPanelUI } from "./RegionConfigurationPanel.component";
import { formatBounds } from "./utils/a1-notation.util";
import { colorForEntity } from "./utils/region-editor-colors.util";
import type {
  CellBounds,
  EntityLegendEntry,
  EntityOption,
  RegionDraft,
  Workbook,
} from "./utils/region-editor.types";
import {
  validateRegions,
  type RegionEditorErrors,
  type RegionErrors,
} from "./utils/region-editor-validation.util";

export interface RegionDrawingStepUIProps {
  workbook: Workbook;
  regions: RegionDraft[];
  activeSheetId: string;
  onActiveSheetChange: (sheetId: string) => void;
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string | null) => void;
  onRegionDraft: (draft: { sheetId: string; bounds: CellBounds }) => void;
  onRegionUpdate: (regionId: string, updates: Partial<RegionDraft>) => void;
  onRegionDelete: (regionId: string) => void;
  onRegionResize?: (regionId: string, nextBounds: CellBounds) => void;
  entityOptions: EntityOption[];
  onSuggestAxisName?: (regionId: string) => void;
  onAcceptProposedIdentity?: (regionId: string) => void;
  onKeepPriorIdentity?: (regionId: string) => void;
  onCreateEntity?: (key: string, label: string) => string;
  onInterpret: () => void;
  onRefetchWorkbook?: () => void;
  isInterpreting?: boolean;
  errors?: RegionEditorErrors;
}

export const RegionDrawingStepUI: React.FC<RegionDrawingStepUIProps> = ({
  workbook,
  regions,
  activeSheetId,
  onActiveSheetChange,
  selectedRegionId,
  onSelectRegion,
  onRegionDraft,
  onRegionUpdate,
  onRegionDelete,
  onRegionResize,
  entityOptions,
  onSuggestAxisName,
  onAcceptProposedIdentity,
  onKeepPriorIdentity,
  onCreateEntity,
  onInterpret,
  onRefetchWorkbook,
  isInterpreting = false,
  errors,
}) => {
  const [attemptedInterpret, setAttemptedInterpret] = useState(false);
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up("lg"));
  const activeSheet =
    workbook.sheets.find((s) => s.id === activeSheetId) ?? workbook.sheets[0];

  const entityOrder = useMemo(() => {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const region of regions) {
      const id = region.targetEntityDefinitionId;
      if (id && !seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    return order;
  }, [regions]);

  const legendEntries: EntityLegendEntry[] = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const region of regions) {
      const id = region.targetEntityDefinitionId;
      if (!id) continue;
      const label =
        region.targetEntityLabel ??
        entityOptions.find((o) => o.value === id)?.label ??
        id;
      const prev = counts.get(id);
      counts.set(id, { label, count: (prev?.count ?? 0) + 1 });
    }
    return entityOrder.map((id) => {
      const entry = counts.get(id)!;
      return {
        id,
        label: entry.label,
        color: colorForEntity(id, entityOrder),
        regionCount: entry.count,
      };
    });
  }, [regions, entityOrder, entityOptions]);

  const regionDisplayLabel = useCallback(
    (region: RegionDraft): string => {
      const sheet = workbook.sheets.find((s) => s.id === region.sheetId);
      const sheetName = sheet?.name ?? region.sheetId;
      const entityLabel =
        region.targetEntityLabel ??
        (region.targetEntityDefinitionId
          ? (entityOptions.find(
              (o) => o.value === region.targetEntityDefinitionId
            )?.label ?? region.targetEntityDefinitionId)
          : "Unbound");
      const labelPart = region.proposedLabel ?? formatBounds(region.bounds);
      return `${labelPart} · ${sheetName} · ${entityLabel}`;
    },
    [workbook.sheets, entityOptions]
  );

  const regionSelectOptions: SelectOption[] = useMemo(
    () =>
      regions.map((region) => ({
        value: region.id,
        label: regionDisplayLabel(region),
      })),
    [regions, regionDisplayLabel]
  );

  const computedErrors = useMemo<RegionEditorErrors>(
    () => validateRegions(regions),
    [regions]
  );

  const effectiveErrors = useMemo<RegionEditorErrors>(() => {
    if (!errors) return computedErrors;
    const merged: RegionEditorErrors = { ...computedErrors };
    for (const [regionId, regionErrors] of Object.entries(errors)) {
      merged[regionId] = { ...(merged[regionId] ?? {}), ...regionErrors };
    }
    return merged;
  }, [computedErrors, errors]);

  const invalidRegionIds = useMemo(
    () =>
      regions
        .map((r) => r.id)
        .filter((id) => effectiveErrors[id] !== undefined),
    [regions, effectiveErrors]
  );

  const handleJumpToRegion = (nextId: string) => {
    if (!nextId) {
      onSelectRegion(null);
      return;
    }
    const region = regions.find((r) => r.id === nextId);
    if (!region) return;
    if (region.sheetId !== activeSheetId) {
      onActiveSheetChange(region.sheetId);
    }
    onSelectRegion(region.id);
  };

  const handleInterpret = () => {
    setAttemptedInterpret(true);
    if (invalidRegionIds.length > 0) {
      const firstInvalid = regions.find((r) => r.id === invalidRegionIds[0]);
      if (firstInvalid) {
        if (firstInvalid.sheetId !== activeSheetId) {
          onActiveSheetChange(firstInvalid.sheetId);
        }
        onSelectRegion(firstInvalid.id);
      }
      return;
    }
    onInterpret();
  };

  useEffect(() => {
    if (!selectedRegionId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace" && e.key !== "Escape")
        return;
      const target = e.target as HTMLElement | null;
      // Never hijack keys while the user is editing text.
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onSelectRegion(null);
        return;
      }
      e.preventDefault();
      onRegionDelete(selectedRegionId);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedRegionId, onRegionDelete, onSelectRegion]);

  const selectedRegion = regions.find((r) => r.id === selectedRegionId) ?? null;
  const selectedRegionSheet = selectedRegion
    ? workbook.sheets.find((s) => s.id === selectedRegion.sheetId)
    : undefined;
  const siblingsInSameEntity = selectedRegion?.targetEntityDefinitionId
    ? regions.filter(
        (r) =>
          r.id !== selectedRegion.id &&
          r.targetEntityDefinitionId === selectedRegion.targetEntityDefinitionId
      ).length
    : 0;

  const showErrors = attemptedInterpret;
  const panelErrors: RegionErrors | undefined = selectedRegion
    ? showErrors
      ? effectiveErrors[selectedRegion.id]
      : errors?.[selectedRegion.id]
    : undefined;

  if (!activeSheet) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">No sheets available.</Typography>
      </Box>
    );
  }

  const regionCountBySheet = (sheetId: string) =>
    regions.filter((r) => r.sheetId === sheetId).length;

  return (
    <Stack
      spacing={2}
      sx={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={2}
        flexWrap="wrap"
        useFlexGap
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="baseline"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Draw regions
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Drag to outline a region, then bind it to an entity.
          </Typography>
        </Stack>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          {workbook.fetchedAt && (
            <Typography variant="caption" color="text.secondary">
              Data as of {workbook.fetchedAt}
              {workbook.sourceLabel ? ` · ${workbook.sourceLabel}` : ""}
            </Typography>
          )}
          {onRefetchWorkbook && (
            <Button size="small" variant="text" onClick={onRefetchWorkbook}>
              Re-fetch latest
            </Button>
          )}
        </Stack>
      </Stack>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "stretch", sm: "center" }}
        justifyContent="space-between"
        sx={{ width: "100%", minWidth: 0 }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <EntityLegendUI entries={legendEntries} />
        </Box>
        <Select
          label="Jump to region"
          size="small"
          value={selectedRegionId ?? ""}
          onChange={(e) => handleJumpToRegion((e.target.value as string) || "")}
          options={regionSelectOptions}
          placeholder={
            regions.length === 0
              ? "No regions yet — draw one on the grid"
              : "Select a region…"
          }
          disabled={regions.length === 0}
          sx={{ width: { xs: "100%", sm: 320 }, flexShrink: 0 }}
        />
      </Stack>

      <Box
        sx={{
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          overflow: "hidden",
        }}
      >
        <Tabs
          value={activeSheet.id}
          onChange={(_e, v) => onActiveSheetChange(v as string)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ width: "100%", maxWidth: "100%", minWidth: 0, minHeight: 0 }}
        >
          {workbook.sheets.map((sheet) => {
            const count = regionCountBySheet(sheet.id);
            return (
              <MuiTab
                key={sheet.id}
                value={sheet.id}
                label={
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    <span>{sheet.name}</span>
                    <Box
                      component="span"
                      sx={{
                        display: "inline-block",
                        minWidth: 18,
                        textAlign: "center",
                        px: 0.5,
                        borderRadius: 9,
                        fontSize: 10,
                        fontWeight: 700,
                        backgroundColor:
                          count > 0 ? "primary.main" : "grey.300",
                        color:
                          count > 0 ? "primary.contrastText" : "text.secondary",
                      }}
                    >
                      {count}
                    </Box>
                  </Stack>
                }
              />
            );
          })}
        </Tabs>
      </Box>

      <Stack
        direction={{ xs: "column", lg: "row" }}
        spacing={2}
        alignItems="stretch"
        sx={{
          width: "100%",
          maxWidth: "100%",
          minWidth: 0,
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            flex: { xs: "none", lg: 1 },
            width: "100%",
            minWidth: 0,
            maxWidth: "100%",
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr)",
            overflow: "hidden",
          }}
        >
          <SheetCanvasUI
            sheet={activeSheet}
            regions={regions}
            entityOrder={entityOrder}
            selectedRegionId={selectedRegionId}
            onRegionSelect={onSelectRegion}
            onRegionDraft={(bounds) =>
              onRegionDraft({ sheetId: activeSheet.id, bounds })
            }
            onRegionResize={onRegionResize}
            maxHeight={isLargeScreen ? "calc(100vh - 400px)" : 420}
          />
        </Box>
        <Box
          sx={{
            width: { xs: "100%", lg: 440 },
            minWidth: 0,
            flexShrink: 0,
            maxHeight: { xs: "none", lg: "calc(100vh - 400px)" },
            overflowY: { xs: "visible", lg: "auto" },
          }}
        >
          <RegionConfigurationPanelUI
            region={selectedRegion}
            sheet={selectedRegionSheet}
            entityOptions={entityOptions}
            entityOrder={entityOrder}
            siblingsInSameEntity={siblingsInSameEntity}
            errors={panelErrors}
            onUpdate={(updates) =>
              selectedRegion && onRegionUpdate(selectedRegion.id, updates)
            }
            onDelete={() => selectedRegion && onRegionDelete(selectedRegion.id)}
            onSuggestAxisName={
              selectedRegion && onSuggestAxisName
                ? () => onSuggestAxisName(selectedRegion.id)
                : undefined
            }
            onAcceptProposedIdentity={
              selectedRegion && onAcceptProposedIdentity
                ? () => onAcceptProposedIdentity(selectedRegion.id)
                : undefined
            }
            onKeepPriorIdentity={
              selectedRegion && onKeepPriorIdentity
                ? () => onKeepPriorIdentity(selectedRegion.id)
                : undefined
            }
            onCreateEntity={onCreateEntity}
          />
        </Box>
      </Stack>

      {showErrors && invalidRegionIds.length > 0 && (
        <Box
          role="alert"
          sx={{
            p: 1.5,
            borderRadius: 1,
            border: "1px solid",
            borderColor: "error.main",
            backgroundColor: "error.lighter",
          }}
        >
          <Typography variant="subtitle2" color="error.dark" sx={{ mb: 0.5 }}>
            {invalidRegionIds.length === 1
              ? "1 region has validation errors"
              : `${invalidRegionIds.length} regions have validation errors`}{" "}
            — fix them before interpreting.
          </Typography>
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
            {invalidRegionIds.map((id) => {
              const region = regions.find((r) => r.id === id);
              if (!region) return null;
              return (
                <MuiChip
                  key={id}
                  size="small"
                  color="error"
                  variant="outlined"
                  clickable
                  label={regionDisplayLabel(region)}
                  onClick={() => handleJumpToRegion(id)}
                />
              );
            })}
          </Stack>
        </Box>
      )}

      <Stack
        direction="row"
        justifyContent="flex-end"
        alignItems="center"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
      >
        <Button
          variant="contained"
          onClick={handleInterpret}
          disabled={isInterpreting || regions.length === 0}
        >
          {isInterpreting ? "Interpreting…" : "Interpret"}
        </Button>
      </Stack>
    </Stack>
  );
};
