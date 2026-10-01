# Station view attachments + empty-station warnings — Spec

**Issue:** [EnterpriseBT/portal-ai#674](https://github.com/EnterpriseBT/portal-ai/issues/674) · **Discovery:** `docs/STATION_VIEW_ATTACHMENTS.discovery.md`

Pins the contract for making curated views a first-class station attachment beside connector instances:
- one permission rule for attaching;
- server-preserved unreadable attachments;
- atomic, audited attachment writes;
- attachment lists with per-item readability and no-access chips;
- station-level empty warnings;
- the agent's empty-station situations.

## Key decisions (flag for review)

1. **One attach rule, every endpoint.** Attaching or detaching is an edit **to the station**: `resource.write` on the station, plus `resource.read` on each attached curated view or connector instance. `write` on the view is irrelevant. It applies to station create/update and to the standalone `POST`/`DELETE /api/curated-views/:id/attach`.
2. **Full-set contract, server-preserved.** Create/update take `curatedViewIds` beside `connectorInstanceIds`, both as full sets. On update, the server keeps every existing attachment the caller can't read, whatever the request says, and writes only the difference.
3. **Atomic and fail-closed.** The station row, toolpacks and both attachment diffs run in one `DbService.transaction`. Any requested id that's missing, in another org or unreadable rejects the whole request with 403 `STATION_ATTACHMENT_NOT_READABLE`, with nothing written. That code doesn't reveal which id failed or whether it exists.
4. **Show, don't filter.** The station GET returns **every** attachment, each with a server-computed `canRead`. Unreadable ones render by their real name as a shared **no-access chip**. The warnings key on the full lists, so they're the same for every user.
5. **One shared copy function for every empty-station message.** `describeStationAttachmentGaps` (core) returns the "missing" and "no access" sentences, and the web alerts, system prompt and `platform_help` all render from it.
   - **Missing:** when **neither** views nor connectors are attached, one combined message says both are missing. Otherwise it names whichever one is missing.
   - **Neither gates data access:** views give view-scoped data, while connectors give entity data through the entity-management toolpack. So a missing view isn't reported as "no data".
   - **`platform_help`:** its connector-based `no_entities` becomes `attachments_missing` and `attachments_inaccessible`.
6. **Audit and lifecycle.** Every attachment change emits `station.attachments.change`. Station delete soft-deletes its `station_views` and `station_instances`. Attachment removal is a soft delete, never a hard delete.

## Scope

### In scope
- **Core:** contracts (`station.contract.ts`), plus a new audit action.
- **API:** station create/update/GET/delete, the curated-view attach/detach routes, the attachment repositories, `ApiCode`, audit, `buildStationContext`, the system prompt and `platform_help`.
- **Web:** both station dialogs (a view picker), the station detail page, the portal header, a shared no-access chip, the SDK and query keys.
- **Docs:** the glossary, FAQ and getting-started text.

### Out of scope
- Moving `ConnectorInstancePicker` to an async select (it predates this, and is a separate ticket).
- An agent tool for attaching (#645).
- View sharing or grants.
- Any bulk attach-by-connector.
- An operator CLI path (the PRD waives it as N/A).

## Surface

### `packages/core/src/contracts/station.contract.ts`

```ts
CreateStationBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  connectorInstanceIds: z.array(z.string()).optional(),
  curatedViewIds: z.array(z.string()).optional(),          // NEW
  toolPacks: z.array(z.string()).min(1).optional(),
});
UpdateStationBodySchema = z.object({ /* same four + */ curatedViewIds: z.array(z.string()).optional() })
  .refine(/* at least one field */);                        // refine unchanged; curatedViewIds counts

/** NEW — an attached curated view, with the caller's readability. */
StationViewWithCuratedViewSchema = StationViewSchema.extend({
  curatedView: CuratedViewSchema.pick({ id: true, key: true, label: true, connectorEntityId: true }).optional(),
  canRead: z.boolean(),
});
/** CHANGED — gains canRead. */
StationInstanceWithConnectorInstanceSchema = StationInstanceSchema.extend({
  connectorInstance: ConnectorInstanceSchema.optional(),
  canRead: z.boolean(),                                     // NEW
});
StationGetResponsePayloadSchema.station = StationWithToolpacksSchema.extend({
  instances: z.array(StationInstanceWithConnectorInstanceSchema).optional(),
  views: z.array(StationViewWithCuratedViewSchema).optional(),   // NEW (include=curatedView)
});
```

- **Ids:** both id arrays are de-duplicated server-side; duplicates aren't an error.
- **Readability in the GET:** `canRead` is always present on every returned row.
- **Unreadable rows:** the joined `curatedView` / `connectorInstance` is still returned, because the chip shows the real name. Only `id`, `key` / `name` and `label` are needed for that. The full `ConnectorInstanceSchema` join already exists, and its credentials are never in the schema.

### `packages/core/src/models/audit-log.model.ts`

- **`AUDIT_ACTIONS`:** gains `"station.attachments.change"`. The column is `text` with a Drizzle enum and has no `CHECK` (`0096` checks only `outcome`), so **no migration**.
- **Metadata shape:**

  ```ts
  { added: { curatedViewIds: string[]; connectorInstanceIds: string[] },
    removed: { curatedViewIds: string[]; connectorInstanceIds: string[] } }
  ```

  It carries ids only; `targetType: "station"` and `targetId` is the station id. It's emitted post-commit and fail-open, like `connector.credential.create` (`connector-instance.router.ts:830`), and only when something actually changed.

### `apps/api/src/constants/api-codes.constants.ts`

- **New:** `STATION_ATTACHMENT_NOT_READABLE` (403): "One or more items can't be attached: they don't exist or you don't have access to them."
- **Why one code:** it covers missing, cross-org and unreadable ids alike, so it never confirms existence.

### `apps/api/src/services/station-attachment.service.ts` (NEW)

A class with static methods (the API style guide):

```ts
export class StationAttachmentService {
  /** Throws STATION_ATTACHMENT_NOT_READABLE unless every id exists in the org and the set grants resource.read on it. */
  static async assertAttachable(
    set: PermissionSet, organizationId: string,
    ids: { curatedViewIds?: string[]; connectorInstanceIds?: string[] },
    client?: DbClient
  ): Promise<void>;

  /** Final set = (existing ids the caller can't read) ∪ (requested ids). Asserts the added ids are attachable, inserts them with
   *  ON CONFLICT DO NOTHING (restating WHERE deleted IS NULL), soft-deletes removed. Returns the diff. */
  static async applyDiff(
    tx: DbClient, set: PermissionSet,
    args: { stationId: string; organizationId: string; userId: string;
            kind: "curated_view" | "connector_instance"; requested: string[] }
  ): Promise<{ added: string[]; removed: string[] }>;

  /** Every attachment of a station with canRead; one batched object read per kind, no per-row permission loads. */
  static async listForStation(
    set: PermissionSet, stationId: string, opts: { include: string[] }
  ): Promise<{ instances: StationInstanceWithConnectorInstance[]; views: StationViewWithCuratedView[] }>;
}
```

- **`canRead`:** `set.can("resource.read", { type: "curated_view" | "connector_instance", id, createdBy })`.
- **Dangling attachments:** an existing attachment whose object no longer exists isn't preserved. No one can read it, so a full-set update drops it.
- **Diff inside the transaction:** `applyDiff` reads the current rows **inside** `tx`, so two concurrent editors can't duplicate or lose an attachment. The partial unique indexes (`station_views_station_view_unique`, and `station_instances`' equivalent) are the backstop.

### Repositories

- `station-views.repository.ts` gains `insertManyIgnoreConflicts(rows, client)` and `softDeleteByStationAndViews(stationId, viewIds, userId, client)`. It keeps `findByStationId`.
- `station-instances.repository.ts` gains the same two methods, keyed on `connectorInstanceIds`. **The update path stops calling `hardDelete`.**

### `apps/api/src/routes/station.router.ts`

- **`POST /`:**
  1. After the existing `resource.write` check (`:462`), call `PermissionService.loadSet(ctx)` once.
  2. In one `DbService.transaction`: create the station, set its toolpacks, then `applyDiff` for both kinds (with empty `existing`).
  3. `applyDiff` calls `assertAttachable` on the ids it is about to **add** (requested minus already attached), inside the transaction. A refusal throws and rolls everything back, so no station row is left. Checking only additions means re-sending an existing attachment the caller can't read is harmless.
  4. Post-commit, emit `station.attachments.change` if anything was added.
- **`PATCH /:id`:** the same as `POST`, but each `applyDiff` runs only for a field present in the body. The toolpack logic is unchanged and moves inside the transaction.
- **`GET /:id`:** `include` gains `curatedView`. The response sets `station.instances` and `station.views` (when included) from `listForStation`. `canShare` / `canWrite` / `canDelete` are unchanged.
- **`DELETE /:id`:** the existing transaction (`:873`) also soft-deletes the station's `station_views` and `station_instances`.
- **`@openapi`:** update the request bodies and the GET response. Register `StationViewWithCuratedView` in `swagger.config.ts`, and add the 403 `STATION_ATTACHMENT_NOT_READABLE` response.

### `apps/api/src/routes/curated-view.router.ts`

- **`POST /:id/attach` (`:688`):**
  - **Requires:** `resource.write` on the **station** (404 if it's missing or not readable, as the station GET does) and `resource.read` on the **view** (the 403 code above).
  - **No longer requires:** `resource.write` on the view.
  - **Insert:** uses `insertManyIgnoreConflicts`.
  - **Audit:** emits `station.attachments.change`.
- **`DELETE /:id/attach/:stationId` (`:778`):** requires `resource.write` on the station, then soft-deletes. Read on the view isn't required to detach: the caller holds `edit` on the station. It emits the audit event.

### Agent-facing

- **`StationContext`** (`system.prompt.ts:37`) gains:

  ```ts
  attachments: {
    views: { attached: number; readable: number };
    connectors: { attached: number; readable: number };
  }
  ```

  It's filled by `buildStationContext` (`portal.service.ts:1190`) from `StationAttachmentService.listForStation`.
- **`packages/core/src/content/station-attachments.util.ts` (NEW):**

  ```ts
  export interface StationAttachmentCounts {
    views: { attached: number; readable: number };
    connectors: { attached: number; readable: number };
  }
  /** The single source of every empty-station sentence (UI alerts, system prompt, platform_help). */
  export function describeStationAttachmentGaps(c: StationAttachmentCounts): {
    missing: string | null;   // station-level: identical for every user
    noAccess: string | null;  // per-caller: among the kinds that ARE attached
  };
  ```

  - **`missing`:**
    - views 0 and connectors 0 → "No views or connectors are attached to this station yet."
    - views 0 only → "No views are attached to this station yet."
    - connectors 0 only → "No connectors are attached to this station yet."
    - else `null`.
  - **`noAccess`**, considering only the kinds with `attached > 0`:
    - both with `readable === 0` → "You don't have access to any views or connectors on this station."
    - views only → "You don't have access to any views on this station."
    - connectors only → "You don't have access to any connectors on this station."
    - else `null`.
- **`buildSystemPrompt`** (`:624`) replaces "_No entities attached to this station yet._":
  - it emits `missing` and `noAccess` (italicised) when non-null;
  - it then lists entities as today when there are any.
- **`platform_help`** (`platform-help.tool.ts:44-213`):
  - **`Situation`** becomes `no_packs | attachments_missing | attachments_inaccessible | no_records | unentitled_packs | default`. `no_entities` is removed.
  - **Match order:** unavailable → `no_packs` → `attachments_missing` → `attachments_inaccessible` → `no_records` → `unentitled_packs` → `default`.
  - **Data source:** `gatherFindings` takes the counts from `listForStation`.
  - **Prose:** the prose for both attachment situations is the function's sentence, plus "Ask someone who can edit the station to attach them." for `attachments_missing"

### Web (`apps/web/src`)

- **`components/AttachmentChip.component.tsx` (NEW, pure UI):** `AttachmentChipUI({ kind: "connector" | "view", label, canRead })`.
  - **Readable:** today's outlined `primary` chip (Memory icon for connectors, a view icon for views).
  - **Unreadable:** `color="error"`, `variant="outlined"`, a `LockOutlined` icon, `Tooltip` "You don't have access to this view" / "…this connector", `aria-label` with the same text, and not clickable.
- **`components/CuratedViewPicker.component.tsx` (NEW, container + UI):** `CuratedViewPicker({ selected, onChange, selectedLabels })` wraps `MultiAsyncSearchableSelect`.
  - **Options:** `sdk.curatedViews.list({ search, limit: 20 })`, server-filtered by visibility.
  - **Chip labels for already-selected ids:** taken from `selectedLabels`.
  - **Props:** the UI component receives `fetchOptions` and the same props.
- **`CreateStationDialog`:** adds the view picker after `ConnectorInstancePicker` (`:316`) and sends `curatedViewIds` when non-empty. When none are picked, a non-blocking `helperText` reads: "No views selected — this station won't have data to query until a view is attached."
- **`EditStationDialog`:**
  - **Seeding:** both pickers seed **only from `canRead` rows** of `station.instances` / `station.views` (fetched with `include=connectorInstance,curatedView`).
  - **Diff and send:** the sorted readable sets are compared as today (`:186-189`), and the full readable set is sent. The server preserves the rest.
- **`components/StationAttachmentAlerts.component.tsx` (NEW, pure UI):** `StationAttachmentAlertsUI({ viewCount, connectorCount })` renders **one** `Alert severity="warning"` with `describeStationAttachmentGaps(...).missing`, or nothing. A combined sentence covers both missing, and a single one covers either. Station-level, so it's the same for every user. Unreadable attachments show as no-access chips, not as an alert.
- **`StationDetail.view.tsx`:**
  - **Fetch:** `include: "connectorInstance,curatedView"`.
  - **Chips:** a "Views" row beside "Connectors", both using `AttachmentChipUI`. Rows are no longer hidden when empty: they show `—`, and the alert says why.
  - **Alerts:** `StationAttachmentAlertsUI` replaces the `:300-305` alert.
- **`Portal.view.tsx` (`PortalHeaderMeta`):** the same include, both rows, chips and alerts.
- **SDK and keys:** `stations.get` accepts the new include. Station create/update and curated-view attach/detach `onSuccess` invalidate `stations.root` and `curatedViews.root`.

### Help content

- **`glossary.util.ts`:** a new **Curated View** term. Its definition is a named, filtered window onto an entity's columns and rows; it's attached to stations, and it's what users with `read` on it can query. Related: Station, Connector Instance. Also, "Station" (`:239-246`) mentions views.
- **`faq.util.ts`:** add views at `:55-57`, and a views clause at `:261-263` ("check that it has a view attached and shared with you").
- **`getting-started.util.ts:31-35`:** "Create a station — bundle connector instances, views and tool packs…".
- **Route map:** update `utils/glossary-routes.util.ts` if the term needs a route.

## Migration

**None.** `station_views` and `station_instances` already exist, with partial unique indexes and soft delete. The audit `action` column has no `CHECK`.

## Seed

**None.**

## TDD test plan

Run from each package: `npm run test:unit`, and `npm run test:integration -- --testPathPattern …` (api).

### core: `packages/core/src/__tests__/contracts/station.contract.test.ts`
1. Create and Update accept `curatedViewIds`, and the Update refine counts it.
2. The GET payload requires `canRead` on instances and views.
3. `AuditActionSchema` accepts `station.attachments.change`.

### api unit: `apps/api/src/__tests__/services/station-attachment.service.test.ts` (mocked repos and set)
4. `assertAttachable` throws `STATION_ATTACHMENT_NOT_READABLE` for a missing id, a cross-org id and an unreadable id, with the **same message** for each. It passes when all are readable.
5. `applyDiff` computes added and removed. It preserves existing unreadable ids even when they're omitted from the request. It de-dupes.

### api integration: `apps/api/src/__tests__/__integration__/routes/station-attachments.router.integration.test.ts` (NEW)
6. Create with readable views and connectors attaches both, and emits one audit event with the ids.
7. Create naming an unreadable view returns 403 and writes **no** station.
8. Update with `curatedViewIds` alone leaves connectors untouched, and vice versa.
9. Update removing a readable view soft-deletes that row (`deleted` set, not hard-deleted). Re-attaching it creates a new live row.
10. **Preservation:** user A attaches views V1 (readable to A only) and V2. User B, with edit on the station and read only on V2, sends `curatedViewIds: []`. Result: V1 is still attached and V2 is detached.
11. **Concurrency:** two concurrent updates adding the same view leave exactly one live row.
12. **GET with `include=curatedView,connectorInstance`:** returns every attachment, with `canRead` false for an unreadable one, and its label present.
13. A caller without `resource.write` on the station gets 403 from update, and nothing changes.
14. Station delete soft-deletes its views and instances.
15. **Attach route:** station `edit` plus view `read` returns 201. View `write` without station `edit` returns 403. Detach with station `edit` works.

### api unit: agent text
16. `packages/core/src/__tests__/content/station-attachments.util.test.ts`: all `missing` cases (both, views only, connectors only, none) and all `noAccess` cases (both, views only, connectors only, none). An unattached kind is never reported as no-access.
17. `system.prompt.test.ts`: emits the function's sentences (both missing; views missing with connectors present; no access) and lists entities otherwise. `platform-help.tool.test.ts`: the `attachments_missing` / `attachments_inaccessible` order and prose, replacing the `no_entities` case.

### web: `apps/web/src/__tests__/`
18. `AttachmentChip.test.tsx`: the readable chip renders its label. The unreadable chip has the error colour, the lock icon, the tooltip and aria-label text, and isn't clickable.
19. `CuratedViewPicker.test.tsx` (UI): async options load from the injected fetcher, selection calls `onChange`, and selected labels render.
20. `CreateStationDialog.test.tsx`: picking views sends `curatedViewIds`; with none picked, the helper hint shows; the form schema is unchanged otherwise.
21. `EditStationDialog.test.tsx`: it seeds from `canRead` rows only, sends the readable set when changed, and makes no call when unchanged.
22. `StationAttachmentAlerts.test.tsx`: both missing gives **one** combined alert; views only and connectors only each give their alert; neither gives none.
23. `Portal.view.test.tsx` (existing) and a new `StationDetail.view.test.tsx`: Views and Connectors rows with no-access chips, and the alerts render from the payload.
24. `StationDialogCollisions.test.tsx`: add the `sdk.curatedViews.list` mock.

### docs pinning
25. `packages/core/src/__tests__/content/glossary.util.test.ts` / `faq.util.test.ts`, plus `apps/web/src/__tests__/glossary-routes.util.test.ts`: the Curated View term exists with its related terms and route, and the FAQ views clauses are present.

**Totals ≈ 25 groups, about 75 cases.** No migration test is needed.

## Acceptance criteria

- [ ] **Pickers:** create and edit offer a view picker of exactly the views the user can read, independent of connectors, next to the connector picker. Saving attaches and detaches views and connectors independently.
- [ ] **Permissions:** only a user with `edit` on the station can change attachments, and only to objects they can read, whichever endpoint they use. `write` on a view never grants attach.
- [ ] **Fail-closed:** a request naming an unreadable or missing object is rejected with nothing written, and the error doesn't reveal which id failed.
- [ ] **Preservation:** saving never detaches an attachment the editing user can't read.
- [ ] **Chips:** the station detail page and portal header show every attachment. Unreadable ones render as no-access chips, by name, with the error outline, the lock and the tooltip.
- [ ] **Warnings:** both surfaces show one warning: a combined one when neither views nor connectors are attached, otherwise one naming whichever is missing. It's the same for every user.
- [ ] **Agent:** the system prompt and `platform_help` use the same sentences as the UI: "No views or connectors are attached to this station yet." when both are missing, otherwise the one that's missing. "You don't have access to any views/connectors on this station." covers attached kinds the user can't read.
- [ ] **Audit and lifecycle:** each attachment change is audited with ids. Removals and station delete soft-delete. Re-attaching never duplicates.
- [ ] **Docs:** the glossary, FAQ and getting-started text mention views.

## Risks & rollback

- **Changed behaviour on the attach routes:** a view author without station `edit` can no longer attach. This is intended. There's no web caller, but an API script could break; it's noted in the PR.
- **Station update semantics:** connector links move from hard-delete-replace to diff with soft delete. Detection: tests 8–11. Old hard-deleted rows are unaffected.
- **Fail mode:** closed for permissions (whole-request 403) and open for audit (a post-commit failure only logs). That's the right trade: an attach can't slip through, and a lost audit row never blocks a save.
- **Performance:** one `loadSet` per request, and one batched object read per kind for `canRead`.
- **Rollback:** revert the PR. There's no schema change, and existing attachment rows stay valid.

## Files touched

- **core:** `contracts/station.contract.ts`, `models/audit-log.model.ts`, `content/station-attachments.util.ts` (new), `content/glossary.util.ts`, `content/faq.util.ts`, plus tests.
- **api:**
  - **New:** `services/station-attachment.service.ts`, and `__integration__/routes/station-attachments.router.integration.test.ts`.
  - **Edit:**
    - `routes/station.router.ts`, `routes/curated-view.router.ts`;
    - `db/repositories/station-views.repository.ts`, `db/repositories/station-instances.repository.ts`;
    - `constants/api-codes.constants.ts`, `config/swagger.config.ts`;
    - `services/portal.service.ts` (`buildStationContext`), `prompts/system.prompt.ts`, `tools/platform-help.tool.ts`;
    - tests.
- **web:**
  - **New:** `components/AttachmentChip.component.tsx`, `components/CuratedViewPicker.component.tsx`, `components/StationAttachmentAlerts.component.tsx`, plus tests and stories.
  - **Edit:**
    - `components/CreateStationDialog.component.tsx`, `components/EditStationDialog.component.tsx`;
    - `views/StationDetail.view.tsx`, `views/Portal.view.tsx`;
    - `api/stations.api.ts` (include), `utils/getting-started.util.ts`, `utils/glossary-routes.util.ts` (if needed);
    - the related tests.

## Next step

`docs/STATION_VIEW_ATTACHMENTS.plan.md` sequences this as about six TDD slices on this branch:
1. core contracts + audit action + `ApiCode` + `describeStationAttachmentGaps`;
2. `StationAttachmentService` + repos + the station create/update/delete write path;
3. GET `listForStation` + realigning the attach/detach routes;
4. agent-facing situations;
5. web chips, alerts and pickers in the dialogs;
6. the detail and portal surfaces, plus help content.
