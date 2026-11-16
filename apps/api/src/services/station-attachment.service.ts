/**
 * #674: a station's data attachments — curated views (`station_views`) and
 * connector instances (`station_instances`).
 *
 * Attaching is an edit to the **station** (`loadWritableStation` checks `resource.write`
 * on it); on top of that, every newly attached object must be one the caller
 * can `read`. An update names what to add and what to remove for each kind,
 * never a full set, and the caller only decides about what they can see: an
 * attachment they can't read is never removed. Writes insert the added and
 * soft-delete the removed, never replace.
 */

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { SystemUtilities } from "../utils/system.util.js";
import { PermissionService } from "./permission.service.js";
import type { PermissionContext } from "./permission.service.js";
import { AuditService } from "./audit.service.js";
import type { PermissionSet } from "./permission-set.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type { StationSelect } from "../db/schema/zod.js";
import type { StationAttachmentCounts } from "@portalai/core/content";
import type { OrgRole } from "@portalai/core/models";
import type {
  StationInstanceWithConnectorInstance,
  StationViewWithCuratedView,
} from "@portalai/core/contracts";

export type StationAttachmentKind = "curated_view" | "connector_instance";

export interface StationAttachmentIds {
  curatedViewIds?: string[];
  connectorInstanceIds?: string[];
}

export interface StationAttachmentDiff {
  added: string[];
  removed: string[];
}

/** The `station.attachments.change` audit metadata (ids only). */
export interface StationAttachmentChange {
  added: { curatedViewIds: string[]; connectorInstanceIds: string[] };
  removed: { curatedViewIds: string[]; connectorInstanceIds: string[] };
}

/**
 * #1036: who an attachment change is recorded against. A plain object so a
 * route (`auditContextFromRequest`) and an agent tool (`AGENT_AUDIT`) both
 * supply one.
 */
export interface AttachmentAuditContext {
  userId: string;
  organizationId: string;
  sourceIp: string | null;
  userAgent: string | null;
  /** #1036: the portal session behind an agent-made change, recorded in the
   *  event's metadata so it can be traced to the session. Absent on routes. */
  sourcePortalId?: string | null;
}

/** #1036: what {@link StationAttachmentService.attachViews} did. */
export interface ViewAttachResult {
  stationId: string;
  added: string[];
  alreadyAttached: string[];
}

/**
 * #1036: one view attached to a station, as {@link
 * StationAttachmentService.listViewsForStations} reports it. A view the caller
 * can't read (or that is gone) carries no id, key or label.
 */
export type StationViewEntry =
  | { id: string; key: string; label: string; canRead: true }
  | { canRead: false; label: null };

/** #1036: what {@link StationAttachmentService.detachViews} did. */
export interface ViewDetachResult {
  stationId: string;
  removed: string[];
  notAttached: string[];
}

const NOT_READABLE_MESSAGE =
  "One or more items can't be attached: they don't exist or you don't have access to them.";

const unique = (ids: string[]): string[] => [...new Set(ids)];

function findOwners(
  kind: StationAttachmentKind,
  ids: string[],
  organizationId: string,
  client: DbClient | undefined
): Promise<{ id: string; createdBy: string }[]> {
  const repo =
    kind === "curated_view"
      ? DbService.repository.curatedViews
      : DbService.repository.connectorInstances;
  return repo.findOwnersByIds(ids, organizationId, client);
}

/** The ids of `ids` that exist in the org and the set grants read on. */
async function readableIds(
  set: PermissionSet,
  kind: StationAttachmentKind,
  ids: string[],
  organizationId: string,
  client: DbClient | undefined
): Promise<Set<string>> {
  const owners = await findOwners(kind, ids, organizationId, client);
  return new Set(
    owners
      .filter((o) =>
        set.can("resource.read", {
          type: kind,
          id: o.id,
          createdBy: o.createdBy,
        })
      )
      .map((o) => o.id)
  );
}

