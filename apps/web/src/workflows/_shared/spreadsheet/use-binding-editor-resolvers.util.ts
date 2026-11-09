import { useCallback, useMemo } from "react";

import type { SelectOption } from "@portalai/core/ui";
import type { ColumnDataType } from "@portalai/core/models";

import { sdk } from "../../../api/sdk";
import type {
  ColumnBindingDraft,
  RegionDraft,
} from "../../../modules/RegionEditor";

export interface ColumnDefinitionMeta {
  label: string;
  type: ColumnDataType;
  description: string | null;
}

/**
 * What the review step's binding editor needs from the org (#795): the
 * column-definition catalog and search, the connector-entity search, and
 * the resolvers built from them and the plan's regions. One hook for the
 * three spreadsheet workflows and EditLayoutPlan, so a chip opens the same
 * editor everywhere.
 */
export function useBindingEditorResolvers(regions: RegionDraft[]) {
  // The interpret endpoint returns column bindings keyed by
  // columnDefinitionId, opaque UUIDs; the catalog gives each its label.
  // #414: `listAll` pages to exhaustion, so a definition past the first
  // page still resolves.
  const columnDefinitionsQuery = sdk.columnDefinitions.listAll();
  const columnDefinitionsById = useMemo(() => {
    const map = new Map<string, ColumnDefinitionMeta>();
    for (const cd of columnDefinitionsQuery.data?.columnDefinitions ?? []) {
      map.set(cd.id, {
        label: cd.label,
        type: cd.type as ColumnDataType,
        description: cd.description,
      });
    }
    return map;
  }, [columnDefinitionsQuery.data]);

  const regionsWithResolvedLabels = useMemo(() => {
    if (columnDefinitionsById.size === 0) return regions;
    return regions.map((region) => {
      if (!region.columnBindings || region.columnBindings.length === 0) {
        return region;
      }
      return {
        ...region,
        columnBindings: region.columnBindings.map((binding) => {
          if (!binding.columnDefinitionId) return binding;
          const meta = columnDefinitionsById.get(binding.columnDefinitionId);
          if (!meta) return binding;
          return {
            ...binding,
            columnDefinitionLabel: binding.columnDefinitionLabel ?? meta.label,
            columnDefinitionType: binding.columnDefinitionType ?? meta.type,
          };
        }),
      };
    });
  }, [regions, columnDefinitionsById]);

  // `columnDefinitions.search` populates the rebind picker;
  // `connectorEntities.search` the reference editor's DB targets (staged
  // targets come from `regions`).
  const columnDefinitionSearch = sdk.columnDefinitions.search();
  const connectorEntitySearch = sdk.connectorEntities.search();

  const resolveColumnDefinitionType = useCallback(
    (binding: ColumnBindingDraft): ColumnDataType | undefined => {
      // The catalog, keyed by the current id, wins over the cached type,
      // which drifts when the user swaps definitions in the popover.
      if (binding.columnDefinitionId) {
        const fromCatalog = columnDefinitionsById.get(
          binding.columnDefinitionId
        )?.type;
        if (fromCatalog) return fromCatalog;
      }
      return binding.columnDefinitionType;
    },
    [columnDefinitionsById]
  );

  const resolveColumnDefinitionDescription = useCallback(
    (binding: ColumnBindingDraft): string | null | undefined => {
      if (!binding.columnDefinitionId) return undefined;
      return columnDefinitionsById.get(binding.columnDefinitionId)?.description;
    },
    [columnDefinitionsById]
  );

  const resolveColumnLabel = useCallback(
    (columnDefinitionId: string): string | undefined =>
      columnDefinitionsById.get(columnDefinitionId)?.label,
    [columnDefinitionsById]
  );

  // Reference targets: staged sibling entities first ("this import"), then
  // DB entities from the connector-entity search, with their connector.
  const resolveReferenceOptions = useCallback(
    (currentRegion: RegionDraft): SelectOption[] => {
      const staged = new Map<string, SelectOption>();
      for (const r of regions) {
        if (!r.targetEntityDefinitionId) continue;
        if (r.id === currentRegion.id) continue; // no self-references
        if (staged.has(r.targetEntityDefinitionId)) continue;
        const label = r.targetEntityLabel ?? r.targetEntityDefinitionId;
        staged.set(r.targetEntityDefinitionId, {
          value: r.targetEntityDefinitionId,
          label: `${label} (this import)`,
        });
      }
      const metaMap = connectorEntitySearch.metaMap ?? {};
      const dbOptions = Object.entries(connectorEntitySearch.labelMap).map(
        ([value, label]) => {
          const connectorName = metaMap[value]?.connectorInstanceName;
          const suffix = connectorName
            ? ` (existing · ${connectorName})`
            : " (existing)";
          return { value, label: `${label}${suffix}` };
        }
      );
      const seen = new Set<string>();
      return [...staged.values(), ...dbOptions].filter((opt) => {
        if (seen.has(String(opt.value))) return false;
        seen.add(String(opt.value));
        return true;
      });
    },
    [regions, connectorEntitySearch.labelMap, connectorEntitySearch.metaMap]
  );

  const resolveReferenceFieldOptions = useCallback(
    (
      _region: RegionDraft,
      refEntityKey: string | null | undefined
    ): SelectOption[] => {
      if (!refEntityKey) return [];
      // A staged target's fields come from its region's bindings, as commit
      // reconciles them.
      const stagedRegion = regions.find(
        (r) => r.targetEntityDefinitionId === refEntityKey
      );
      if (!stagedRegion) {
        // A DB target's fields aren't loaded here; commit's reference
        // validation (`LAYOUT_PLAN_INVALID_REFERENCE`) is the safety net.
        return [];
      }
      const seen = new Set<string>();
      const out: SelectOption[] = [];
      for (const b of stagedRegion.columnBindings ?? []) {
        if (b.excluded) continue;
        const key =
          b.normalizedKey ??
          (b.columnDefinitionId
            ? (columnDefinitionsById.get(b.columnDefinitionId)?.label ??
              b.columnDefinitionId)
            : null);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ value: key, label: key });
      }
      return out;
    },
    [regions, columnDefinitionsById]
  );

  return {
    columnDefinitionsById,
    regionsWithResolvedLabels,
    columnDefinitionSearch,
    connectorEntitySearch,
    resolveColumnDefinitionType,
    resolveColumnDefinitionDescription,
    resolveColumnLabel,
    resolveReferenceOptions,
    resolveReferenceFieldOptions,
  };
}
