/**
 * The command palette's search (#1076), `GET /api/search`. One permission
 * load per request, then one bounded query per object type, run in turn. Every type is
 * filtered by org, not deleted, and the same `visibilityPredicate` its list
 * route applies, so a search never returns what that list wouldn't (an
 * agreement test holds the two together). Modes:
 *
 * - `q`: name search across every type (an entity also by key), prefix
 *   matches first.
 * - `tag`: objects carrying a readable tag whose name starts with the text.
 * - `refs`: the readable subset of known ids, for Recent's hydration.
 * - none: the caller's favorites.
 */

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import {
  SEARCH_FAVORITES_PER_TYPE_LIMIT,
  SEARCH_MAX_TAGS,
  SEARCH_PER_TYPE_LIMIT,
  SEARCH_RESULT_TYPES,
  parseSearchRefs,
  type SearchRequestQuery,
  type SearchResponsePayload,
  type SearchResult,
  type SearchResultType,
} from "@portalai/core/contracts";
import type { FavoriteTargetType, TagTargetType } from "@portalai/core/models";

import { db } from "../db/client.js";
import {
  connectorEntities,
  connectorInstances,
  curatedViews,
  entityTags,
  portalResults,
  portals,
  stations,
} from "../db/schema/index.js";
import { DbService } from "./db.service.js";
import { FavoriteService } from "./favorite.service.js";
import { TagAssignmentService } from "./tag-assignment.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import type { PermissionSet } from "./permission-set.js";
import { ilikeContains, ilikeStartsWith } from "../utils/filter-sql.util.js";

interface SearchTypeConfig {
  table: PgTable;
  idCol: PgColumn;
  /** The display name, ordered and prefix-ranked on. */
  nameCol: PgColumn;
  /** The columns `q` matches (an entity's label or key). */
  matchCols: PgColumn[];
  createdByCol: PgColumn;
  orgCol: PgColumn;
  deletedCol: PgColumn;
  favoriteType?: FavoriteTargetType;
  tagType?: TagTargetType;
}

/** Column choices follow `RbacObjectSearchService`'s `SEARCH_CONFIG`. */
export const SEARCH_TYPE_CONFIG: Record<SearchResultType, SearchTypeConfig> = {
  station: {
    table: stations,
    idCol: stations.id,
    nameCol: stations.name,
    matchCols: [stations.name],
    createdByCol: stations.createdBy,
    orgCol: stations.organizationId,
    deletedCol: stations.deleted,
    favoriteType: "station",
    tagType: "station",
  },
  pin: {
    table: portalResults,
    idCol: portalResults.id,
    nameCol: portalResults.name,
    matchCols: [portalResults.name],
    createdByCol: portalResults.createdBy,
    orgCol: portalResults.organizationId,
    deletedCol: portalResults.deleted,
    favoriteType: "pin",
    tagType: "pin",
  },
  curated_view: {
    table: curatedViews,
    idCol: curatedViews.id,
    nameCol: curatedViews.label,
    matchCols: [curatedViews.label],
    createdByCol: curatedViews.createdBy,
    orgCol: curatedViews.organizationId,
    deletedCol: curatedViews.deleted,
    favoriteType: "curated_view",
    tagType: "curated_view",
  },
  connector_instance: {
    table: connectorInstances,
    idCol: connectorInstances.id,
    nameCol: connectorInstances.name,
    matchCols: [connectorInstances.name],
    createdByCol: connectorInstances.createdBy,
    orgCol: connectorInstances.organizationId,
    deletedCol: connectorInstances.deleted,
    favoriteType: "connector_instance",
    tagType: "connector_instance",
  },
  entity: {
    table: connectorEntities,
    idCol: connectorEntities.id,
    nameCol: connectorEntities.label,
    matchCols: [connectorEntities.label, connectorEntities.key],
    createdByCol: connectorEntities.createdBy,
    orgCol: connectorEntities.organizationId,
    deletedCol: connectorEntities.deleted,
    tagType: "entity",
  },
  portal: {
    table: portals,
    idCol: portals.id,
    nameCol: portals.name,
    matchCols: [portals.name],
    createdByCol: portals.createdBy,
    orgCol: portals.organizationId,
    deletedCol: portals.deleted,
  },
};

interface Row {
  id: string;
  name: string;
}

export class SearchService {
  static async search(
    ctx: PermissionContext,
    query: SearchRequestQuery
  ): Promise<SearchResponsePayload> {
    const set = await PermissionService.loadSet(ctx);

    if (query.q !== undefined) {
      return {
        results: await SearchService.collect(set, SEARCH_RESULT_TYPES, (type) =>
          SearchService.byName(ctx, set, type, query.q!)
        ),
      };
    }
    if (query.tag !== undefined) {
      return SearchService.byTag(ctx, set, query.tag);
    }
    if (query.refs !== undefined) {
      return { results: await SearchService.byRefs(ctx, set, query.refs) };
    }
    const favoriteTypes = SEARCH_RESULT_TYPES.filter(
      (type) => SEARCH_TYPE_CONFIG[type].favoriteType
    );
    return {
      results: await SearchService.collect(set, favoriteTypes, (type) =>
        SearchService.favorites(ctx, set, type)
      ),
    };
  }

  /** Org, not deleted, and the type's read predicate: every mode's filter. */
  private static baseFilter(
    ctx: PermissionContext,
    set: PermissionSet,
    type: SearchResultType
  ): SQL[] {
    const cfg = SEARCH_TYPE_CONFIG[type];
    const filters: SQL[] = [
      eq(cfg.orgCol, ctx.organizationId),
      isNull(cfg.deletedCol),
    ];
    const visibility = set.visibilityPredicate(type, {
      createdByCol: cfg.createdByCol,
      idCol: cfg.idCol,
    });
    if (visibility) filters.push(visibility);
    return filters;
  }