export class StationAttachmentService {
  /**
   * Throws 403 `STATION_ATTACHMENT_NOT_READABLE` unless every id exists in the
   * org and the set grants `resource.read` on it. A missing, cross-org and
   * unreadable id all get the same message, so it never confirms existence.
   */
  static async assertAttachable(
    set: PermissionSet,
    organizationId: string,
    ids: StationAttachmentIds,
    client?: DbClient
  ): Promise<void> {
    const kinds: [StationAttachmentKind, string[] | undefined][] = [
      ["curated_view", ids.curatedViewIds],
      ["connector_instance", ids.connectorInstanceIds],
    ];
    for (const [kind, raw] of kinds) {
      const wanted = unique(raw ?? []);
      if (wanted.length === 0) continue;
      const readable = await readableIds(
        set,
        kind,
        wanted,
        organizationId,
        client
      );
      if (wanted.some((id) => !readable.has(id))) {
        throw new ApiError(
          403,
          ApiCode.STATION_ATTACHMENT_NOT_READABLE,
          NOT_READABLE_MESSAGE
        );
      }
    }
  }

  /**
   * Change one attachment kind of a station by difference, inside `tx`.
   *
   * - `add`: ids not already attached are checked with {@link assertAttachable}
   *   (missing, cross-org or unreadable rejects the whole request) and inserted
   *   with ON CONFLICT DO NOTHING, so two concurrent adds leave one live row.
   *   An already-attached id is a no-op, even one the caller can't read.
   * - `remove`: attached ids the caller can read are soft-deleted. An
   *   attachment the caller can't read is skipped: an editor never detaches
   *   what they can't see. One whose object is gone is removable, since no one
   *   can read it. An unattached id is a no-op.
   *
   * Nothing outside `add` and `remove` is touched. That's the point: a full set
   * read when an edit dialog opened goes stale, and saving it later silently
   * re-attached what another editor had just removed. Returns the ids
   * actually inserted and soft-deleted.
   */
  static async applyChanges(
    tx: DbClient,
    set: PermissionSet,
    args: {
      stationId: string;
      organizationId: string;
      userId: string;
      kind: StationAttachmentKind;
      add: string[];
      remove: string[];
    }
  ): Promise<StationAttachmentDiff> {
    const { stationId, organizationId, userId, kind } = args;
    const repo = DbService.repository;

    const existing = new Set(
      kind === "curated_view"
        ? (await repo.stationViews.findByStationId(stationId, tx)).map(
            (r) => r.curatedViewId
          )
        : (await repo.stationInstances.findByStationId(stationId, {}, tx)).map(
            (r) => r.connectorInstanceId
          )
    );

    const toAdd = unique(args.add).filter((id) => !existing.has(id));
    const removeCandidates = unique(args.remove).filter((id) =>
      existing.has(id)
    );
    const owners = new Map(
      (removeCandidates.length === 0
        ? []
        : await findOwners(kind, removeCandidates, organizationId, tx)
      ).map((o) => [o.id, o])
    );
    const toRemove = removeCandidates.filter((id) => {
      const o = owners.get(id);
      return (
        !o ||
        set.can("resource.read", { type: kind, id, createdBy: o.createdBy })
      );
    });

    const ids: StationAttachmentIds =
      kind === "curated_view"
        ? { curatedViewIds: toAdd }
        : { connectorInstanceIds: toAdd };
    await StationAttachmentService.assertAttachable(
      set,
      organizationId,
      ids,
      tx
    );

    const now = Date.now();
    const base = {
      created: now,
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };

    let added: string[];
    if (kind === "curated_view") {
      const rows = await repo.stationViews.insertManyIgnoreConflicts(
        toAdd.map((curatedViewId) => ({
          ...base,
          id: SystemUtilities.id.v4.generate(),
          organizationId,
          stationId,
          curatedViewId,
        })),
        tx
      );
      added = rows.map((r) => r.curatedViewId);
      if (toRemove.length > 0) {
        await repo.stationViews.softDeleteByStationAndViews(
          stationId,
          toRemove,
          userId,
          tx
        );
      }
    } else {
      const rows = await repo.stationInstances.insertManyIgnoreConflicts(
        toAdd.map((connectorInstanceId) => ({
          ...base,
          id: SystemUtilities.id.v4.generate(),
          stationId,
          connectorInstanceId,
        })),
        tx
      );
      added = rows.map((r) => r.connectorInstanceId);
      if (toRemove.length > 0) {
        await repo.stationInstances.softDeleteByStationAndInstances(
          stationId,
          toRemove,
          userId,
          tx
        );
      }
    }

    return { added, removed: toRemove };
  }

