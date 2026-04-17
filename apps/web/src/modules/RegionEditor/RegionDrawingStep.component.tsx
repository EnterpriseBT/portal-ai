import React, { useEffect, useMemo } from "react";
import { Box, Stack, Typography, Tabs, Button, Select } from "@portalai/core/ui";
import MuiTab from "@mui/material/Tab";
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
import type { RegionEditorErrors } from "./utils/region-editor-validation.util";

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
  const activeSheet = workbook.sheets.find((s) => s.id === activeSheetId) ?? workbook.sheets[0];

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

  const regionSelectOptions: SelectOption[] = useMemo(
    () =>
      regions.map((region) => {
        const sheet = workbook.sheets.find((s) => s.id === region.sheetId);
        const sheetName = sheet?.name ?? region.sheetId;
        const entityLabel =
          region.targetEntityLabel ??
          (region.targetEntityDefinitionId
            ? entityOptions.find((o) => o.value === region.targetEntityDefinitionId)?.label ??
              region.targetEntityDefinitionId
            : "Unbound");
        const labelPart = region.proposedLabel ?? formatBounds(region.bounds);
        return {
          value: region.id,
          label: `${labelPart} · ${sheetName} · ${entityLabel}`,
        };
      }),
    [regions, workbook.sheets, entityOptions]
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

  useEffect(() => {
    if (!selectedRegionId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace" && e.key !== "Escape") return;
      const target = e.target as HTMLElement | null;
      // Never hijack keys while the user is editing text.
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
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
  const siblingsInSameEntity = selectedRegion?.targetEntityDefinitionId
    ? regions.filter(
      (r) =>
        r.id !== selectedRegion.id &&
        r.targetEntityDefinitionId === selectedRegion.targetEntityDefinitionId
    ).length
    : 0;

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
        <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap" useFlexGap>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Draw regions
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Drag to outline a region, then bind it to an entity.
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
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
            regions.length === 0 ? "No regions yet — draw one on the grid" : "Select a region…"
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
                      backgroundColor: count > 0 ? "primary.main" : "grey.300",
                      color: count > 0 ? "primary.contrastText" : "text.secondary",
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
        direction="column"
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
          />
        </Box>
        <Box sx={{ width: "100%", minWidth: 0 }}>
          <RegionConfigurationPanelUI
            region={selectedRegion}
            entityOptions={entityOptions}
            entityOrder={entityOrder}
            siblingsInSameEntity={siblingsInSameEntity}
            errors={selectedRegion ? errors?.[selectedRegion.id] : undefined}
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

      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        spacing={1}
        flexWrap="wrap"
        useFlexGap
      >
        {errors && Object.keys(errors).length > 0 ? (
          <Typography variant="caption" color="error">
            {Object.keys(errors).length}{" "}
            {Object.keys(errors).length === 1 ? "region has" : "regions have"} validation errors —
            fix them to continue.
          </Typography>
        ) : (
          <span />
        )}
        <Button
          variant="contained"
          onClick={onInterpret}
          disabled={
            isInterpreting ||
            regions.length === 0 ||
            (errors !== undefined && Object.keys(errors).length > 0)
          }
        >
          {isInterpreting ? "Interpreting…" : "Interpret"}
        </Button>
      </Stack>
    </Stack>
  );
};
