# Adopt `invalidPayload` across routers — Discovery

**Issue:** [EnterpriseBT/portal-ai#745](https://github.com/EnterpriseBT/portal-ai/issues/745)

**Why this exists.** #706 and #742 settled how a request that fails its schema is answered: `400 <DOMAIN>_INVALID_PAYLOAD`, the first Zod issue in the message, every issue in `details.issues`, built by one helper. The station, portal and pin routes use it. Most routers don't. A survey finds about 37 schema-failure branches that answer with a generic "Invalid X payload" (or a hand-written sentence) and no `details`, so a client, or the agent relaying the error, can't tell which field failed. The shape it does get depends on the route.

Two routes also skip the schema entirely. `PATCH /api/portals/:id` and `PATCH /api/portal-results/:id` check fields by hand, so a wrongly typed field is silently ignored rather than refused. This ticket makes the #742 shape the only shape a schema failure can take, gives those two PATCHes real contracts, and adds a CI guard so a new route can't drift back.

## The current shape

### The helper and its callers

| Piece | Location | Note |
|---|---|---|
| `describeFirstZodIssue(issues, fallback)` | `apps/api/src/utils/zod-issue.util.ts:12` | `"a.0.b: msg"`, or `msg` for an empty path; also used by toolpack registration |
| `invalidPayload(code, label, error)` | `apps/api/src/utils/zod-issue.util.ts:29` | `new ApiError(400, code, "<label>: <first issue>", { issues: error.issues })` — `details.issues` is the raw `ZodIssue[]` |
| Adopters | `portal.router.ts:102`, `:759`; `portal-results.router.ts:125`; `station.router.ts:474`, `:683` | Every call is `return next(invalidPayload(ApiCode.X_INVALID_PAYLOAD, "Invalid X payload", parsed.error))` |
| Unit test | `apps/api/src/__tests__/utils/zod-issue.util.test.ts:44` | |

Zod is 4.6 here (`apps/api` and `packages/core` both resolve `^4.3.6`). Its issues carry no input values unless `reportInput` is set, which nothing does, so widening `details.issues` exposes only the schema's own paths, expectations and unrecognized key names, all of them the caller's.

### The guard test

`apps/api/src/__tests__/invalid-request-code.guard.test.ts` parses every non-test `.ts` under `apps/api/src` with the TypeScript AST (`sourceFiles`, `:89`). `notFound400s` (`:63`) flags a 4xx that names a `*_NOT_FOUND` code, through `new ApiError` or `invalidPayload`, and looks through parentheses and both branches of a conditional (`:46`). The `ALLOWED` list (`:24`) can only shrink, and a stale entry fails (`:116`). Self-tests feed snippets to the exported visitor (`:125`). A second visitor fits beside it.

### Schema-failure branches without the shape

**(a) A `!parsed.success` branch that drops the issues (convert):**

| Router | Sites |
|---|---|
| curated-view | `:512` create, `:646` update, `:932` attach |
| organization | `:328`, `:473`, `:559`, `:613`, `:866`, `:1108`. These carry hand-written messages ("token is required", "email (valid) and role (member\|admin) are required") |
| entity-record | `:798`, `:965`, `:1275` |
| entity-group | `:421`, `:588`; `:974` parses `req.query` |
| group | `:104`, `:231`, `:316` |
| grant | `:82`; `:154` is compound (`!rt.success \|\| typeof resourceId !== "string" …`) over the query |
| billing, policy, role, connector-entity, toolpacks, entity-tag, field-mapping, column-definition, connector-instance | 2 each: billing `:169` `:254`; policy `:106` `:239`; role `:107` `:246`; connector-entity `:539` `:742`; toolpacks `:364` `:528`; entity-tag `:349` `:516`; field-mapping `:416` `:682`; column-definition `:413` `:598`; connector-instance `:741` `:1588` |

**(b) Hand-written semantic checks (keep as is):** curated-view `:117` (duplicate field mapping), `:188`/`:195` (not a column), `:534` (unknown connector entity); entity-record `:1285` ("at least one of data or normalizedData"); google-sheets-connector `:318`, `:416` and microsoft-excel-connector `:400`, `:502` (`typeof` checks on single body or query params, no schema).

**Near misses:**
- They carry `{ issues }` but have a generic message with no first issue: `layout-plans.router.ts:111`, `:194`; `connector-instance-layout-plans.router.ts:118`, `:460`, `:621`; `file-uploads.router.ts:74`, `:142`, `:213`, `:315` (query).
- They use a non-`INVALID_PAYLOAD` code for a schema failure and have no details: `entity-group-member.router.ts:273` (`_CREATE_FAILED`), `:487` (`_UPDATE_FAILED`), `:770` (`_FETCH_FAILED`, query); `entity-tag-assignment.router.ts:267` (`_CREATE_FAILED`); `entity-record.router.ts:223` (`ENTITY_RECORD_INVALID_QUERY`); `curated-view.router.ts:1061` (`CURATED_VIEW_INVALID_QUERY`). Neither domain has an `_INVALID_PAYLOAD` code (`api-codes.constants.ts:269–293`).
- `api-endpoints.router.ts:509`, `:748` use `.parse()` in a try/catch. The message is `` `Invalid api endpoint payload: ${err.message}` ``, which is Zod's full JSON dump, and the handler casts `err as z.ZodError` even when the error isn't a Zod error.

### The two hand-validated PATCHes

| Route | Location | Behaviour today |
|---|---|---|
| `PATCH /api/portals/:id` | `portal.router.ts:607–623` | It casts `{ name?, lastOpened? }` and accepts if either `name` is a non-blank string or `lastOpened` is a number. `{ name: 123, lastOpened: 1 }` returns 200 and drops `name`. `{ lastOpened: "x" }` answers "name or lastOpened is required". It trims `name`. It validates **before** `PortalAccessService.load` (`:627`). |
| `PATCH /api/portal-results/:id` | `portal-results.router.ts:683–692` | It checks for a non-blank `name` but saves it **untrimmed** (`:711`). It also validates before the access check. |

Web callers send exactly the declared keys: `portals.api.ts:55` `{ name }`, `:80` `{ lastOpened }`; `portal-results.api.ts:61` `{ name }`, typed by a web-local `RenamePortalResultBody` (`:33`) that has no core contract. `portal.contract.ts` has create, send-message and pin bodies (`:100`, `:116`, `:172`) but no PATCH body.

### Strictness today

Only station's schemas are `.strict()` (`station.contract.ts:129`, `:157`, `:180`). `UpdateStationBodySchema` is `.strict().refine(some field present)`, the obvious template for the portal PATCH. The web callers of the larger routers all build exact bodies (curated view `CuratedViewEditorDialog.component.tsx:348`, `:376`; group `GroupEditorDialog.component.tsx:210`; entity group `EditEntityGroupDialog.component.tsx:63`; entity record create/edit dialogs). There is one trap: `useAuthMutation` sends the whole `variables` object when a hook declares no `body:` (`apps/web/src/utils/api.util.ts:251`), so a `url: (v) => …` hook without a `body:` would put path ids in the body.

### Tests pinned to current messages

`portal.router.integration.test.ts:599` ("name or lastOpened is required") and `portal-results.router.integration.test.ts:971` ("name is required"). No other generic message is asserted. About 24 test files check `res.body.code` only, and the code doesn't change.

## The design space

### Decision 1 — What counts as "a schema failure"

- **A. Body `safeParse` with an `_INVALID_PAYLOAD` code only.** This is the issue's literal wording, about 37 sites.
- **B. A plus the near misses:** query `safeParse` failures, the sites that carry `{ issues }` with a generic message, the non-`INVALID_PAYLOAD` codes, and the api-endpoints try/catch.
- **C. B plus the uncaught `*ListRequestQuerySchema.parse(req.query)` calls** that currently 500 (`portal.router.ts:231`, `portal-results.router.ts:450`, `curated-view.router.ts:274`, …).

| | A | B | C |
|---|---|---|---|
| Satisfies "one error shape" | Partly: query and generic-message sites still differ | Yes, for every 400 | Yes |
| Status codes change | No | Only the four `_CREATE_FAILED`/`_UPDATE_FAILED`/`_FETCH_FAILED` codes become `_INVALID_PAYLOAD`. Status stays 400 | 500 → 400 on list routes |
| In scope per issue | Yes | Yes ("every `safeParse` failure in `apps/api/src/routes`") | No ("changing which status a route returns" is out) |

**Lean: B.** The deliverable says *every* `safeParse` failure, and a guard that leaves near misses beside a rule only teaches people to copy the near miss. C changes statuses, so it gets its own ticket.

### Decision 2 — Codes for domains without an `_INVALID_PAYLOAD`

- **A.** Add `ENTITY_GROUP_MEMBER_INVALID_PAYLOAD` and `ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD`, and keep `_INVALID_QUERY` for query failures (`invalidPayload` takes any `ApiCode`).
- **B.** Keep the `_CREATE_FAILED` codes and only add details.

**Lean: A.** A `_CREATE_FAILED` for a bad body tells a client the server broke. The web doesn't branch on those codes (verify in the plan), and `_INVALID_QUERY` is already the right domain code for a query.

### Decision 3 — The organization router's hand-written messages

These sit in `!parsed.success` branches, but their text documents the contract ("email (valid) and role (member|admin) are required").

- **A.** Pass that text as the `label`, giving "email (valid) and role (member|admin) are required: role: Invalid enum value …".
- **B.** Use a "Invalid invitation payload"-style label, in line with every other adopter, and let the first issue name the field.

**Lean: B.** The first issue already names the field and the expected value. A reads as two sentences glued together, and it diverges from the shape the guard enforces everywhere else.

### Decision 4 — Portal and pin PATCH contracts

`UpdatePortalBodySchema = z.object({ name: z.string().trim().min(1).optional(), lastOpened: z.number().int().nonnegative().optional() }).strict().refine(name ?? lastOpened present)` and `UpdatePortalResultBodySchema = z.object({ name: z.string().trim().min(1) }).strict()`, both in `portal.contract.ts` (pins already live there). The web `RenamePortalResultBody` becomes the inferred core type. Validation stays **before** the access load, so the existing "bad body on a missing id → 400" ordering holds. The pin route saves the parsed (trimmed) name, which closes the untrimmed-save gap.

**Lean: as stated.** The only alternative worth naming, non-strict, is exactly the silent drop this issue exists to remove.

### Decision 5 — How far `.strict()` goes

- **A. Only the two new PATCH schemas.**
- **B. Every body schema whose web callers have been verified to send exact keys** (curated view, group, entity group, entity record, organization, …).
- **C. Every body schema.**

| | A | B | C |
|---|---|---|---|
| Behaviour change for clients | None beyond the two routes | A client sending extras starts getting 400s | Same as B, plus unverified callers |
| Verification cost | None | One audit per hook (the `useAuthMutation` no-`body:` trap) | Unbounded (MCP, scripts, CLIs) |
| Value | Closes the reported bugs | Typos fail loudly | Same as B |

**Lean: B, limited to body schemas whose every caller the plan enumerates.** This includes `admin-cli`/`portalai`, which also call the API. A schema with an unverified caller stays non-strict and is recorded as such. Strictness is a contract change, so each one is a deliberate act with its caller list in the plan, not a sweep.

### Decision 6 — Guard shape

Add a `schemaFailure400s` visitor to `invalid-request-code.guard.test.ts`. Inside the then-branch of an `IfStatement` whose condition contains `!<x>.success` (compound conditions included), it flags any `new ApiError(400, …)`. It fires whether or not a 4th argument is present, so the "issues but generic message" near miss is caught too. The visitor gets an `ALLOWED` list of its own that can only shrink, and self-tests in the existing style. It doesn't try to follow `.parse()` in try/catch. Those two sites are converted to `safeParse` in this ticket, and the guard flags a `catch` that builds `_INVALID_PAYLOAD` from `err.message`.

**Lean: as stated.** Matching on `!x.success` is how every route in the repo spells it, and the brace-less `if` form needs nothing special at AST level.

## Tradeoff comparison

| | D1 B (all safeParse) | D2 A (new codes) | D3 B (uniform labels) | D4 strict PATCH contracts | D5 B (verified strict) | D6 AST guard |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes (caller table) | Yes |
| Changes a status | No | No | No | No | No | — |
| Changes a code | No | Yes (4 sites) | No | No | No | — |

## Recommendation

1. Every `safeParse` failure in `apps/api/src/routes`, whether body or query, returns `invalidPayload(<domain code>, "Invalid <thing> <payload|query>", parsed.error)`. That covers the about 37 bare sites, the 9 near misses that carry issues under a generic message, and the compound grant check, which is split so the schema failure and the `resourceId` check answer separately.
2. Add `ENTITY_GROUP_MEMBER_INVALID_PAYLOAD` and `ENTITY_TAG_ASSIGNMENT_INVALID_PAYLOAD`. Query failures use the existing `_INVALID_QUERY` codes.
3. The organization router's hand-written messages give way to uniform labels, and the first Zod issue names the field.
4. `api-endpoints.router.ts` moves from `.parse()` in a try/catch to `safeParse` + `invalidPayload`, keeping `REST_API_INVALID_CONFIG`.
5. Add `UpdatePortalBodySchema` and `UpdatePortalResultBodySchema` (strict) to `portal.contract.ts`. Both PATCH routes validate with them before the access load. The pin rename saves the trimmed name. The web `RenamePortalResultBody` becomes the core type.
6. `.strict()` lands only on body schemas whose callers the plan enumerates and verifies: web hooks (each has an explicit `body:` or exact variables), `admin-cli`, and agent tools that call routes.
7. `invalid-request-code.guard.test.ts` gains a `schemaFailure400s` visitor and a shrink-only allowlist. CI then fails on any `new ApiError(400, …)` in a `!x.success` branch.
8. The semantic checks in (b) stay hand-written.
9. Update the two pinned integration assertions, and add one per converted router that asserts `details.issues` and the field name in the message.

## Open questions

1. **Does anything branch on `ENTITY_GROUP_MEMBER_CREATE_FAILED` / `_UPDATE_FAILED` / `ENTITY_TAG_ASSIGNMENT_CREATE_FAILED` for a 400?** Lean: no, since the web reads `serverErrorMessage`, not codes. The plan greps web and admin-cli to confirm before renaming.
2. **Should `lastOpened` accept any number, or only a non-negative integer (epoch ms)?** The web sends `DateFactory.now()`. Lean: `z.number().int().nonnegative()`. A fractional or negative timestamp is a client bug worth a 400.
3. **Does a 500 that reuses `LAYOUT_PLAN_INVALID_PAYLOAD` (`connector-instance-layout-plans.router.ts:492`) belong here?** It isn't a schema failure, and changing it touches a status/code pair. Lean: out of scope, noted in the PR for a follow-up.
4. **Do the hand `typeof` checks in google-sheets and microsoft-excel (`:318`, `:400`) deserve schemas?** Lean: no. They check one string param, the message already names it, and wrapping one field in a schema adds nothing a client can use.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A, because validation is stateless and per request.
- **Accuracy & auditability:** N/A, because no record of truth changes. Errors are already logged by the catch-all.
- **Failure modes:** Lean: fail closed. Strictness moves "silently ignored" to "400 naming the key". That is the safe direction for a multi-tenant API, but it can break a client that sends extras, which is why D5 gates it on a verified caller list.
- **Scale & unbounded growth:** Lean: `details.issues` is bounded by the schema's field count. Zod reports one issue per failing path, and bodies are already capped by the JSON body-size limit.
- **Multi-tenancy:** Lean: no leak. Issues echo only the caller's own input and the schema, never row data. Validation runs before any org-scoped load, so a 400 says nothing about whether another tenant's object exists (#713's 404 discipline is untouched).
- **Contract stability:** Lean: this is the point of the ticket. One error shape across routes means the agent, the web's `serverErrorMessage` and the CLIs parse one thing. `details.issues` becomes a documented field, so the plan registers it in the OpenAPI error component.
- **Data lifecycle:** N/A, because nothing is stored.

## What this doesn't decide

- **The uncaught `*ListRequestQuerySchema.parse(req.query)` 500s.** That is a status change, which the issue rules out. It deserves its own ticket.
- **The 500 that uses `LAYOUT_PLAN_INVALID_PAYLOAD`** (open question 3).
- **#743**, the cross-org 403 / recommit issue.
- **Response self-checks** (`public-site:99`, `connector-config:69`, `profile:94`). They validate what the server sends, not what it receives.

## Next step

`/spec 745` turns the recommendation into a contract. It covers the two new core schemas, the `details.issues` OpenAPI registration, the two new codes, the guard rule, and a per-schema strictness table with each one's callers. `/plan 745` then slices it test-first:

1. The guard with an allowlist seeded from today's sites.
2. The portal and pin PATCH contracts.
3. The router conversions in a few batches, each batch removing its allowlist entries.
4. Strictness per verified schema.

The plan ends with the allowlist empty.
