import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Stack,
  Typography,
  Tabs,
  Button,
  Select,
  CircularProgress,
  FormDefaultButton,
  handleOwnSubmit,
  preventToggleEnterSubmit,
  StatusMessage,
} from "@portalai/core/ui";
import MuiTab from "@mui/material/Tab";
import MuiChip from "@mui/material/Chip";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import type { SelectOption } from "@portalai/core/ui";

import { SheetCanvasUI } from "./SheetCanvas.component";
import type { LoadSliceFn } from "./SheetCanvas.component";
import { EntityLegendUI } from "./EntityLegend.component";
import { RegionConfigurationPanelUI } from "./RegionConfigurationPanel.component";
import { adjustSegmentsForBoundsChange } from "./utils/adjust-segments-for-bounds.util";
import { formatBounds } from "./utils/a1-notation.util";
import { entitySlot } from "./utils/region-editor-colors.util";
import { resizeSegment } from "./utils/segment-ops.util";
import { orientationFromDraft } from "./utils/region-orientation.util";
import {
  isFocusLost,
  useFocusOnArrival,
  useRestoreFocusOnRemoval,
} from "./utils/focus-recovery.util";
import { useRegionAnnouncements } from "./utils/use-region-announcements.util";
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
import { fitBoundsToSheet, regionOverhang } from "./utils/region-overhang.util";

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
  onAcceptProposedIdentity?: (regionId: string) => void;
  onKeepPriorIdentity?: (regionId: string) => void;
  onCreateEntity?: (key: string, label: string) => string;
  /**
   * Forwarded to `RegionConfigurationPanelUI` — when `true`, the
   * panel disables the Target-Entity Select + Label TextField and
   * hides the "+ Create new entity" button. Used by the edit-plan
   * view to lock entity associations post-commit.
   */
  entityAssociationLocked?: boolean;
  /** Forwarded to `RegionConfigurationPanelUI` and also gates the
   * Delete / Backspace keyboard shortcut — so the edit-plan view's
   * read-only-shape policy holds across both UI and keyboard. */
  regionDeletionLocked?: boolean;
  /**
   * C2 async validator forwarded to the "+ Create new entity" dialog in the
   * configuration panel. Returns `{ ok: false, ownedBy }` when the chosen
   * key is already owned by another connector in this org.
   */
  validateEntityKey?: (
    key: string
  ) => Promise<{ ok: true } | { ok: false; ownedBy?: string }>;
  onInterpret: () => void;
  onRefetchWorkbook?: () => void;
  isInterpreting?: boolean;
  errors?: RegionEditorErrors;
  /**
   * When set, an additional "Skip to review" button is shown next to Interpret
   * so the user can jump back to the last interpretation without re-running it.
   * Consumers that haven't produced an interpretation yet (or don't support the
   * skip shortcut) leave this unset.
   */
  onSkipToReview?: () => void;
  /**
   * Forwarded to the SheetCanvas. Required for sheets whose cells were not
   * inlined in the parse response (large workbooks); omit for workbooks
   * whose cells arrived inline.
   */
  loadSlice?: LoadSliceFn;
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
  onAcceptProposedIdentity,
  onKeepPriorIdentity,
  onCreateEntity,
  entityAssociationLocked = false,
  regionDeletionLocked = false,
  validateEntityKey,
  onInterpret,
  onRefetchWorkbook,
  isInterpreting = false,
  errors,
  onSkipToReview,
  loadSlice,
}) => {
  const [attemptedInterpret, setAttemptedInterpret] = useState(false);
  const rootRef = useRef<HTMLFormElement>(null);
  const theme = useTheme();
  const isLargeScreen = useMediaQuery(theme.breakpoints.up("lg"));
  const activeSheet =
    workbook.sheets.find((s) => s.id === activeSheetId) ?? workbook.sheets[0];

  // C1: one region per entity — surface existing claims in the entity picker
  // so users can't accidentally bind a second region to the same target.
  const claimedEntityKeys = useMemo(() => {
    const out = new Set<string>();
    for (const region of regions) {
      if (region.targetEntityDefinitionId) {
        out.add(region.targetEntityDefinitionId);
      }
    }
    return out;
  }, [regions]);

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
        entitySlot: entitySlot(id, entityOrder),
        regionCount: entry.count,
      };
    });
  }, [regions, entityOrder, entityOptions]);

  const entityLabelFor = useCallback(
    (region: RegionDraft): string =>
      region.targetEntityLabel ??
      (region.targetEntityDefinitionId
        ? (entityOptions.find(
            (o) => o.value === region.targetEntityDefinitionId
          )?.label ?? region.targetEntityDefinitionId)
        : "Unbound"),
    [entityOptions]
  );

  const regionDisplayLabel = useCallback(
    (region: RegionDraft): string => {
      const sheet = workbook.sheets.find((s) => s.id === region.sheetId);
      const sheetName = sheet?.name ?? region.sheetId;
      const entityLabel = entityLabelFor(region);
      const labelPart = region.proposedLabel ?? formatBounds(region.bounds);
      return `${labelPart} · ${sheetName} · ${entityLabel}`;
    },
    [workbook.sheets, entityLabelFor]
  );

  const regionSelectOptions: SelectOption[] = useMemo(
    () =>
      regions.map((region) => ({
        value: region.id,
        label: regionDisplayLabel(region),
      })),
    [regions, regionDisplayLabel]
  );

  const computedErrors = useMemo<RegionEditorErrors>(() => {
    const base = validateRegions(regions);
    // #1009: a region past its sheet is refused by interpret, so it's an
    // error here too, named in the "fix them before interpreting" alert.
    for (const region of regions) {
      const sheet = workbook.sheets.find((s) => s.id === region.sheetId);
      if (sheet && regionOverhang(region.bounds, sheet)) {
        base[region.id] = {
          ...(base[region.id] ?? {}),
          bounds:
            "Runs past the sheet — Fit to sheet or drag its edge back inside",
        };
      }
    }
    return base;
  }, [regions, workbook.sheets]);

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

  // What a screen reader hears about each region (#795): on its cells, as
  // their description, and as regions change.
  const describeRegion = useCallback(
    (region: RegionDraft) =>
      `${entityLabelFor(region)}, ${formatBounds(region.bounds)}`,
    [entityLabelFor]
  );
  const { announcement, announceSelection, announceHint } =
    useRegionAnnouncements({
      regions,
      selectedRegionId,
      describe: describeRegion,
    });

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

  /**
   * Single chokepoint for every bounds change — canvas drag-resize,
   * canvas move op, and the panel's manual bounds inputs all funnel
   * through here. The trailing segment on each axis is auto-aligned
   * with the new span (`adjustSegmentsForBoundsChange`) so a region
   * that carries segments stays internally consistent on every
   * mutation. Consumers (workflow harness, edit-plan view, Storybook
   * stub) just receive a fully-formed `Partial<RegionDraft>` patch
   * via `onRegionUpdate` — no caller-side segment math required.
   */
  const handleBoundsChange = useCallback(
    (
      regionId: string,
      nextBounds: CellBounds,
      extra: Partial<RegionDraft> = {}
    ) => {
      const region = regions.find((r) => r.id === regionId);
      if (!region) {
        onRegionUpdate(regionId, { ...extra, bounds: nextBounds });
        return;
      }
      const segmentsByAxis = adjustSegmentsForBoundsChange(
        region.bounds,
        nextBounds,
        region.segmentsByAxis
      );
      onRegionUpdate(regionId, {
        ...extra,
        bounds: nextBounds,
        segmentsByAxis,
      });
      // Fire the legacy `onRegionResize` callback too, for back-compat
      // with consumers (and stories) wired to it. The full update has
      // already gone through `onRegionUpdate`; this is just a
      // notification hook.
      onRegionResize?.(regionId, nextBounds);
    },
    [regions, onRegionUpdate, onRegionResize]
  );

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
      // A dialog, menu or listbox opened over the step owns its own keys:
      // capture runs before it, so without this Escape would deselect the
      // region instead of closing it. A popup is "over" the step when it
      // doesn't contain the step (the wizard's own dialog does).
      const popup = target?.closest?.(
        '[role="dialog"], [role="menu"], [role="listbox"]'
      );
      if (popup && !popup.contains(rootRef.current)) return;
      if (e.key === "Escape") {
        // A selection on the sheet takes Escape first (#795): the grid
        // clears it, and the next Escape deselects the region.
        if (target?.closest?.('[role="grid"][data-has-selection]')) return;
        if (selectedRegionId) {
          e.preventDefault();
          onSelectRegion(null);
          return;
        }
        // Nothing left to clear: an Escape on the sheet stays there rather
        // than closing the wizard and discarding the import (#795). Escape
        // from anywhere else still closes it.
        const grid = target?.closest?.('[role="grid"]');
        if (grid && rootRef.current?.contains(grid)) e.preventDefault();
        return;
      }
      if (!selectedRegionId) return;
      // Delete belongs to the sheet (#795). From a panel control (a button,
      // the closed entity select) it would take the region and all its
      // settings with no undo. Focus on the page itself counts as the
      // sheet: a pointer selection doesn't move focus.
      const onSheet = !!target?.closest?.("[data-sheet-surface]");
      if (!onSheet && !isFocusLost(rootRef.current)) return;
      // Delete + Backspace are no-ops when deletion is locked (edit-
      // plan view). Without this gate the UI hides the Delete button
      // but the keyboard shortcut would still cascade-delete the
      // region, which is precisely what the lock exists to prevent.
      if (regionDeletionLocked) return;
      e.preventDefault();
      onRegionDelete(selectedRegionId);
    };
    // #789: the capture phase, so this runs before an enclosing Modal's own
    // Escape handling. MUI's Dialog handles Escape on its root and stops
    // propagation, so a bubble-phase listener never saw it and Escape closed
    // the whole wizard instead of deselecting. The preventDefault above
    // tells the Modal the Escape was handled.
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [selectedRegionId, onRegionDelete, onSelectRegion, regionDeletionLocked]);

  // Focus never drops to the wizard (#795), where one Escape discards the
  // import: arriving at this step (from Upload, or Back from Review) lands
  // on the sheet's tab stop, and a control that unmounts under focus hands
  // it to the region's form, or to the sheet when no region is left.
  const sheetTabStop = () =>
    rootRef.current?.querySelector<HTMLElement>('[role="grid"] [tabindex="0"]');
  const regionPanel = () =>
    rootRef.current?.querySelector<HTMLElement>("[data-region-panel]");
  useFocusOnArrival(rootRef, sheetTabStop);
  useRestoreFocusOnRemoval(rootRef, () =>
    selectedRegionId ? (regionPanel() ?? sheetTabStop()) : sheetTabStop()
  );
  // The corner button made a region from a key: focus its first field, as
  // a typed range does, once the new region is the selected one.
  const cornerDraftFromRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const from = cornerDraftFromRef.current;
    if (from === undefined || !selectedRegionId || selectedRegionId === from) {
      return;
    }
    cornerDraftFromRef.current = undefined;
    regionPanel()
      ?.querySelector<HTMLElement>(
        "input:not([disabled]):not([type=hidden]):not([aria-hidden=true])"
      )
      ?.focus();
  }, [selectedRegionId]);

  const selectedRegion = regions.find((r) => r.id === selectedRegionId) ?? null;
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

  // The errors a region shows, the same ones its panel shows: computed ones
  // after an Interpret attempt, the caller's before.
  const shownErrors = (id: string): RegionErrors | undefined =>
    showErrors ? effectiveErrors[id] : errors?.[id];
  const RECORDS_BY = {
    "rows-as-records": "row",
    "columns-as-records": "column",
    "cells-as-records": "cell",
  } as const;
  const regionDescriptions: Record<string, string> = {};
  const shownInvalidIds: string[] = [];
  for (const region of regions) {
    let text = `Region ${entityLabelFor(region)}, ${formatBounds(region.bounds)}, records by ${RECORDS_BY[orientationFromDraft(region)]}`;
    const firstError = Object.values(shownErrors(region.id) ?? {})[0];
    if (firstError) {
      text += `, needs attention: ${firstError}`;
      shownInvalidIds.push(region.id);
    }
    if (region.drift?.flagged) text += ", drift detected";
    regionDescriptions[region.id] = text;
  }

  if (!activeSheet) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography color="text.secondary">No sheets available.</Typography>
      </Box>
    );
  }

  if (isInterpreting) {
    return <InterpretingPanelUI />;
  }

  const regionCountBySheet = (sheetId: string) =>
    regions.filter((r) => r.sheetId === sheetId).length;

  // #789: the step is a form around its primary action, so Enter in a field
  // Interprets exactly when the Interpret button could. A field that owns
  // Enter (the bounds inputs) prevents it first.
  const interpretDisabled = regions.length === 0;
  // The disabled default button blocks implicit submission; this also stops
  // a submit that skips it (requestSubmit, assistive tech).
  const submitInterpret = () => {
    if (!interpretDisabled) handleInterpret();
  };

  return (
    <Stack
      component="form"
      noValidate
      ref={rootRef}
      onSubmit={handleOwnSubmit(submitInterpret)}
      onKeyDown={preventToggleEnterSubmit}
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
          onChange={(_e, v) => {
            const nextSheetId = v as string;
            onActiveSheetChange(nextSheetId);
            // Auto-focus a region on the newly-active sheet so the config
            // panel always reflects the tab the user is looking at. If the
            // sheet has no regions, clear the selection to avoid showing a
            // config panel for an off-tab region.
            const firstRegionForSheet = regions.find(
              (r) => r.sheetId === nextSheetId
            );
            onSelectRegion(firstRegionForSheet?.id ?? null);
          }}
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
            regionDescriptions={regionDescriptions}
            invalidRegionIds={shownInvalidIds}
            onSelectionChange={announceSelection}
            onKeyboardHint={announceHint}
            onCornerDraft={() => {
              cornerDraftFromRef.current = selectedRegionId;
            }}
            onRegionResize={handleBoundsChange}
            onSegmentResize={(
              regionId,
              axis,
              segmentIndex,
              newLeft,
              newRight
            ) => {
              const region = regions.find((r) => r.id === regionId);
              if (!region) return;
              const axisSegs = [...(region.segmentsByAxis?.[axis] ?? [])];
              const left = axisSegs[segmentIndex];
              const right = axisSegs[segmentIndex + 1];
              if (!left || !right) return;
              axisSegs[segmentIndex] = resizeSegment(left, newLeft);
              axisSegs[segmentIndex + 1] = resizeSegment(right, newRight);
              onRegionUpdate(regionId, {
                segmentsByAxis: {
                  ...(region.segmentsByAxis ?? {}),
                  [axis]: axisSegs,
                },
              });
            }}
            onRegionUpdate={onRegionUpdate}
            maxHeight={isLargeScreen ? "calc(100vh - 400px)" : 420}
            loadSlice={loadSlice}
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
            entityOptions={entityOptions}
            entityOrder={entityOrder}
            siblingsInSameEntity={siblingsInSameEntity}
            claimedEntityKeys={claimedEntityKeys}
            errors={panelErrors}
            regionSheet={
              selectedRegion
                ? workbook.sheets.find((s) => s.id === selectedRegion.sheetId)
                : undefined
            }
            activeSheet={activeSheet}
            onCreateRegionFromRange={(bounds) =>
              onRegionDraft({ sheetId: activeSheet.id, bounds })
            }
            onUpdate={(updates) => {
              if (!selectedRegion) return;
              // Bounds-carrying updates (from the panel's manual
              // bounds inputs) flow through the same segment-
              // adjustment path as canvas drag-resize, so the
              // trailing segment on each axis stays aligned with
              // the new span no matter where the bounds change
              // originated.
              if (updates.bounds) {
                handleBoundsChange(selectedRegion.id, updates.bounds, updates);
                return;
              }
              onRegionUpdate(selectedRegion.id, updates);
            }}
            onDelete={() => selectedRegion && onRegionDelete(selectedRegion.id)}
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
            onFitToSheet={() => {
              if (!selectedRegion) return;
              const sheet = workbook.sheets.find(
                (s) => s.id === selectedRegion.sheetId
              );
              if (!sheet) return;
              handleBoundsChange(
                selectedRegion.id,
                fitBoundsToSheet(selectedRegion.bounds, sheet)
              );
            }}
            onCreateEntity={onCreateEntity}
            entityAssociationLocked={entityAssociationLocked}
            regionDeletionLocked={regionDeletionLocked}
            validateEntityKey={validateEntityKey}
          />
        </Box>
      </Stack>

      {/* Region changes, the keyboard selection and its hint (#795). */}
      <StatusMessage visuallyHidden message={announcement} />

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
        {onSkipToReview && (
          <Button
            type="button"
            variant="text"
            onClick={onSkipToReview}
            disabled={isInterpreting}
          >
            Skip to review
          </Button>
        )}
        <Button
          type="button"
          variant="contained"
          onClick={handleInterpret}
          disabled={interpretDisabled}
        >
          Interpret
        </Button>
      </Stack>
      <FormDefaultButton disabled={interpretDisabled} />
    </Stack>
  );
};

const InterpretingPanelUI: React.FC = () => (
  <Box
    role="status"
    aria-live="polite"
    aria-busy
    sx={{
      width: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      py: { xs: 8, sm: 12 },
      px: 3,
    }}
  >
    <Stack spacing={2} alignItems="center" sx={{ maxWidth: 420 }}>
      <CircularProgress size={56} />
      <Typography variant="h6" sx={{ fontWeight: 600, textAlign: "center" }}>
        Interpreting your spreadsheet…
      </Typography>
      <Typography variant="body2" color="text.secondary" textAlign="center">
        This can take several seconds to a few minutes depending on how much
        data the interpreter has to analyse. You can safely wait here —
        navigating away will cancel the run.
      </Typography>
    </Stack>
  </Box>
);