  /**
   * Apply {@link applyChanges} to each kind present in `changes` (an absent
   * kind is untouched), inside `tx`. Create passes its id lists as `add`.
   * Returns the combined change for the audit event.
   */
  static async applyAll(
    tx: DbClient,
    set: PermissionSet,
    args: { stationId: string; organizationId: string; userId: string },
    changes: {
      curatedViews?: { add?: string[]; remove?: string[] };
      connectorInstances?: { add?: string[]; remove?: string[] };
    }
  ): Promise<StationAttachmentChange> {
    const none = { added: [] as string[], removed: [] as string[] };
    const views = changes.curatedViews
      ? await StationAttachmentService.applyChanges(tx, set, {
          ...args,
          kind: "curated_view",
          add: changes.curatedViews.add ?? [],
          remove: changes.curatedViews.remove ?? [],
        })
      : none;
    const instances = changes.connectorInstances
      ? await StationAttachmentService.applyChanges(tx, set, {
          ...args,
          kind: "connector_instance",
          add: changes.connectorInstances.add ?? [],
          remove: changes.connectorInstances.remove ?? [],
        })
      : none;
    return {
      added: {
        curatedViewIds: views.added,
        connectorInstanceIds: instances.added,
      },
      removed: {
        curatedViewIds: views.removed,
        connectorInstanceIds: instances.removed,
      },
    };
  }

  /**
   * #674 / #1036: load the station an attach or detach targets and require
   * `resource.write` on it — attaching is an edit to the station, not to the
   * view. Missing, in another org or unreadable is 404, as the station GET
   * answers; readable without write is the set's 403. Shared by the routes and
   * the agent tools so both refuse identically.
   */
  static async loadWritableStation(
    ctx: PermissionContext,
    stationId: string,
    client?: DbClient
  ): Promise<{ set: PermissionSet; station: StationSelect }> {
    const station = await DbService.repository.stations.findById(
      stationId,
      client
    );
    const set = await PermissionService.loadSet(ctx, client);
    const object = station
      ? { type: "station", id: station.id, createdBy: station.createdBy }
      : undefined;
    if (
      !station ||
      station.organizationId !== ctx.organizationId ||
      !set.can("resource.read", object)
    ) {
      throw new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found");
    }
    set.check("resource.write", object);
    return { set, station };
  }

  /**
   * #1036: attach views to a station, all or nothing. Every requested view
   * must be readable (already-attached ones included, as the single-view route
   * always checked), or nothing is written. New links insert in one
   * transaction with ON CONFLICT DO NOTHING; what was already attached is
   * reported, not refused. The audit event records only what was added.
   */
  static async attachViews(
    ctx: PermissionContext,
    args: { stationId: string; curatedViewIds: string[] },
    audit: AttachmentAuditContext
  ): Promise<ViewAttachResult> {
    const { stationId } = args;
    const { organizationId, userId } = ctx;
    const ids = unique(args.curatedViewIds);
    const result = await DbService.transaction(async (tx) => {
      const { set } = await StationAttachmentService.loadWritableStation(
        ctx,
        stationId,
        tx
      );
      await StationAttachmentService.assertAttachable(
        set,
        organizationId,
        { curatedViewIds: ids },
        tx
      );
      const existing = new Set(
        (
          await DbService.repository.stationViews.findByStationId(stationId, tx)
        ).map((r) => r.curatedViewId)
      );
      const toAdd = ids.filter((id) => !existing.has(id));
      const now = Date.now();
      const rows =
        await DbService.repository.stationViews.insertManyIgnoreConflicts(
          toAdd.map((curatedViewId) => ({
            id: SystemUtilities.id.v4.generate(),
            created: now,
            createdBy: userId,
            updated: null,
            updatedBy: null,
            deleted: null,
            deletedBy: null,
            organizationId,
            stationId,
            curatedViewId,
          })),
          tx
        );
      const added = rows.map((r) => r.curatedViewId);
      const addedSet = new Set(added);
      return {
        stationId,
        added,
        // A concurrent attach of the same view lost the insert race: it is
        // attached all the same.
        alreadyAttached: ids.filter((id) => !addedSet.has(id)),
      };
    });
    await StationAttachmentService.auditViewChange(audit, stationId, {
      added: result.added,
      removed: [],
    });
    return result;
  }

