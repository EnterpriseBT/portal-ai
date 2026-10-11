# Adopt `invalidPayload` across routers — Spec

**Issue:** [EnterpriseBT/portal-ai#745](https://github.com/EnterpriseBT/portal-ai/issues/745) · **Discovery:** `docs/INVALID_PAYLOAD_ADOPTION.discovery.md`

This spec pins three things. First, every request that fails its Zod schema in `apps/api/src/routes` answers through `invalidPayload`, which gives one error shape. Second, the portal and pin PATCH routes get strict contract bodies. Third, the body schemas whose callers have been verified become `.strict()`. A CI guard keeps a new schema-failure 400 from dropping the issues. Nothing here changes a status code or an authorization check.

## Key decisions (flag for review)

1. **Scope is every `safeParse` failure, body and query** (discovery D1 B). That covers the bare 400s, the near misses that carry `{ issues }` under a generic message, the `.parse()`-in-try/catch sites, and the `REST_API_INVALID_CONFIG` probe sites. The uncaught list-query `.parse()` calls that answer 500 are out of scope, because fixing them changes a status.
2. **Two new codes.** `ENTITY_GROUP_MEMBER_INVALID_PAYLOAD` and `ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD` replace the `_CREATE_FAILED`/`_UPDATE_FAILED`/`_FETCH_FAILED` codes on the five schema-failure sites in those routers (D2 A). Nothing in web, admin-cli or the tests reads the old codes on a 400; the only mentions are comments.
3. **Uniform labels.** The organization router's hand-written sentences give way to `"Invalid <thing> payload"`, and the first Zod issue names the field (D3 B).
4. **`.strict()` lands on every request-body schema below whose in-repo callers were verified to send exact keys.** All of them qualify except two: `InterpretRequestBodySchema`, an alias of the parser's own `InterpretInputSchema`, stays loose; `PatchLayoutPlanBodySchema` is a `z.record`, so strictness doesn't apply. Nested objects (`grantee`, `statements`, `plan`, `enabledCapabilityFlags`, …) stay loose. **No external API callers are known.** `admin-cli`, `devops-cli` and `e2e` make no calls to these routes.
5. **Agent tools inherit strictness.** `apps/api/src/tools/rbac/{policy,role,group}.tool.ts` and `grant.tool.ts` use the upsert and grant schemas as tool input schemas, including `.extend({ id })` for updates. Zod 4's `.extend` keeps `.strict()` (verified), so a model that sends an extra key gets a tool-input error naming it instead of a silent drop. That is the intended behaviour; confirm.
6. **Zod is 4.6.** Issues carry no input values (`reportInput` is unset), so `details.issues` only exposes schema paths, expectations and the names of the caller's own unrecognized keys.

## Scope

### In scope

- Converting every schema-failure branch in `apps/api/src/routes/**` to `invalidPayload`, plus splitting the compound grant query check.
- `UpdatePortalBodySchema` and `UpdatePortalResultBodySchema` in `packages/core/src/contracts/portal.contract.ts`, wired into both PATCH routes and the web SDK types.
- `.strict()` on the verified body schemas (§ Strictness).
- Two `ApiCode` additions.
- A `schemaFailure400s` visitor in `invalid-request-code.guard.test.ts`.
- `details` on the OpenAPI `ApiErrorResponse`.

### Out of scope

- List routes whose `*ListRequestQuerySchema.parse(req.query)` answers 500 (`portal.router.ts:231`, `portal-results.router.ts:450`, `curated-view.router.ts:274`, …): fixing them changes a status, so they get a follow-up ticket.
- The 500 that uses `LAYOUT_PLAN_INVALID_PAYLOAD` (`connector-instance-layout-plans.router.ts:492`).
- Single-param `typeof` checks with no schema: google-sheets `:318`, `:416`; microsoft-excel `:400`, `:502`.
- The semantic 400s: curated-view `:117`, `:188`, `:195`, `:534`; entity-record `:1285`.
- Validation outside `routes/`: `adapters/rest-api/pagination/index.ts`, `credentials.util.ts`, and response self-checks.
- Making nested objects strict.
- Deduplicating `PatchApiEndpointRequestBodySchema` (router-local `api-endpoints.router.ts:58` vs `api-connector.contract.ts`).
- #743.

## Surface

### `invalidPayload` (`apps/api/src/utils/zod-issue.util.ts:29`)

The signature is unchanged: `invalidPayload(code: ApiCode, label: string, error: z.ZodError): ApiError`. The doc comment widens from "a body" to "a request body or query". The label convention is:

| Request part | Label |
|---|---|
| body | `"Invalid <thing> payload"` |
| query | `"Invalid <thing> query"` |

The response is always:

```
400 { status: "ERROR", code, message: "<label>: <path>: <first issue message>", details: { issues: ZodIssue[] } }
```

### `ApiCode` additions (`apps/api/src/constants/api-codes.constants.ts`)

```ts
ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD = "ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD", // beside :269–273
ENTITY_GROUP_MEMBER_INVALID_PAYLOAD = "ENTITY_GROUP_MEMBER_INVALID_PAYLOAD",     // beside :286–293
```

The old `_CREATE_FAILED`/`_UPDATE_FAILED`/`_FETCH_FAILED` codes stay. Their non-validation uses, the 500 fallbacks in the same routers, are untouched.

### New contracts (`packages/core/src/contracts/portal.contract.ts`, after `SendMessageBodySchema`)

```ts
// ── Update Portal ─────────────────────────────────────────────────────
/** #745: PATCH /api/portals/:id. Rename, or record an open. A wrongly typed
 *  or unknown key is a 400 naming it, not a silent no-op. */
export const UpdatePortalBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    lastOpened: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((d) => d.name !== undefined || d.lastOpened !== undefined, {
    message: "At least one field must be provided",
  });
export type UpdatePortalBody = z.infer<typeof UpdatePortalBodySchema>;

// ── Rename Pin ────────────────────────────────────────────────────────
export const UpdatePortalResultBodySchema = z
  .object({ name: z.string().trim().min(1) })
  .strict();
export type UpdatePortalResultBody = z.infer<typeof UpdatePortalResultBodySchema>;
```

### Portal PATCH (`apps/api/src/routes/portal.router.ts:607–653`)

- The `req.body as {…}` cast and the `hasName`/`hasLastOpened` checks are replaced by `UpdatePortalBodySchema.safeParse(req.body)`. On failure the route returns `next(invalidPayload(ApiCode.PORTAL_INVALID_PAYLOAD, "Invalid portal payload", parsed.error))`.
- Validation still runs **before** `PortalAccessService.load`, so a bad body on a missing id stays a 400.
- `name` comes from `parsed.data`, where the schema has already trimmed it. The route's own `.trim()` is removed.

| Body | Before | After |
|---|---|---|
| `{ "lastOpened": "x" }` | 400 "name or lastOpened is required" | 400 `Invalid portal payload: lastOpened: Invalid input: expected number, received string` |
| `{ "name": 123, "lastOpened": 1 }` | 200, `name` dropped | 400 naming `name` |
| `{ "name": "  " }` | 400 | 400 naming `name` (too small) |
| `{}` | 400 | 400 `Invalid portal payload: At least one field must be provided` |
| `{ "name": "A", "extra": 1 }` | 200 | 400 `Invalid portal payload: Unrecognized key: "extra"` |

### Pin PATCH (`apps/api/src/routes/portal-results.router.ts:683–715`)

The route switches to `UpdatePortalResultBodySchema.safeParse` and `invalidPayload(ApiCode.PORTAL_RESULT_INVALID_PAYLOAD, "Invalid pin payload", …)`. Validation still comes before `ObjectAccessService.loadForVerb`. The route saves `parsed.data.name`, so a name sent as `" A "` is stored as `"A"` (previously stored untrimmed).

### Web SDK types

- `apps/web/src/api/portal-results.api.ts:33`: the local `RenamePortalResultBody` interface is deleted. `rename` is typed with `UpdatePortalResultBody` from `@portalai/core/contracts`.
- `apps/web/src/api/portals.api.ts:55`, `:80`: `rename` is typed `Pick<UpdatePortalBody, "name">` with `name` required (`{ name: string }`), and `touch` as `{ lastOpened: number }`. Both keep their exact shapes, but they now derive from the contract.

### Router conversions

Every row becomes `return next(invalidPayload(<code>, <label>, <parsed>.error))`, or a `throw` where the site throws today. The code is the one the site uses now, except where the table names a new one.

| Router | Lines | Code | Labels |
|---|---|---|---|
| curated-view | `:512`, `:646`, `:932`; `:1061` (query) | `CURATED_VIEW_INVALID_PAYLOAD`; `_INVALID_QUERY` | `Invalid curated view payload` / `… attach payload` / `Invalid curated view records query` |
| organization | `:328`, `:473`, `:559`, `:613`, `:866`, `:1108` | `ORGANIZATION_INVALID_PAYLOAD` | `Invalid organization delete payload`, `Invalid member roles payload`, `Invalid member groups payload`, `Invalid invitation payload`, `Invalid invitation accept payload`, `Invalid organization switch payload` |
| entity-record | `:798`, `:965`, `:1275`; `:223` (query) | `ENTITY_RECORD_INVALID_PAYLOAD`; `_INVALID_QUERY` | `Invalid entity record payload` / `… import payload` / `Invalid entity record query` |
| entity-group | `:421`, `:588`; `:974` (query) | `ENTITY_GROUP_INVALID_PAYLOAD` | `Invalid entity group payload` / `Invalid entity group resolve query` |
| group, policy, role | `:104`, `:231`, `:316`; `:106`, `:239`; `:107`, `:246` | `ORGANIZATION_INVALID_PAYLOAD` | `Invalid group payload` / `Invalid group members payload` / `Invalid policy payload` / `Invalid role payload` |
| grant | `:82`; `:150–154` split | `ORGANIZATION_INVALID_PAYLOAD` | `Invalid grant payload`. At `:150` the `rt` failure becomes `invalidPayload(…, "Invalid grant query", rt.error)`, then the `resourceId` check keeps its own message |
| billing | `:169`, `:254` | `BILLING_INVALID_PAYLOAD` | `Invalid checkout payload` / `Invalid billing portal payload` |
| connector-entity, toolpacks, entity-tag, field-mapping, column-definition | 2 each (discovery table) | existing domain `_INVALID_PAYLOAD` | `Invalid <domain> payload` |
| connector-instance | `:741`, `:1588` | `CONNECTOR_INSTANCE_INVALID_PAYLOAD` | `Invalid connector instance payload` |
| connector-instance (probe) | `:973`, `:1069`, `:1175` | `REST_API_INVALID_CONFIG` | kept: `Invalid probe-endpoint-draft body` etc. |
| api-endpoints | `:509`, `:748` | `REST_API_INVALID_CONFIG` | `.parse` in try/catch → `safeParse`; `Invalid api endpoint payload` |
| entity-group-member | `:273`, `:487`; `:770` (query) | **`ENTITY_GROUP_MEMBER_INVALID_PAYLOAD`** | `Invalid entity group member payload` / `… query` |
| entity-tag-assignment | `:267` | **`ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD`** | `Invalid tag assignment payload` |
| layout-plans, connector-instance-layout-plans | `:111`, `:194`; `:118`, `:460`, `:621` | `LAYOUT_PLAN_INVALID_PAYLOAD` | existing labels (`Invalid interpret request body`, …) |
| file-uploads | `:74`, `:142`, `:213`, `:315` (query) | `FILE_UPLOAD_PARSE_INVALID_PAYLOAD` | existing labels |

Line numbers are from `main` at `808ff64e`. **The guard's offender list (below) is the authoritative inventory.** If the guard finds a site this table missed, that site is converted the same way.

### Strictness

`.strict()` goes on the inner `z.object(…)`, **before** any `.refine` (the `UpdateStationBodySchema` pattern), with a one-line `// #745:` comment.

| Contract file | Schemas made strict |
|---|---|
| `curated-view.contract.ts` | `CuratedViewCreateRequestBodySchema` (:112), `CuratedViewUpdateRequestBodySchema` (:137), `CuratedViewAttachRequestBodySchema` (:173) |
| `organization.contract.ts` | `OrganizationDeleteRequestSchema` (:43), `MemberRolesSetRequestSchema` (:70) |
| `rbac-authoring.contract.ts` | `PolicyUpsertRequestSchema` (:35), `RoleUpsertRequestSchema` (:65), `GroupUpsertRequestSchema` (:95), `GroupMembersSetRequestSchema` (:121), `MemberGroupsSetRequestSchema` (:138) |
| `invitation.contract.ts` | `InviteCreateRequestSchema` (:18), `AcceptInvitationRequestSchema` (:30) |
| `user-membership.contract.ts` | `OrganizationSwitchRequestSchema` (:26) |
| `grant.contract.ts` | `ShareGrantRequestSchema` (:32) |
| `billing.contract.ts` | `BillingCheckoutRequestSchema` (:48), `BillingPortalRequestSchema` (:56) |
| `entity-record.contract.ts` | `EntityRecordImportRequestBodySchema` (:98), `EntityRecordPatchRequestBodySchema` (:139), `EntityRecordCreateRequestBodySchema` (:158) |
| `entity-group.contract.ts` | `EntityGroupCreateRequestBodySchema` (:74), `EntityGroupUpdateRequestBodySchema` (:93) |
| `entity-group-member.contract.ts` | `EntityGroupMemberCreateRequestBodySchema` (:8), `EntityGroupMemberUpdateRequestBodySchema` (:28) |
| `entity-tag.contract.ts` | `EntityTagCreateRequestBodySchema` (:54), `EntityTagUpdateRequestBodySchema` (:74) |
| `entity-tag-assignment.contract.ts` | `EntityTagAssignmentCreateRequestBodySchema` (:12) |
| `connector-entity.contract.ts` | `ConnectorEntityCreateRequestBodySchema` (:102), `ConnectorEntityPatchRequestBodySchema` (:122) |
| `connector-instance.contract.ts` | `ConnectorInstanceCreateRequestBodySchema` (:121), `ConnectorInstancePatchRequestBodySchema` (:157) |
| `field-mapping.contract.ts` | `FieldMappingCreateRequestBodySchema` (:110), `FieldMappingUpdateRequestBodySchema` (:138) |
| `column-definition.contract.ts` | `ColumnDefinitionCreateRequestBodySchema` (:49), `ColumnDefinitionUpdateRequestBodySchema` (:74) |
| `toolpack.contract.ts` | `RegisterToolpackBodySchema` (:131), `UpdateToolpackBodySchema` (:139) |
| `connector-instance-layout-plans.contract.ts` | `LayoutPlanInterpretDraftRequestBodySchema` (:162), `LayoutPlanCommitDraftRequestBodySchema` (:215), `CommitLayoutPlanRequestBodySchema` (:81) |
| `file-uploads.contract.ts` | `FileUploadPresignRequestBodySchema` (:28), `FileUploadConfirmRequestBodySchema` (:52), `FileUploadParseSessionRequestBodySchema` (:70) |
| `api-connector.contract.ts` | `CreateApiEndpointRequestBodySchema` (:252) |
| router-local | `PatchApiEndpointRequestBodySchema` (`api-endpoints.router.ts:58`) |

**Stays loose, recorded:** `InterpretRequestBodySchema` (it *is* `InterpretInputSchema`, which the parser's `state.ts:40` `.omit()`s, and its hook has no call sites), `PatchLayoutPlanBodySchema` (a record), and the station schemas (already strict).

Web forms that pre-validate with these schemas validate exact objects today: CuratedViewEditorDialog, EntityGroups.view, EditEntityGroupDialog, InviteMemberDialog, RegisterToolpackDialog, EditToolpackDialog and SandboxConnectorWorkflow. They need no change, and their tests prove it.

### Guard (`apps/api/src/__tests__/invalid-request-code.guard.test.ts`)

```ts
/** #745: a hand-built 400 for a request that failed its schema. */
export function schemaFailure400s(source: string): Array<{ line: number; code: string }>;
```

It flags `new ApiError(400, <code>, …)` when **either** of these holds:

- **(R1)** It sits anywhere inside the `thenStatement` of an `IfStatement` whose condition contains a `PrefixUnaryExpression` `!` over a `PropertyAccessExpression` named `success`. This covers the brace-less form and compound conditions (`!rt.success || …`).
- **(R2)** Its 4th argument is an object literal with an `issues` property.

It does **not** flag `invalidPayload(…)`, a non-400 `ApiError` (for example a 500 response self-check), or a 400 outside such a branch.

`code` is the text of argument 2 with `ApiCode.` stripped. The scan covers `apps/api/src/routes/**` only. `SCHEMA_FAILURE_ALLOWED: Array<{ file: string; code: string }>` is shrink-only, gets its own stale-entry test, and **is empty when this ticket merges.**

### OpenAPI (`apps/api/src/config/swagger.config.ts:733`)

`ApiErrorResponse` gains an optional `details: { type: "object", additionalProperties: true }`, described as "On a 400 `*_INVALID_PAYLOAD` / `*_INVALID_QUERY`, `issues` holds every Zod issue (`code`, `path`, `message`, …); the message names the first."

## Migration / Seed

None. There are no schema or seed changes.

## TDD test plan

Run from each package with `npm run test:unit` / `npm run test:integration` and `--testPathPattern`, never raw jest.

### `packages/core`

- `src/__tests__/contracts/portal.contract.test.ts`:
  - `UpdatePortalBodySchema`: name only; lastOpened only; both; `{}` (refine); `lastOpened: "x"`; `lastOpened: -1`; `lastOpened: 1.5`; `name: 123`; `name: "  "`; trims; unknown key.
  - `UpdatePortalResultBodySchema`: valid; trims; `name: 123`; blank; missing; unknown key.
  - About 17 cases.
- `src/__tests__/contracts/strict-request-bodies.test.ts` (new): table-driven over the § Strictness list. For each schema, a minimal valid body plus `{ __extra: 1 }` fails with an `unrecognized_keys` issue at path `[]`, and the minimal body alone passes. One more case shows a schema left loose (`InterpretRequestBodySchema`) still strips. About 45 cases.

### `apps/api` unit

- `src/__tests__/invalid-request-code.guard.test.ts`:
  - `schemaFailure400s` self-tests: braced `if`; brace-less `if`; compound `!a.success || b`; a 4th argument with `issues` outside any branch; `invalidPayload` not flagged; a 500 in a `!x.success` branch not flagged; a semantic 400 under `if (!name)` not flagged; nested blocks inside the failure branch.
  - A real-tree test asserting no offenders outside the allowlist.
  - The stale-entry test.
  - About 10 cases.
- Agent tools: the existing `rbac` and `grant` tool tests keep passing. One case per tool file asserts an extra key is rejected. About 4 cases.

### `apps/api` integration

- `portal.router.integration.test.ts`:
  - `:599` is rewritten.
  - New cases: `{lastOpened:"x"}` → 400 with message `/lastOpened/` and `details.issues[0].path` `["lastOpened"]`; `{name:123,lastOpened:1}` → 400; unknown key → 400 `unrecognized_keys`; a bad body on a missing id is still 400; a valid rename trims.
  - About 6 cases.
- `portal-results.router.integration.test.ts`:
  - `:971` is rewritten.
  - New cases: `name:123` → 400 naming `name`; unknown key → 400; `" A "` is stored as `"A"`.
  - About 4 cases.
- One case per converted router file: a malformed body (or query) → 400, the expected code, a message containing the failing path, and a non-empty `details.issues`. That is 21 router files besides portal and pin. Where a file has both body and query sites, both are covered, so about 30 cases.
- `entity-group-member` and `entity-tag-assignment` assert the **new** codes.
- `grant`: the split check gives a bad `resourceType` → issues present; a valid `resourceType` with no `resourceId` → the hand message, no issues.

### `apps/web`

- The type-only changes are covered by `npm run type-check`.
- Existing dialog tests for the forms listed under § Strictness must pass unchanged. No new web tests.

**Totals ≈ 116 cases.**

## Acceptance criteria

- [ ] A malformed body or query on any route in `apps/api/src/routes` answers `400 <DOMAIN>_INVALID_PAYLOAD | _INVALID_QUERY | REST_API_INVALID_CONFIG`, the failing field path is in `message`, and `details.issues` is present.
- [ ] `PATCH /api/portals/:id {"lastOpened":"x"}` → 400 naming `lastOpened`; `{"name":123,"lastOpened":1}` → 400, not 200.
- [ ] `PATCH /api/portal-results/:id {"name":123}` → 400 naming `name`; a valid rename stores the trimmed name.
- [ ] An unknown top-level key on any schema made strict → 400 `Unrecognized key: "<k>"`.
- [ ] A schema failure on an entity-group-member or tag-assignment request answers its new `_INVALID_PAYLOAD` code.
- [ ] Every web flow that posts to a now-strict route still succeeds (create/edit view, group, policy, role, invite, record, entity, mapping, column, toolpack, connector, upload).
- [ ] CI fails on a new `new ApiError(400, …)` in a `!x.success` branch, or on one carrying `{ issues }` by hand. The allowlist is empty.
- [ ] No route's status code changes.

## Risks & rollback

- **An unverified external client sends extra keys.** It gets a 400 where it used to get a 200. No such client is known (admin-cli, devops-cli and e2e make none of these calls). The failure is loud and names the key. To roll back, remove `.strict()` from the one schema; nothing else depends on it. This fails closed by intent: a silently ignored field is the defect #745 exists to remove.
- **The agent sends extra keys to an rbac or grant tool.** The tool input is refused with the key named, and the model retries. The `additionalProperties: false` in the tool's JSON Schema makes this less likely. Rollback: `.strip()` on the tool's input schema only.
- **Clients that read the message text.** Messages change on about 45 sites. Only the two portal integration tests assert message text. The web shows `serverErrorMessage`, which passes the message through, so users see more specific text.
- **Code rename** on five sites. No consumer reads the old codes on a 400.

## Files touched

- **core:**
  - `packages/core/src/contracts/portal.contract.ts`
  - the 20 contract files in § Strictness
  - `src/__tests__/contracts/portal.contract.test.ts`
  - new `src/__tests__/contracts/strict-request-bodies.test.ts`
- **api:**
  - `src/constants/api-codes.constants.ts`
  - `src/utils/zod-issue.util.ts` (doc comment)
  - `src/config/swagger.config.ts`
  - 23 routers: curated-view, organization, entity-record, entity-group, group, policy, role, grant, billing, connector-entity, toolpacks, entity-tag, field-mapping, column-definition, connector-instance, api-endpoints, entity-group-member, entity-tag-assignment, layout-plans, connector-instance-layout-plans, file-uploads, portal, portal-results, plus any the guard adds
  - `src/__tests__/invalid-request-code.guard.test.ts`
  - the matching `*.router.integration.test.ts` files
  - the rbac and grant tool tests
- **web:**
  - `src/api/portal-results.api.ts`
  - `src/api/portals.api.ts`

## Next step

`/plan 745` writes `docs/INVALID_PAYLOAD_ADOPTION.plan.md` as about six test-first slices on this branch:

1. The guard, with `SCHEMA_FAILURE_ALLOWED` seeded from today's offenders.
2. The portal and pin PATCH contracts and routes.
3. Router conversions in three batches (rbac/org; entity/record/tag/group-member; connector/layout/upload/api-endpoints). Each batch removes its allowlist entries and adds its integration cases.
4. Strictness and the strict-bodies test.

The last conversion slice empties the allowlist.