  private static select(type: SearchResultType, where: SQL[]) {
    const cfg = SEARCH_TYPE_CONFIG[type];
    return db
      .select({ id: cfg.idCol, name: cfg.nameCol })
      .from(cfg.table)
      .where(and(...where));
  }

  private static async byName(
    ctx: PermissionContext,
    set: PermissionSet,
    type: SearchResultType,
    term: string
  ): Promise<Row[]> {
    const cfg = SEARCH_TYPE_CONFIG[type];
    const match = or(...cfg.matchCols.map((col) => ilikeContains(col, term)))!;
    // Prefix matches first, then by name; `id` makes the order total.
    const prefix = sql<boolean>`(${ilikeStartsWith(cfg.nameCol, term)})`;
    return (await SearchService.select(type, [
      ...SearchService.baseFilter(ctx, set, type),
      match,
    ])
      .orderBy(desc(prefix), asc(cfg.nameCol), asc(cfg.idCol))
      .limit(SEARCH_PER_TYPE_LIMIT)) as Row[];
  }

  private static async favorites(
    ctx: PermissionContext,
    set: PermissionSet,
    type: SearchResultType
  ): Promise<Row[]> {
    const cfg = SEARCH_TYPE_CONFIG[type];
    return (await SearchService.select(type, [
      ...SearchService.baseFilter(ctx, set, type),
      FavoriteService.onlyFavorites(ctx, cfg.favoriteType!, cfg.idCol),
    ])
      .orderBy(asc(cfg.nameCol), asc(cfg.idCol))
      .limit(SEARCH_FAVORITES_PER_TYPE_LIMIT)) as Row[];
  }

  private static async byTag(
    ctx: PermissionContext,
    set: PermissionSet,
    text: string
  ): Promise<SearchResponsePayload> {
    const tagFilters: SQL[] = [
      eq(entityTags.organizationId, ctx.organizationId),
      isNull(entityTags.deleted),
      ilikeStartsWith(entityTags.name, text),
    ];
    const tagVisibility = set.visibilityPredicate("tag", {
      createdByCol: entityTags.createdBy,
      idCol: entityTags.id,
    });
    if (tagVisibility) tagFilters.push(tagVisibility);
    const matchedTags = await db
      .select({ id: entityTags.id, name: entityTags.name })
      .from(entityTags)
      .where(and(...tagFilters))
      .orderBy(asc(entityTags.name), asc(entityTags.id))
      .limit(SEARCH_MAX_TAGS);
    if (matchedTags.length === 0) return { results: [], matchedTags: [] };

    const tagIds = matchedTags.map((tag) => tag.id);
    const taggable = SEARCH_RESULT_TYPES.filter(
      (type) => SEARCH_TYPE_CONFIG[type].tagType
    );
    const results = await SearchService.collect(set, taggable, (type) => {
      const cfg = SEARCH_TYPE_CONFIG[type];
      return SearchService.select(type, [
        ...SearchService.baseFilter(ctx, set, type),
        DbService.repository.entityTagAssignments.taggedWithAny(
          cfg.tagType!,
          cfg.idCol,
          tagIds
        ),
      ])
        .orderBy(asc(cfg.nameCol), asc(cfg.idCol))
        .limit(SEARCH_PER_TYPE_LIMIT) as Promise<Row[]>;
    });
    return { results, matchedTags };
  }

  private static async byRefs(
    ctx: PermissionContext,
    set: PermissionSet,
    raw: string
  ): Promise<SearchResult[]> {
    const refs = parseSearchRefs(raw) ?? [];
    const idsByType = new Map<SearchResultType, string[]>();
    for (const ref of refs) {
      idsByType.set(ref.type, [...(idsByType.get(ref.type) ?? []), ref.id]);
    }
    const found = await SearchService.collect(
      set,
      [...idsByType.keys()],
      (type) =>
        SearchService.select(type, [
          ...SearchService.baseFilter(ctx, set, type),
          inArray(SEARCH_TYPE_CONFIG[type].idCol, idsByType.get(type)!),
        ]) as Promise<Row[]>
    );
    const byKey = new Map(found.map((r) => [`${r.type}:${r.id}`, r]));
    return refs.flatMap((ref) => {
      const hit = byKey.get(`${ref.type}:${ref.id}`);
      return hit ? [hit] : [];
    });
  }

  /**
   * Runs one query per type, attaches readable tags, keeps type order. The
   * queries run one after another, never in parallel: the API's 10-connection
   * pool is shared with every route and the workers, so a search holds at
   * most one connection at a time however fast someone types (#1076 code
   * review).
   */
  private static async collect(
    set: PermissionSet,
    types: readonly SearchResultType[],
    query: (type: SearchResultType) => Promise<Row[]>
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    for (const type of types) {
      const rows = await query(type);
      const tagType = SEARCH_TYPE_CONFIG[type].tagType;
      const tags =
        tagType && rows.length > 0
          ? await TagAssignmentService.tagsForTargets(
              set,
              tagType,
              rows.map((r) => r.id)
            )
          : undefined;
      for (const row of rows) {
        results.push({
          type,
          id: row.id,
          name: row.name,
          tags: (tags?.get(row.id) ?? []).map((tag) => ({
            id: tag.id,
            name: tag.name,
            color: tag.color ?? null,
          })),
        });
      }
    }
    return results;
  }
}