  /**
   * #1036: detach views from a station with station write alone (#674:
   * detaching edits the station, so the view needn't be readable). An id that
   * isn't attached is reported, not refused. Audits only what was removed.
   */
  static async detachViews(
    ctx: PermissionContext,
    args: { stationId: string; curatedViewIds: string[] },
    audit: AttachmentAuditContext
  ): Promise<ViewDetachResult> {
    const { stationId } = args;
    const ids = unique(args.curatedViewIds);
    const result = await DbService.transaction(async (tx) => {
      await StationAttachmentService.loadWritableStation(ctx, stationId, tx);
      // What the delete itself removed, not a read before it: a concurrent
      // detach of the same link removes it once and is reported (and
      // audited) once.
      const removed =
        await DbService.repository.stationViews.softDeleteByStationAndViews(
          stationId,
          ids,
          ctx.userId,
          tx
        );
      const removedSet = new Set(removed);
      return {
        stationId,
        removed,
        notAttached: ids.filter((id) => !removedSet.has(id)),
      };
    });
    await StationAttachmentService.auditViewChange(audit, stationId, {
      added: [],
      removed: result.removed,
    });
    return result;
  }

  /**
   * #1036: the views attached to each of `stationIds`, in two batched reads
   * (links, then view summaries) however many stations there are. A view the
   * caller can't read, or one that's gone, is reported without its id, key or
   * label: unlike the station page's chips, this feeds the agent, whose answer
   * can travel further than the user who asked.
   */
  static async listViewsForStations(
    set: PermissionSet,
    organizationId: string,
    stationIds: string[],
    client?: DbClient
  ): Promise<Map<string, StationViewEntry[]>> {
    const byStation = new Map<string, StationViewEntry[]>(
      stationIds.map((id) => [id, []])
    );
    if (stationIds.length === 0) return byStation;
    const repo = DbService.repository;
    const links = await repo.stationViews.findByStationIds(stationIds, client);
    const summaries = new Map(
      (
        await repo.curatedViews.findSummariesByIds(
          unique(links.map((l) => l.curatedViewId)),
          organizationId,
          client
        )
      ).map((v) => [v.id, v])
    );
    for (const link of links) {
      const v = summaries.get(link.curatedViewId);
      const readable =
        !!v &&
        set.can("resource.read", {
          type: "curated_view",
          id: v.id,
          createdBy: v.createdBy,
        });
      byStation
        .get(link.stationId)
        ?.push(
          readable
            ? { id: v.id, key: v.key, label: v.label, canRead: true }
            : { canRead: false, label: null }
        );
    }
    return byStation;
  }

  /** The `station.attachments.change` event for views (post-commit, fail-open). */
  private static async auditViewChange(
    audit: AttachmentAuditContext,
    stationId: string,
    change: { added: string[]; removed: string[] }
  ): Promise<void> {
    if (change.added.length === 0 && change.removed.length === 0) return;
    const { sourcePortalId, ...actor } = audit;
    await AuditService.record({
      ...actor,
      action: "station.attachments.change",
      targetType: "station",
      targetId: stationId,
      metadata: {
        added: { curatedViewIds: change.added, connectorInstanceIds: [] },
        removed: { curatedViewIds: change.removed, connectorInstanceIds: [] },
        ...(sourcePortalId ? { sourcePortalId } : {}),
      },
    });
  }

