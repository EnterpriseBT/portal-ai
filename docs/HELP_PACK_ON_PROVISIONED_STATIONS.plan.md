# Help pack on the provisioned stations — Plan

**The plan implements the spec in TDD order:**
1. Provisioning and the prompt pin (api).
2. The empty portal conversation (web).
3. Content and docs (core, Getting Started, READMEs, the runbook).

Spec: `docs/HELP_PACK_ON_PROVISIONED_STATIONS.spec.md`. Discovery: `docs/HELP_PACK_ON_PROVISIONED_STATIONS.discovery.md`. Issue: #1044. Builds on the shipped `help` pack (#1050) and provisioned stations (#848).

There are three slices. Each sits behind a green suite and leaves the repo compilable. They land as **commits on `feat/1044-help-pack-on-provisioned-stations`** (PR #1095), per `CLAUDE.md` → "Phase = commit, not PR".

Run tests from each package with the npm scripts, never jest directly:

```bash
cd apps/api && npm run test:unit -- --testPathPattern '<files>'
cd apps/api && npm run test:integration -- --testPathPattern '<files>'
cd apps/web && npm run test:unit -- --testPathPattern '<files>'
cd packages/core && npm run test:unit -- --testPathPattern '<files>'
```

Each slice:
1. Write the failing tests.
2. Make the smallest change that greens them.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` for the touched packages.
5. Push.

**Sequencing rationale:**
- **Slice 1** is the behaviour change itself: new orgs get Help. Everything else describes it.
- **Slice 2** is independent of slice 1, since the empty state reads whatever the station carries. It follows slice 1 so the walk has real Help stations to look at.
- **Slice 3** is wording only, after the behaviour is in.

---

## Slice 1 — Provisioning and the prompt pin (api)

**Files**

- Edit `apps/api/src/constants/provisioned-stations.constants.ts`: `help` in both `builtinSlugs`, both descriptions per the spec table, and the docblock.
- Edit `apps/api/src/services/application.service.ts`: the `provisionOrganizationWorkspace` docblock's station summary (`:878-880`).
- Edit `apps/api/src/__tests__/constants/provisioned-stations.constants.test.ts`.
- Edit `apps/api/src/__tests__/prompts/system.prompt.test.ts`.
- Edit `apps/api/src/__tests__/__integration__/services/provisioned-stations.integration.test.ts`.

**Steps**

1. **Tests:**
   - the exact list carries `help` on both (edit);
   - Administrate's exact description (edit), and Playground's exact description (new);
   - the prompt case looping `PROVISIONED_STATIONS`: `## Help` present and "are the Help pack's" absent (new). It passes before the change too, since neither station has help yet so `## Help` would be absent; the point is to pin it after;
   - integration: the narrowed-tier effective list includes `help` (edit), and both stations' effective packs include `help` on a tier lacking it (new).

   Run them; the constant, description and integration cases fail.
2. **Implement** the constant and docblocks. Green.
3. **Focused runs:**
   - unit: the two test files;
   - integration: `provisioned-stations`, plus the constant-driven `application.service` and `reset.service` suites to confirm they follow without edits.
4. Lint and type-check (api).

**Done when:** a newly provisioned org's stations carry `help`, and every pinned test agrees.

**Risk:** another test pinning a provisioned pack list surfaces in CI. Fix it in this slice.

---

## Slice 2 — The empty portal conversation (web)

**Files**

- Edit `apps/web/src/components/PortalSession.component.tsx`:
  - `PortalSessionEmptyState({ helpAvailable })` with the new body, the Help line and the Getting Started link;
  - `helpAvailable?` on `MessageListProps` and `PortalSessionUIProps`, threaded through;
  - the container derives it from `usePortalStation`.
- Edit `apps/web/src/__tests__/PortalSession.test.tsx`.

**Steps**

1. **Tests (spec web cases, 7):**
   - the new body with no Help line by default;
   - with `helpAvailable`, the Help line and the Getting Started link (href `/help?tab=faq&category=getting-started`);
   - without it, neither;
   - the Analytics link unchanged;
   - axe on the empty state with `helpAvailable`;
   - the container shows the line when `stations.get` returns a station whose `enabledToolpacks` includes `help`, and not when they don't or on a station error.

   For the container cases, the file's sdk mock `stations.get` becomes per-test configurable (today it returns an error). Run them; they fail.
2. **Implement.** Green.
3. **Focused run:** `PortalSession.test.tsx`, plus `PortalView.gates.test.tsx` (it also mocks `stations.get`) and `component-axe.guard.test.ts`.
4. Lint and type-check (web).

**Done when:** every station's empty state shows the new body, and a Help station also shows the Help line, decided from the station already loaded.

**Risk:** the inline `PortalSessionEmptyState` and `MessageList` predate the Component File Policy. This slice only adds a prop to them and doesn't refactor them out, to keep the change narrow.

---

## Slice 3 — Content and docs

**Files**

- Edit `packages/core/src/content/glossary.util.ts` (Station) and `faq.util.ts` (the station explainer).
- Edit `apps/web/src/utils/getting-started.util.ts` ("Create a station").
- Edit the tests `packages/core/src/__tests__/content/glossary.util.test.ts`, `faq.util.test.ts` and `apps/web/src/__tests__/getting-started.util.test.ts`.
- Edit `packages/e2e/README.md:64`, `apps/api/src/db/seed-org.ts` (docblock), `apps/api/src/services/demo-seed.service.ts:351` (docblock) and `docs/DEMO_ORG.runbook.md:142`.

**Steps**

1. **Tests:**
   - glossary: Station names the Help pack on both (edit);
   - FAQ: the exact station sentence (edit);
   - Getting Started: the exact description (edit).

   Run them; they fail.
2. **Implement** the copy, then the docs and docblocks.
3. **Focused runs:** core content tests and web getting-started. Rebuild core (`npm run build --workspace @portalai/core`) before the web run, since web's tests read core's dist for content.
4. Lint, type-check, `npm run lint:doc-pointers`, and the permission-copy guards (they scan core content and durable docs).

**Done when:** every surface that lists the provisioned stations' packs names Help.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | `help` on both provisioned stations; new descriptions; prompt pin | api unit + provisioned-stations integration |
| 2 | Empty state: generic body; Help line when the station has the pack | web PortalSession tests + axe |
| 3 | Glossary, FAQ, Getting Started, READMEs, runbook | core + web content tests; doc and copy guards |

## Cross-slice notes

- **Core change → full root build before pushing** (per the memory note on core model changes). Slice 3 changes core content, which web reads.
- **No migration.** Provisioning runs only for new and reset orgs, so local smoke needs a freshly created org (`portalai org create --env local`) or an org reset.
- **Docs sync** is slice 3, which covers the PRD's list. `CLAUDE.md` and the admin-cli docs don't list the packs, so they're unchanged.

## Next step

Once this plan is confirmed, implementation starts on this branch with slice 1, tests first, one commit per slice.
