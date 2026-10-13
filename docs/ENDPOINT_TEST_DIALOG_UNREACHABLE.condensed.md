# Endpoint Test dialog is reachable — Condensed design (#780)

**Issue:** [EnterpriseBT/portal-ai#780](https://github.com/EnterpriseBT/portal-ai/issues/780) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Amended after code review: an entity-level read check on the API (Decision 3), and the dialog moves to `components/`.

**Why.** The REST API connector's **Test** button (dry-run a saved endpoint via `POST /:id/test-connection`) is permanently disabled. The create workflow never passes an `instanceId` to `EndpointsStep`, its tooltip says "Save the connector first", saving closes the workflow, and no other surface mounts `EndpointTestDialog`. The fix moves Test to where a saved endpoint lives, the connector's detail page, and removes the dead button from the workflow. The route, the SDK hook (`sdk.connectorInstances.testConnection`) and the dialog already exist. Code review found that the route checked read on the connector but never on the entity, so the fix also touches the API (Decision 3).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Workflow renders the step | `RestApiConnectorWorkflow.component.tsx:229` | `<EndpointsStep …>` with no `instanceId` |
| Test enablement | `EndpointsStep.component.tsx:85` | `canTest = !!instanceId && !!ep.entityId`, so always false; tooltip "Save the connector first to test endpoints" |
| Test wiring in the step | `EndpointsStep.component.tsx:208`, `:239` | `onTest` → `testingIndex` → `EndpointTestDialog` |
| The dialog | `EndpointTestDialog.component.tsx:167` | `EndpointTestDialog({open, instanceId, endpointEntityId, endpointLabel, onClose, onEditEndpoint?})`, exported from the workflow's `index.ts:18`; fires the test on open |
| Detail view entity list | `ConnectorInstance.view.tsx:587` | `<ConnectorEntityCardUI connectorEntity={entity} />` per entity; the only consumer of the card |
| Entity card | `ConnectorEntity.component.tsx:100` | `ConnectorEntityCardUIProps { connectorEntity }`; expanded area holds a "View Records" link |
| Page gates | `utils/connector-instance-actions.util.ts:39` | `connectorInstanceActionGates({capabilities, …})` → `ActionGate`s for the page |
| Endpoint list | `api/api-connector.api.ts` `apiConnector.endpoints.list(instanceId, options)` | `{ endpoints: [{ entity: {id,key,label}, config }] }`, keyed `queryKeys.apiEndpoints.byInstance` |
| Route authz | `connector-instance.router.ts` `/:id/test-connection` | org + `resource.read` on the instance (404 otherwise); read-only, so no job lock |

## Decision 1 — where Test lives: the entity card on the detail page

Options: (a) a **Test endpoint** action in each REST entity's card on the detail page; (b) a separate "Endpoints" section on the detail page; (c) make the workflow reopenable for an existing instance. (c) is a new edit-workflow mode, far bigger than this bug. (b) duplicates the entity list, since every endpoint *is* an entity. **Chosen: (a).** `ConnectorEntityCardUI` gains optional `onTestEndpoint?: () => void` and `testEndpointGate?: ActionGate` props. When `onTestEndpoint` is set, the card renders a `GatedButton` "Test endpoint" beside "View Records". It stays pure UI. The view owns one `EndpointTestDialog` and the selected entity.

Which entities get it: only those backed by an endpoint. "Create Entity" can add an entity with no endpoint to a REST instance, and testing it would only report "not configured". The view runs `apiConnector.endpoints.list(instanceId, { enabled: slug === "rest-api" })` once per page and builds a `Set` of `entity.id`s. That is one bounded query: an instance's endpoints are user-configured rows, the same set the workflow showed. Gate: `decideActionGate({ allowed: entity.capabilities.read })` per card, the check the route now makes (Decision 3). No lock reason, since the route is read-only. If the endpoint list fails to load, every REST entity offers Test (`isTestableEndpointEntity`), since hiding it would recreate this bug. The view keeps the dialog mounted and drives it with `open`, so it fades out and a test still in flight never resolves into an unmounted tree. The dialog moves to `components/EndpointTestDialog.component.tsx` (only the view uses it now), and its never-wired `onEditEndpoint` is removed. On a 404 or 403 the dialog's `FormAlert` shows the error; `onPermissionDenied` already invalidates the instance root.

## Decision 2 — the workflow's Test button is removed

Options: keep it with a corrected tooltip, or remove it. Before saving, the Add endpoint dialog's **Preview response** (probe-endpoint-draft) already dry-runs the draft, so a button that can never work is the #684 bug however it's labelled. **Chosen: remove it.** Delete the Test button, `onTest`/`testingIndex`, the `instanceId` prop and the `EndpointTestDialog` mount from `EndpointsStep`. Also remove the "Preserve the existing entityId…" comment, whose only purpose was keeping Test working. The workflow stays create-only.

## Decision 3 — the API checks read on the endpoint's entity

An endpoint is an entity with its own read permission, but `GET …/api-endpoints`, `GET …/api-endpoints/:entityId` and `POST …/test-connection` checked only connector read. A caller who could read the connector but not an entity could list that endpoint's config and pull its live records. **Chosen:** the list filters to entities the caller can read; the by-id GET answers 404 for an unreadable one; test-connection answers an unreadable endpoint exactly like an absent one (`endpointNotFoundResult`, shared with the adapter), without calling it. Unreadable == absent.

## Plan — one slice (plus the review follow-up)

**Files**
- `apps/web/src/components/ConnectorEntity.component.tsx`: `onTestEndpoint` + `testEndpointGate` on `ConnectorEntityCardUIProps`; `GatedButton` in the expanded actions row, `stopPropagation` like the link.
- `apps/web/src/utils/endpoint-testability.util.ts` (new): `isTestableEndpointEntity`, which includes the list-failed fallback.
- `apps/web/src/components/EndpointTestDialog.component.tsx`: moved from the workflow; `onEditEndpoint` removed.
- API: `routes/api-endpoints.router.ts` (list filter, by-id 404), `routes/connector-instance.router.ts` (test-connection entity check), `adapters/rest-api/rest-api.adapter.ts` (`endpointNotFoundResult`).
- `apps/web/src/views/ConnectorInstance.view.tsx`: endpoint-list query (rest-api only) → `Set` of entity ids; pass `onTestEndpoint` for members; one `EndpointTestDialog`, kept mounted and driven by `open`, with a per-entity gate.
- `apps/web/src/workflows/RestApiConnector/EndpointsStep.component.tsx`: remove the Test button, `onTest`, `instanceId` and the dialog mount.

**Tests**
- New `apps/web/src/__tests__/ConnectorEntityCard.test.tsx`: renders "Test endpoint" only when `onTestEndpoint` is set; click calls it, and the card doesn't toggle; a `disable` gate renders `aria-disabled` with its reason; `hide` renders nothing.
- `apps/web/src/__tests__/endpoint-testability.util.test.ts`: endpoint-backed, no endpoint, list failed, not REST.
- New `apps/api/src/__tests__/__integration__/routes/rest-api-endpoint-entity-read.authorization.integration.test.ts`: a member lists only their readable endpoint, gets 404 for the owner's, and testing the owner's answers like an absent endpoint without fetching; the owner tests either.
- `apps/web/src/workflows/RestApiConnector/__tests__/EndpointsStep.test.tsx`: replace the "Test button" describe with "no Test button in the create workflow"; edit/remove still work.
- `EndpointTestDialog`'s tests move to `apps/web/src/__tests__/` with it; the edit-link cases go.
- `npm run test:unit -- --testPathPattern 'ConnectorEntityCard|connector-instance-actions|EndpointsStep|EndpointTestDialog'` (web), `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. Create a REST API connector with base URL `https://jsonplaceholder.typicode.com` and endpoint `users` (`/users`, ID field `id`). The Endpoints step has **no Test button**, and Add endpoint's **Preview response** still fetches page 1.
2. Commit, then on the detail page expand the **Users** entity → **Test endpoint** appears. Click it → the dialog opens and shows the first 5 records.
3. **Create Entity** on the same instance (no endpoint) → that card has no Test endpoint action.
4. A non-REST connector (Sandbox, a file upload) → no Test endpoint action on any entity.
5. Open **Test endpoint**, close it, open it again → it re-runs and shows fresh results, not the previous run's.

## Out of scope

- The api-endpoints **write** routes (PATCH/DELETE) check write on the connector, not the entity. That's the same class of gap on the write side; it's a follow-up ticket.

- Editing an existing connector's endpoints after creation (a reopenable workflow). That's a feature, not this bug.
- The dialog's `ok: false` rendering, which is unchanged and covered by `EndpointTestDialog`'s tests.
- A Test action on the entity detail page (`/entities/$entityId`). The connector page is where endpoints are listed; add it later if asked.
