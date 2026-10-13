# Endpoint Test dialog is reachable — Condensed design (#780)

**Issue:** [EnterpriseBT/portal-ai#780](https://github.com/EnterpriseBT/portal-ai/issues/780) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The REST API connector's **Test** button (dry-run a saved endpoint via `POST /:id/test-connection`) is permanently disabled. The create workflow never passes an `instanceId` to `EndpointsStep`, its tooltip says "Save the connector first", saving closes the workflow, and no other surface mounts `EndpointTestDialog`. The fix moves Test to where a saved endpoint lives, the connector's detail page, and removes the dead button from the workflow. Web only: the route, the SDK hook (`sdk.connectorInstances.testConnection`) and the dialog already exist.

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

Which entities get it: only those backed by an endpoint. "Create Entity" can add an entity with no endpoint to a REST instance, and testing it would only report "not configured". The view runs `apiConnector.endpoints.list(instanceId, { enabled: slug === "rest-api" })` once per page and builds a `Set` of `entity.id`s. That is one bounded query: an instance's endpoints are user-configured rows, the same set the workflow showed. Gate: `decideActionGate({ allowed: capabilities.read })`, the route's own check, added to `connectorInstanceActionGates` as `testEndpoint`. No lock reason, since the route is read-only. On a 404 or 403 the dialog's `FormAlert` shows the error; `onPermissionDenied` already invalidates the instance root.

## Decision 2 — the workflow's Test button is removed

Options: keep it with a corrected tooltip, or remove it. Before saving, the Add endpoint dialog's **Preview response** (probe-endpoint-draft) already dry-runs the draft, so a button that can never work is the #684 bug however it's labelled. **Chosen: remove it.** Delete the Test button, `onTest`/`testingIndex`, the `instanceId` prop and the `EndpointTestDialog` mount from `EndpointsStep`. Also remove the "Preserve the existing entityId…" comment, whose only purpose was keeping Test working. The workflow stays create-only.

## Plan — one slice

**Files**
- `apps/web/src/components/ConnectorEntity.component.tsx`: `onTestEndpoint` + `testEndpointGate` on `ConnectorEntityCardUIProps`; `GatedButton` in the expanded actions row, `stopPropagation` like the link.
- `apps/web/src/utils/connector-instance-actions.util.ts`: `testEndpoint: decideActionGate({ allowed: capabilities.read, blocked: null })`.
- `apps/web/src/views/ConnectorInstance.view.tsx`: endpoint-list query (rest-api only) → `Set` of entity ids; pass `onTestEndpoint` for members; one `EndpointTestDialog` (imported from `workflows/RestApiConnector`) driven by the selected entity.
- `apps/web/src/workflows/RestApiConnector/EndpointsStep.component.tsx`: remove the Test button, `onTest`, `instanceId` and the dialog mount.

**Tests**
- New `apps/web/src/__tests__/ConnectorEntityCard.test.tsx`: renders "Test endpoint" only when `onTestEndpoint` is set; click calls it, and the card doesn't toggle; a `disable` gate renders `aria-disabled` with its reason; `hide` renders nothing.
- `apps/web/src/__tests__/connector-instance-actions.util.test.ts`: `testEndpoint` allows on `read`, hides without it.
- `apps/web/src/workflows/RestApiConnector/__tests__/EndpointsStep.test.tsx`: replace the "Test button" describe with "no Test button in the create workflow"; edit/remove still work.
- `EndpointTestDialog`'s existing tests stay as they are.
- `npm run test:unit -- --testPathPattern 'ConnectorEntityCard|connector-instance-actions|EndpointsStep|EndpointTestDialog'` (web), `type-check`, `lint`, `format:check`.

## Smoke (manual, against your dev stack)

1. Create a REST API connector with base URL `https://jsonplaceholder.typicode.com` and endpoint `users` (`/users`, ID field `id`). The Endpoints step has **no Test button**, and Add endpoint's **Preview response** still fetches page 1.
2. Commit, then on the detail page expand the **Users** entity → **Test endpoint** appears. Click it → the dialog opens and shows the first 5 records.
3. **Create Entity** on the same instance (no endpoint) → that card has no Test endpoint action.
4. A non-REST connector (Sandbox, a file upload) → no Test endpoint action on any entity.
5. Open **Test endpoint**, close it, open it again → it re-runs and shows fresh results, not the previous run's.

## Out of scope

- Editing an existing connector's endpoints after creation (a reopenable workflow). That's a feature, not this bug.
- The dialog's `ok: false` rendering, which is unchanged and covered by `EndpointTestDialog`'s tests.
- A Test action on the entity detail page (`/entities/$entityId`). The connector page is where endpoints are listed; add it later if asked.
