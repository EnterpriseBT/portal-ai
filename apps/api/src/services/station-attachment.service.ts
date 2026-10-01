/**
 * #674: a station's data attachments — curated views (`station_views`) and
 * connector instances (`station_instances`).
 *
 * Attaching is an edit to the **station** (the route checks `resource.write`
 * on it); on top of that, every newly attached object must be one the caller
 * can `read`. The request carries the full set of each kind, but the caller
 * only decides about what they can see: existing attachments they can't read
 * are preserved whatever the request says. Writes are a diff (insert the
 * added, soft-delete the removed), never a replace.
 */

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { SystemUtilities } from "../utils/system.util.js";
import { PermissionService } from "./permission.service.js";
import type { PermissionSet } from "./permission-set.js";
import type { DbClient } from "../db/repositories/base.repository.js";
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
   * Bring one attachment kind of a station to the requested set, inside `tx`.
   *
   * Final set = (existing ids the caller can't read) ∪ (requested ids). An
   * existing attachment whose object no longer exists is not preserved: no
   * one can read it, so there's nothing to protect. Only the newly added ids
   * are checked with {@link assertAttachable}, so re-sending an attachment
   * the caller can't read is harmless. Adds use ON CONFLICT DO NOTHING (two
   * concurrent adds leave one live row), removals are soft deletes. Returns
   * the ids actually inserted and soft-deleted.
   */
  static async applyDiff(
    tx: DbClient,
    set: PermissionSet,
    args: {
      stationId: string;
      organizationId: string;
      userId: string;
      kind: StationAttachmentKind;
      requested: string[];
    }
  ): Promise<StationAttachmentDiff> {
    const { stationId, organizationId, userId, kind } = args;
    const requested = unique(args.requested);
    const repo = DbService.repository;

    const existing = unique(
      kind === "curated_view"
        ? (await repo.stationViews.findByStationId(stationId, tx)).map(
            (r) => r.curatedViewId
          )
        : (await repo.stationInstances.findByStationId(stationId, {}, tx)).map(
            (r) => r.connectorInstanceId
          )
    );

    const existingOwners =
      existing.length === 0
        ? []
        : await findOwners(kind, existing, organizationId, tx);
    const hidden = existingOwners
      .filter(
        (o) =>
          !set.can("resource.read", {
            type: kind,
            id: o.id,
            createdBy: o.createdBy,
          })
      )
      .map((o) => o.id);

    const existingSet = new Set(existing);
    const finalSet = new Set([...hidden, ...requested]);
    const toAdd = requested.filter((id) => !existingSet.has(id));
    const toRemove = existing.filter((id) => !finalSet.has(id));

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
      await repo.stationViews.softDeleteByStationAndViews(
        stationId,
        toRemove,
        userId,
        tx
      );
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
      await repo.stationInstances.softDeleteByStationAndInstances(
        stationId,
        toRemove,
        userId,
        tx
      );
    }

    return { added, removed: toRemove };
  }

  /**
   * Apply {@link applyDiff} to each kind present in `ids` (an absent field
   * leaves that kind untouched), inside `tx`. Returns the combined change for
   * the audit event.
   */
  static async applyAll(
    tx: DbClient,
    set: PermissionSet,
    args: { stationId: string; organizationId: string; userId: string },
    ids: StationAttachmentIds
  ): Promise<StationAttachmentChange> {
    const views =
      ids.curatedViewIds === undefined
        ? { added: [], removed: [] }
        : await StationAttachmentService.applyDiff(tx, set, {
            ...args,
            kind: "curated_view",
            requested: ids.curatedViewIds,
          });
    const instances =
      ids.connectorInstanceIds === undefined
        ? { added: [], removed: [] }
        : await StationAttachmentService.applyDiff(tx, set, {
            ...args,
            kind: "connector_instance",
            requested: ids.connectorInstanceIds,
          });
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
    const instances = links.map((l) => ({
      ...l,
      canRead: readable(
        "connector_instance",
        instanceOwners.get(l.connectorInstanceId)
      ),
    })) as unknown as StationInstanceWithConnectorInstance[];

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
