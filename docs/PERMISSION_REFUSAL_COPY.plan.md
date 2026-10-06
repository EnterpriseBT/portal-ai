# Permission refusals and hints name permissions, not roles — Plan

**This plan implements the vocabulary pass over every refusal and hint in TDD order: one `PERMISSION_DENIED` code with a permission-naming message, one web display helper, permission-framed copy, and a guard that keeps role framing out.**

- **Spec:** `docs/PERMISSION_REFUSAL_COPY.spec.md`. **Discovery:** `docs/PERMISSION_REFUSAL_COPY.discovery.md`.
- **Issue:** #711 (epic #684).
- **Builds on:** #708's `JobControlService` (the cancel refusal) and #689's group-member toasts.

There are 4 slices. Each sits behind a green test suite and leaves the repo compilable, and each lands as a **commit on `fix/711-permission-refusal-copy`**.

Run tests from each package; never invoke jest directly.

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
cd packages/core && npm run test:unit
```

Each slice:
1. Write failing tests.
2. Make the smallest change that greens them.
3. Run them.
4. Run `npm run lint && npm run type-check` at the boundary.
5. Move to the next slice.

**Sequencing rationale:**
- **Slice 1** changes the code and the message at their source. It must also teach the web the new code, or stale-permission refetching (`onPermissionDenied`) silently stops recognizing refusals between slices.
- **Slice 2** is display. It needs the slice-1 message to show well.
- **Slice 3** is the remaining wording: help, prompt, route docs and the tool gate.
- **Slice 4** adds the guards, which fail until slices 1–3 have removed every phrase, and the docs.

---

## Slice 1 — One code; messages that name the permission

`PERMISSION_DENIED` and `ORGANIZATION_MISMATCH` replace the four role- and owner-named codes. Every refusal's message comes from `permissionRefusalMessage`, and the web recognizes the new code.

**Files**

- **New:** `apps/api/src/services/permission-refusal.ts`:
  - `PERMISSION_DENIED_FALLBACK`;
  - the phrase and label tables;
  - `permissionRefusalMessage`, `permissionDenied`.
- **New:** `apps/api/src/__tests__/services/permission-refusal.test.ts`, spec cases 1–5.
- **Edit:** `constants/api-codes.constants.ts`: remove the four codes; add `PERMISSION_DENIED` and `ORGANIZATION_MISMATCH`.
- **Edit:** `services/permission-set.ts`: delete `denyCode`/`denyMessage`; `check` throws `permissionDenied(action, object)`. **Touch only those lines** (the file has NUL-byte sentinels at `:212-213`). Edit with a tool that reads and writes it as UTF-8, and confirm `git diff --stat` shows only that hunk.
- **Edit:** `middleware/require-permission.middleware.ts`, `routes/jobs.router.ts:379`, `routes/connector-instance.router.ts:765`.
- **Edit:** `apps/web/src/utils/permission-denied.util.ts`: `PERMISSION_DENIED_CODES = new Set(["PERMISSION_DENIED"])`.
- **Edit tests:**
  - `permission-set.test.ts` (case 6);
  - every api test file asserting an old code (case 9: about 13 + 3 + 2 + 2 files; type-check finds each one, since the enum members are gone);
  - `connector-instance.router.integration.test.ts` (case 10);
  - `nav-object-enforcement.integration.test.ts` (case 11);
  - the middleware's integration coverage (case 12);
  - web `auth-mutation-permission-denied.test.tsx` (case 16).

**Steps**

1. **Tests (spec cases 1–6, 9–12, 16).** Write `permission-refusal.test.ts`. Update the assertions for the new code and messages, add the `ORGANIZATION_MISMATCH` and job-cancel cases, and make the web test drive `PERMISSION_DENIED`. Run; they fail (and the old enum members no longer type-check).
2. **Implement** the new file, the enum change, `check`, the middleware, the two throw sites and the web code set. Green.
3. Run `npm run test:unit` and `npm run test:integration` in `apps/api` (focused on the touched files, then the authorization integration suites), and `npm run test:unit` in `apps/web` for case 16. Then **root** lint, type-check and build (the web and api agree on the code string).

**Done when:**
- cases 1–6, 9–12 and 16 pass;
- no source or test references `INSUFFICIENT_ROLE`, `BILLING_NOT_OWNER`, `ORGANIZATION_NOT_OWNER` or `AUDIT_LOG_NOT_AUTHORIZED`;
- `permission-set.ts`'s diff is only the `check` / deleted-helper hunk.

**Risk:**
- **The NUL-byte file.** Confirm the sentinels survive: run `git diff` on it, and the integration suites that exercise `visibilityPredicate`.
- **The biggest test churn** of the four slices, though it's mechanical.

---

## Slice 2 — Display: `serverErrorMessage`, `FormAlert`, toasts, and web copy

Dialogs and all 15 toasts show the server's permission message the same way. The Views hint and Accept Invitation copy no longer name roles.

**Files**

- **Edit:** `apps/web/src/utils/permission-denied.util.ts`: add `serverErrorMessage`, and fix the `:7-8` comment.
- **Edit:** `components/FormAlert.component.tsx`: the main text is `serverErrorMessage(serverError)`; the caption is `(code)`.
- **Edit:** the 15 toast sites, each keeping its existing fallback string:
  - `MembersTab.component.tsx` (4)
  - `Toolpacks.view.tsx` (2)
  - `EntityGroupDetail.view.tsx` (2)
  - `EntityDetail.view.tsx` (2)
  - `EditLayoutPlan.view.tsx` (3)
  - `ShareDialog.component.tsx` (1)
  - `StationDetail.view.tsx` (1)
- **Edit:** `views/CuratedViews.view.tsx:182`, `views/AcceptInvitation.view.tsx:61, 67, 79`, and the `SubscriptionBilling.component.tsx:78` comment.
- **Edit tests:**
  - `permission-denied.util.test.ts` (case 14);
  - `FormAlert.test.tsx` (case 15);
  - `MembersTab.test.tsx` and `EntityGroupDetailView.test.tsx` (case 17);
  - `CuratedViewsView.test.tsx` (case 18);
  - AcceptInvitation (case 19).

**Steps**

1. **Tests (spec cases 14, 15, 17–19).** Write the `serverErrorMessage` cases: a denial with a message, an empty message, a non-denial, and unknown values. Then:
   - `FormAlert` shows a `PERMISSION_DENIED` message once, with `(PERMISSION_DENIED)`;
   - a denied member action's toast shows the server's message;
   - the new hint and invitation bodies.

   Run; they fail.
2. **Implement** the helper and `FormAlert`, swap the 15 toasts, and change the copy. Green.
3. Run `npm run test:unit` in `apps/web`, then lint and type-check.

**Done when:** cases 14, 15 and 17–19 pass, no `toast.error(` in `apps/web/src` passes a raw `.message`, and no web copy names a role in a hint.

**Risk:** a toast site whose `err` isn't an `ApiError`. `serverErrorMessage` accepts `unknown` and falls back, so read each site's current fallback and keep it.

---

## Slice 3 — Help content, the agent, and route docs

The FAQ and glossary (in the app and on the marketing site), the system prompt, the tool gate's wording, the route JSDoc and the stale comments describe access by permission.

**Files**

- **Edit:** `packages/core/src/content/faq.util.ts:91-93, 194`, `glossary.util.ts:451, 453, 469, 478`.
- **Edit:** `apps/api/src/services/permission-gate.service.ts:157` ("You don't have permission …").
- **Edit:** `apps/api/src/prompts/system.prompt.ts:457, 469, 802`.
- **Edit:** route JSDoc 403s in:
  - `toolpacks.router.ts:348, 508, 648, 750, 852`
  - `billing.router.ts:150, 233`
  - `organization.router.ts:279, 537, 598, 910, 1406, 1463`
  - `role.router.ts:37, 72`, `group.router.ts:39, 69`, `policy.router.ts:37, 71`
  - `rbac-object-search.router.ts:56`

  and the comments at `organization.router.ts:346, 1504`.
- **Edit tests:**
  - `faq.util.test.ts`, `glossary.util.test.ts` (case 21);
  - `permission-gate.service.test.ts` (case 7);
  - `system.prompt.test.ts` (case 8).

**Steps**

1. **Tests (spec cases 7, 8, 21).**
   - The billing, org-delete and boundary help entries contain "permission" and no owner/admin refusal phrasing.
   - The gate's message reads "You don't have permission …", and a relayed 403 carries the permission text.
   - The prompt has no "admin-only", "admin-curated" or "ask their admin".

   Run; they fail.
2. **Implement** the strings, the gate wording, the prompt lines, the JSDoc and the comments. Green.
3. Run `npm run test:unit` in `packages/core` and `apps/api`. Run `npm run build --workspace @portalai/core` so the web, the site and the api see the new content. Then **root** lint, type-check and build (`apps/site` bakes the FAQ).

**Done when:** cases 7, 8 and 21 pass, the root build is green, and the OpenAPI spec (`/api/docs/spec`) has no 403 description naming a role or an old code.

**Risk:** `system.prompt.test.ts` or the glossary pinning tests may pin the exact old wording. Update them to the new strings, never loosen them.

---

## Slice 4 — Guards and docs

Two guards fail CI on a role-framed refusal phrase outside the one allowlisted rule about roles, and the docs state the convention.

**Files**

- **New:** `apps/api/src/__tests__/permission-copy.guard.test.ts`: the `ROLE_FRAMED` list, the UTF-8 file walk, the `{ file, text }` allowlist (seat.service's role-assignment message), and a matcher self-test.
- **New:** `apps/web/src/__tests__/permission-copy.guard.test.ts`: the same list over `apps/web/src` (excluding `__tests__` and `stories`) and `packages/core/src/content`, with an empty allowlist and a self-test.
- **Edit:** `CLAUDE.md` ("API Style Guide → Error codes", "Action Affordances"), `.github/copilot-instructions.md`, `docs/ENTERPRISE_SSO.runbook.md:52`.

**Steps**

1. **Tests (spec cases 13, 20).** Write both guards. They pass on the tree after slices 1–3. To prove they bite, reintroduce "Your role does not permit this action" locally in one file, confirm the matching guard fails and names it, then revert. Don't commit that.
2. **Implement** the docs, per spec § Docs.
3. Run root lint, `npm run lint:doc-pointers`, type-check, the format check, and the full api and web unit suites.

**Done when:** cases 13 and 20 pass, the guards are proven to bite, and CLAUDE.md and its mirror state that a refusal names the permission and a hint names the access needed.

**Risk:** the guard's regex catching legitimate role-subject copy. Discovery found none outside seat.service in the scanned scope. If one appears, add an exact `{ file, text }` allowlist entry with a comment, never a broader pattern.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `PERMISSION_DENIED` / `ORGANIZATION_MISMATCH`; `permissionRefusalMessage`; `check`, middleware, throw sites; web code set | cases 1–6, 9–12, 16; root build |
| 2 | `serverErrorMessage`; `FormAlert`; 15 toasts; Views and invitation copy | cases 14, 15, 17–19 |
| 3 | FAQ and glossary; gate wording; prompt; route JSDoc | cases 7, 8, 21; root build (site) |
| 4 | API and web guards; CLAUDE.md, mirror, runbook | cases 13, 20 |

## Cross-slice notes

- **A breaking API change (slice 1).** Name it in the PR body: the four codes are gone, and `PERMISSION_DENIED` / `ORGANIZATION_MISMATCH` replace them. No in-repo client matches the old codes.
- **The NUL-byte file.** Never `sed` `permission-set.ts`, and never grep it without `-a`. Read and write it as UTF-8 and check `git diff --stat`.
- **Doc surfaces** (CLAUDE.md → "Keeping Documentation in Sync"): the FAQ and glossary are user-facing in two places, the app and the marketing site (slice 3). The system prompt is an agent contract (slice 3). CLAUDE.md, its mirror and the runbook are developer-facing (slice 4).
- **The review chain:**
  - security review: required (the change touches the refusal path of authorization, though no decision changes);
  - smoke: a refused action shows the new message in a dialog and a toast; the help text renders in the app and on the site;
  - adversarial: likely waivable-with-reason, since it's wording only and fail-closed is unchanged.

## Next step

Once discovery, spec and plan are confirmed, implementation begins on this branch: slice 1 first, tests first, one commit per slice.
