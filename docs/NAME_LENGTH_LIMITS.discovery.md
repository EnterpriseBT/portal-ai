# Length limits on user-authored text — Discovery

**Issue:** [EnterpriseBT/portal-ai#801](https://github.com/EnterpriseBT/portal-ai/issues/801) · Bug · sizing `full`

**Why this exists.** The #789 adversarial walk pasted a 10,000-character name into **New Station** and pressed Enter: one `POST /api/stations`, **201**, a station whose name fills the page header. Nothing in the stack caps a user-authored name or description. The contracts stop at `min(1)`, the columns are `text`, and the only bound is the body parser's `REQUEST_JSON_LIMIT_BYTES` (4 MB, `apps/api/src/environment.ts`). One paste, a script or an agent tool call can put megabytes into a label that every list payload, layout and agent context then carries.

The survey found a second, sharper case. Keys that become Postgres identifiers (`c_<normalizedKey>` columns in `wide-table-reconciler.service.ts:118-134`) aren't capped either, and Postgres **silently truncates** an identifier over 63 bytes. Two long keys that share a 61-character prefix would collide.

This is the shared rule that makes "how long can this be" one answer, enforced at the API boundary and shown inline in every form that edits it.

## The current shape

### Contracts (`packages/core/src/contracts`)

| Field(s) | Schema | Rule today |
|---|---|---|
| station `name`, `description` | `CreateStationBodySchema` / `UpdateStationBodySchema` (`station.contract.ts:119-120`, `:172-173`) | `min(1)`, untrimmed / none |
| portal `name` | `UpdatePortalBodySchema` (`portal.contract.ts:134`) | `trim().min(1)` |
| pin `name` | `UpdatePortalResultBodySchema` (`:148`), `PinResultBodySchema` (`:211`) | `trim().min(1)` / `min(1)` |
| tag `name`, `description` | `entity-tag.contract.ts:57-59`, `:80-82` | `min(1)` / none |
| entity group `name`, `description` | `entity-group.contract.ts:77-78`, `:99-100` | `min(1)` / none |
| column definition `key`, `label`, `description`, `validationMessage` | `column-definition.contract.ts:52-57`, `:80-85` | key regex, others `min(1)`/nullable |
| connector entity `key`, `label` | `connector-entity.contract.ts:106-107`, `:128` | key regex / `min(1)` |
| connector instance `name` | `connector-instance.contract.ts:126`, `:163` | `min(1)` |
| layout-plan commit `name` + plan labels | `connector-instance-layout-plans.contract.ts:223-224`; region `name`/`axisName`/`targetEntityDefinitionId` in `packages/spreadsheet-parsing/src/plan/region.schema.ts:66,90,139` | `min(1)` |
| API endpoint `key`, `label` | `api-connector.contract.ts:264-265`, `:285` | `min(1)` |
| toolpack `name`, `description` | `toolpack.contract.ts:134-135`, `:145-146` | slug regex (≤63) / `min(1)` |
| policy / role / group `name`, `description` | `rbac-authoring.contract.ts:38-39`, `:71`, `:104-105` | `min(1, "Name is required")` |
| curated view `label`, `description` | `curated-view.contract.ts:117-118`, `:143-144` | `min(1)` / nullable |

Only two string caps exist: `CuratedViewKeySchema` (`max(63)`, a temp-view identifier, `curated-view.contract.ts:101-110`) and `promptHint` (`max(2000)`, `api-connector.contract.ts:174`). Neither uses a named constant. The model schemas (`packages/core/src/models/*.model.ts`) carry no caps. `AbstractModel.parse()` (`base.model.ts:39`) runs on create paths (`station.router.ts:530`, `application.service.ts:598`), so a cap there would turn a create into a 500, not a 400.

### Enforcement

- **API:** each route `safeParse`s against its contract and answers `invalidPayload(code, label, error)` (`apps/api/src/utils/zod-issue.util.ts:12-22, 66-78`), reading `"<label>: <path>: <message>"`. A bare Zod 4 `.max(N)` reads "Too big: expected string to have <=N characters", so the rule should carry its own message.
- **Guard template:** `strict-request-bodies.test.ts` enumerates every exported `*BodySchema`/`*RequestSchema` (`:31-38`) with a reasoned `LOOSE` map (`:17-29`) and a count sanity check.
- **Writes that skip a contract:**
  - The layout-plan commit sets the entity `label` from the plan's `targetId` (`layout-plan-commit.service.ts:386-387`).
  - Google Sheets and Excel name the instance from the provider account (`google-sheets-connector.service.ts:~161`, `microsoft-excel-connector.service.ts:202`).
  - `db:create-org --name` (`apps/api/src/db/create-org.ts:18-26`) is fed by the admin CLI (`packages/admin-cli/src/commands/provision.ts:55-58`).

### Agent tools (`apps/api/src/tools`)

- The RBAC tools reuse the contracts (`rbac/policy.tool.ts:12-13`, `role.tool.ts`, `group.tool.ts`), so a contract cap reaches them.
- The connector-entity create and update tools define their own Zod: `label min(1)`, `key min(1)` with **no regex** (`connector-entity-create.tool.ts:16-25`, `connector-entity-update.tool.ts:13-15`).
- The field-mapping tools copy the `normalizedKey` rule locally (`field-mapping-create.tool.ts:31-41`).
- The visualization `title`s are uncapped (`visualize-d3.tool.ts:27`, `visualize-map.tool.ts:38`), and they end up in pin content.

### Web (`apps/web`)

- `validateWithSchema` (`utils/form-validation.util.ts:24-36`) shows the first message per field through `helperText`.
- **About half the dialogs use the contract** (pin and portal rename, pin, toolpacks, entity groups, column definition edit, connector entity edit, curated view editor, the RBAC `NameField`).
- **The rest validate with local schemas the cap would never reach:**
  - `CreateStationDialog` `StationFormSchema` (`:48-51`) and `EditStationDialog` (`:75-78`), neither validating `description`
  - `TagFormModal` (`:37`)
  - `CreateConnectorEntityDialog` (`:28`)
  - `CreateColumnDefinitionDialog` (`:39`)
  - `EditConnectorInstanceDialog` (`:17`)
  - `CreateFieldMappingDialog` (`:24`)
  - `RegionEditor/NewEntityDialog` `buildSchema` (`:48`)
  - `RestApiConnector/BasicsStep`
- Inline editors with no validation: RegionConfigurationPanel `proposedLabel` (`:781`) and BindingEditorPopover `normalizedKey` (`:344`).
- No name field sets `maxLength`.
- `PageHeader` wraps long titles (`packages/core/src/ui/PageHeader.tsx:88-89`), and so do the breadcrumbs. `DetailCard` uses an ellipsis.

## The design space

### Decision 1 — Where the cap is enforced

- **A. Contracts only.** Request schemas carry the max; models and columns stay unbounded.
- **B. Contracts + DB.** Also `CHECK (char_length(name) <= N)` (or `varchar(N)`) on each column.
- **C. Contracts + models.**

| | A | B | C |
|---|---|---|---|
| Blocks API + agent writes | ✓ | ✓ | ✓ |
| Blocks non-contract writes (commit, provider names, CLI) | needs per-site checks | ✓ (as a 500) | partly, as 500s |
| Existing over-length rows | untouched | constraint fails unless `NOT VALID` | re-parse breaks them |
| Migration | none | one per table, under `lint:migrations` | none |

**Lean: A**, plus explicit checks at the handful of non-contract write sites. The contract is where a 400 with a message comes from. A DB constraint turns a missed path into a 500, the failure #687 says not to hand users. B stays a possible defense in depth later.

### Decision 2 — How many limits, and what values

- **A. One constant** for everything.
- **B. Three tiers by kind:**
  - `NAME_MAX_LENGTH` for names, labels and titles
  - `DESCRIPTION_MAX_LENGTH` for descriptions, notes and validation messages
  - `IDENTIFIER_KEY_MAX_LENGTH` for keys that become Postgres identifiers
- **C. Per-field values.**

**Lean: B**, with **120 / 2000 / identifier-bound**:
- 120 fits any real label and keeps headers and breadcrumbs sane.
- 2000 matches the existing `promptHint` precedent.
- The key bound is derived from 63 bytes minus the `c_` prefix and the collision suffix (`_N`), not picked.

One module in core exports the three constants, plus a reusable `nameSchema`/`descriptionSchema` builder that carries the message ("Name must be 120 characters or fewer"). Every contract composes them, so the value and the wording live once.

### Decision 3 — Keeping it from regressing

- **A. A field-name guard.** A core test walks every request schema (the `strict-request-bodies` enumeration, recursing through objects, wrappers, arrays and the embedded `LayoutPlanSchema`). It fails on a `ZodString` with no max whose field name is user-authored text (`name`, `label`, `description`, `title`, `notes`, `key`, `axisName`, `validationMessage`, …), unless a `LOOSE`-style map records why.
- **B. An every-string guard.** Any `ZodString` without a max fails unless id-shaped or allowlisted.
- **C. No guard**, only review.

**Lean: A.** B is the stronger rule, but it drags in SQL text, transform code, webhook URLs, filter payloads and body templates, each needing its own reasoned bound: a separate ticket's worth of decisions. A catches the class this bug is about, with a reviewable list. The guard also asserts its own field list matched a minimum number of fields, so a refactor can't hollow it out.

### Decision 4 — Web forms

- **A. Local dialog schemas compose the shared builders** (or pick from the contract's `.shape`), so the inline error appears on the field. No `maxLength` attribute.
- **B. A + `slotProps.htmlInput.maxLength`.**
- **C. Contract-only.** A long name surfaces as a `FormAlert` 400 after submit.

**Lean: A.** A `maxLength` attribute silently truncates a paste, and the user saves a name they never saw. An inline error after blur or submit says what happened, and `focusFirstInvalidField` takes them there. C is a regression from the inline validation the Form & Dialog Pattern requires. The inline editors (`proposedLabel`, binding `normalizedKey`) get the same rules.

## Tradeoff comparison

| | D1: contracts + site checks | D2: three tiers | D3: field-name guard | D4: inline errors |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| Packages touched | core, api | core | core | web |
| Migration | No | No | No | No |

## Recommendation

1. Add three text-limit constants to `packages/core` with `nameSchema` / `descriptionSchema` / `identifierKeySchema` builders that carry the user-facing message, exported through `@portalai/core/contracts`.
2. Every user-authored name, label, title, description, notes and identifier key in a request-body contract composes those builders. Existing `trim()` and `min(1, "Name is required")` behavior is kept, and trim is added where it's missing (station, tag, group, connector instance).
3. Models and DB columns stay unbounded. Reads of existing over-length rows are unaffected.
4. Non-contract writes check too:
   - the layout-plan commit rejects an over-length entity label with a 400;
   - provider-derived instance names (Google, Excel) are clipped to the name limit;
   - `db:create-org --name` rejects one.
5. The agent tools with local Zod (`connector-entity-create/update`, `field-mapping-create/update`, `visualize-d3`, `visualize-map` titles) compose the same builders. The connector-entity tools also gain the key regex the contract already has.
6. Every web form that edits these fields validates with the same rule and shows it inline:
   - the local dialog schemas compose the builders;
   - Create/Edit Station validate `description`;
   - the two inline RegionEditor editors validate.
7. `name-length.guard.test.ts` in core enforces item 2 by field name, with a reasoned exemption map and a minimum-match sanity check.

## Open questions

1. **Does a PATCH that resends an unchanged over-length name fail?** Edit Station always sends `name`, so an existing 10,000-character station couldn't save a description change without shortening the name. **Lean: yes, it fails, and the inline error says why.** Exempting unchanged values would need a read before validation in every route, for rows that only abuse created. No production data holds such rows.
2. **Repair existing over-length rows?** **Lean: no.** The only known instances are local test data. A data migration that truncates names rewrites user content without asking.
3. **Is chat `message` (`SendMessageBodySchema`) in scope?** **Lean: no.** It is prompt text with its own cost and token concerns, not a label. Record it in the guard's exemption map with that reason.
4. **The exact identifier-key bound.** The `c_` prefix plus `_N` suffixes up to two digits gives 63 − 2 − 3 = 58. **Lean: 58**, asserted by a test that builds the longest `sanitizeColumnName` output and checks it fits 63 bytes, so the number is derived, not trusted.
5. **Bytes or characters for names?** Postgres `text` has no byte limit, and the UI counts characters. **Lean: characters** (Zod's `max` counts UTF-16 code units, close enough for a UX cap). Identifier keys are ASCII by regex, so bytes and characters agree there.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because the change is stateless validation.
- **Accuracy & auditability:** N/A because no ledger or state is involved. A 400 is logged like any invalid payload.
- **Failure modes:**
  - Fail closed at the boundary: an over-length value is a 400 naming the field, never a silent truncation. The one exception is clipping provider-derived names we generate ourselves, where rejecting would block a connection the user can't fix.
  - **Lean:** keep the cap out of models and the DB, so a missed path degrades to today's behavior rather than a 500.
- **Scale & unbounded growth:** the point of the ticket. One 4 MB name is multiplied by every list response, SSE payload and agent context that includes it. **Lean:** bound every user-authored label. The every-string guard (D3-B) is the follow-up for the remaining unbounded strings.
- **Multi-tenancy:** a noisy-neighbor vector inside an org (one member degrades every member's lists), not across orgs. **Lean:** the per-field cap is sufficient. No per-tenant setting.
- **Contract stability:** the request contracts tighten, a deliberate breaking change for callers sending over-length values. None exist outside this repo. **Lean:** one shared constant module, so a future enterprise override (a configurable limit) has one seam.
- **Data lifecycle:** N/A because no retention or windows are involved. Existing rows are untouched (open question 2).

## What this doesn't decide

- **Unbounded strings that aren't labels** (SQL, transform code, URLs, filter JSON, body templates, chat messages). The every-string guard is its own ticket.
- **Display truncation:** whether `PageHeader` and breadcrumbs ellipsize long titles. The caps make it moot for new data. Restyling headers is UI work outside this bug.
- **DB-level constraints** (D1-B), as defense in depth later if a non-contract write path keeps reappearing.
- **The 4 MB body limit** itself, which bounds layout plans and uploads and is unrelated to labels.

## Next step

`docs/NAME_LENGTH_LIMITS.spec.md` pins the constants, the builders' messages, the field inventory and the guard's exemption map. `docs/NAME_LENGTH_LIMITS.plan.md` slices it:
1. core constants and builders, plus the guard (red);
2. the contracts adopt the builders (guard green, contract tests);
3. the API's non-contract write sites and agent tools;
4. the web forms and inline editors (dialog tests for the inline error).