  /** Whether a change added or removed anything (an empty one isn't audited). */
  static hasChanges(change: StationAttachmentChange): boolean {
    return [change.added, change.removed].some(
      (side) =>
        side.curatedViewIds.length > 0 || side.connectorInstanceIds.length > 0
    );
  }

  /**
   * Every live attachment of a station, readable or not, each with `canRead`.
   * One batched object read per kind and one permission set, so it never loads
   * permissions per row. An attachment whose object is gone reads as
   * `canRead: false`. With `include=curatedView` the views are returned too,
   * labelled even when unreadable (the chip shows the real name); with
   * `include=connectorInstance` each instance carries its connector.
   */
  static async listForStation(
    set: PermissionSet,
    args: { stationId: string; organizationId: string },
    opts: { include: string[] },
    client?: DbClient
  ): Promise<{
    instances: StationInstanceWithConnectorInstance[];
    views?: StationViewWithCuratedView[];
  }> {
    const { stationId, organizationId } = args;
    const repo = DbService.repository;
    const readable = (
      type: StationAttachmentKind,
      o: { id: string; createdBy: string } | undefined
    ): boolean =>
      !!o &&
      set.can("resource.read", { type, id: o.id, createdBy: o.createdBy });

    const links = await repo.stationInstances.findByStationId(
      stationId,
      { include: opts.include },
      client
    );
    const instanceOwners = new Map(
      (
        await findOwners(
          "connector_instance",
          unique(links.map((l) => l.connectorInstanceId)),
          organizationId,
          client
        )
      ).map((o) => [o.id, o])
    );
    const instances = links.map((l) => {
      const canRead = readable(
        "connector_instance",
        instanceOwners.get(l.connectorInstanceId)
      );
      const { connectorInstance, ...link } = l;
      if (!connectorInstance) return { ...link, canRead };
      // Credentials never leave in this payload. An unreadable connector
      // keeps only what the locked chip shows: its id and name.
      const { credentials: _omit, ...withoutCredentials } = connectorInstance;
      return {
        ...link,
        connectorInstance: canRead
          ? withoutCredentials
          : { id: connectorInstance.id, name: connectorInstance.name },
        canRead,
      };
    }) as unknown as StationInstanceWithConnectorInstance[];

    if (!opts.include.includes("curatedView")) return { instances };

    const viewLinks = await repo.stationViews.findByStationId(
      stationId,
      client
    );
    const summaries = new Map(
      (
        await repo.curatedViews.findSummariesByIds(
          unique(viewLinks.map((l) => l.curatedViewId)),
          organizationId,
          client
        )
      ).map((v) => [v.id, v])
    );
    const views = viewLinks.map((l) => {
      const summary = summaries.get(l.curatedViewId);
      return {
        ...l,
        curatedView: summary
          ? {
              id: summary.id,
              key: summary.key,
              label: summary.label,
              connectorEntityId: summary.connectorEntityId,
            }
          : undefined,
        canRead: readable("curated_view", summary),
      };
    }) as unknown as StationViewWithCuratedView[];

    return { instances, views };
  }

  /**
   * The attachment counts the empty-station copy needs, for one caller: how
   * many views and connectors are attached (the same for everyone) and how
   * many of them this caller can read. Feeds the system prompt and
   * platform_help through `describeStationAttachmentGaps`.
   */
  static async countsForCaller(
    stationId: string,
    organizationId: string,
    userId: string
  ): Promise<StationAttachmentCounts> {
    const roles = (await DbService.repository.userRole.findEffectiveRoleNames(
      userId,
      organizationId
    )) as OrgRole[];
    const set = await PermissionService.loadSet({
      userId,
      organizationId,
      roles,
    });
    const { instances, views = [] } =
      await StationAttachmentService.listForStation(
        set,
        { stationId, organizationId },
        { include: ["curatedView"] }
      );
    const tally = (rows: { canRead: boolean }[]) => ({
      attached: rows.length,
      readable: rows.filter((r) => r.canRead).length,
    });
    return { views: tally(views), connectors: tally(instances) };
  }
}
