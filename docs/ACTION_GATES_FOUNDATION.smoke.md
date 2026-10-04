# action-gates-foundation — Smoke Suite

Manual smoke test for [#688](https://github.com/EnterpriseBT/portal-ai/issues/688). Per-object `capabilities` on 12 payload types, the core `ActionGate` components (`GatedButton`, gated menus and suites), `decideActionGate` / `useActionGate`, `onPermissionDenied`, and the Views pages as the reference adoption. **Branch under test:** `feat/688-action-gates-foundation` (PR [#696](https://github.com/EnterpriseBT/portal-ai/pull/696), base `epic/per-object-action-affordances`).

Run **§Preflight** once. After that the sections are independent. Steps tagged `— manual` need a human; the rest can be walked by `/smoke-walk`.

---

## Preflight

### Environment

- [ ] `git checkout feat/688-action-gates-foundation && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core`. Core changed (contracts and UI), and web and api read its `dist`. **No migration.**
- [ ] `npm run dev` boots cleanly (API :3001, web :3000). If :3001 is a stale orphan, kill that pid and touch `apps/api/src/index.ts`.
- [ ] `npm run storybook --workspace=packages/core` serves core Storybook on :7006 (for §4).

### Fixtures

- [ ] Sessions exist for **owner** and **member**: `npm run --workspace @portalai/e2e e2e:auth:all`. Then `e2e:seed` (the `e2e-fixture` org).
- [ ] As **owner**, create a view **"Owner Shared"** on any entity, and share it with the member at **Read**.
- [ ] As **owner**, create a view **"Owner Private"**, not shared.
- [ ] A view **"Member Own"** created by the member. The seeded member can read no entity, so it can't create one in the app. Create it as **owner** and set `curated_views.created_by` to the member's user id (`psql`). Its editor will show no columns, since the member can't read the entity.
- [ ] Switching identity for the walk: `npm run --workspace @portalai/e2e e2e:use member`, then close and reopen the browser. Owner is the plain `storageState.json`.

### Reset between runs

- [ ] Delete the three views (as their creators). Nothing else is written.

---

## §1 — Views list: per-row actions (AC 1)

As **member**, go to `http://localhost:3000/views`.

- [ ] Cards **"Owner Shared"** and **"Member Own"** are listed. **"Owner Private"** is not.
- [ ] **"Owner Shared"**: the card shows **no Share and no Delete** action, and no actions trigger (kebab or buttons) at all (AC 3: an all-hidden menu renders no trigger).
- [ ] **"Member Own"**: the card shows **Delete** but **no Share**. Members in this org may not share views (the server refuses: `POST /api/grants` → 403 `INSUFFICIENT_ROLE`), so `capabilities.share` is `false` even on their own view. Their own *station* is shareable; the gate follows the server per type.
- [ ] **Create View** is shown and enabled (the member can create their own views).

As **owner**, on `/views`:

- [ ] All three views are listed, each with Share and Delete.

## §2 — View page: Edit and Delete (AC 1)

As **member**:

- [ ] Open **"Owner Shared"**. The header shows **no Edit and no Delete** button. There's no way to open the editor.
- [ ] Open **"Member Own"**. The header shows **Edit** and **Delete**. Edit opens the editor dialog. Cancel closes it.
- [ ] Go directly to the URL of **"Owner Private"** (copy its id from the owner's session). It shows "View not found" (unchanged #692 behaviour; listed here so the gate can't be mistaken for the boundary).

## §3 — Payloads carry `capabilities` (AC 2)

As **member**, with the browser network panel (or `browser_network_requests`):

- [ ] `GET /api/curated-views?…` on `/views`: each row has `capabilities`. **"Owner Shared"** is `{read:true, write:false, delete:false, share:false}`. **"Member Own"** is `{read:true, write:true, delete:true, share:false}`.
- [ ] `GET /api/curated-views/<Member Own id>`: `curatedView.capabilities` is present and includes `share`.
- [ ] Open a station page: `GET /api/stations/<id>` has `station.capabilities` with `share`, and there are no `canShare` / `canWrite` / `canDelete` fields.
- [ ] Open the Entities list: rows from `GET /api/connector-entities?…` carry `capabilities` with **no** `share` key.
- [ ] Toolpacks page (as **owner**): builtin rows from `GET /api/toolpacks` have `capabilities: {read:true, write:false, delete:false}`.

## §4 — Gate rendering: keyboard, reason and upsell (AC 3)

In core Storybook `http://localhost:7006`, open **Components/GatedButton**:

- [ ] **Disabled** story: Tab to the button. It takes focus (it isn't skipped), and a tooltip shows its reason. Clicking does nothing (the story's action log records no `onClick`).
- [ ] **Upsell** story: the button is enabled with a lock icon. Clicking logs `onUpgrade`, not `onClick`.
- [ ] **Hidden** story renders nothing.
- [ ] Screen-reader read-out of the disabled button: its name stays the label and the reason is announced as its description — manual

In the app:

- [ ] A connector instance with a running job (start a sync on a large instance): its Edit / Modify Layout Plan / Delete menu items are disabled, focusable, and show **"Paused until the running job finishes"** on hover — manual (needs a job that runs long enough to observe)

## §5 — A refused mutation re-renders the affordances (AC 5)

- [ ] As **owner**, share **"Owner Shared"** with the member at **Write**. As **member**, open the view and click Edit. Leave the dialog open. As **owner**, revoke the member's share. As **member**, change the label and Save. The dialog **stays open** and shows a FormAlert with "You don't have permission to perform this action.". After Cancel, the page's **Edit button is gone** (the view refetched with `write:false`) — manual (two live identities)

## §6 — Fail closed and regression sweep (AC 4, AC 6)

- [ ] As **member**, open an entity detail, a record detail and an entity group detail. Their action menus still open, and the transient-state disables ("Deleting…", "Saving changes…") show as disabled-with-reason while that action runs. No menu item is silently dead.
- [ ] As **owner**, the station page's Share / Edit / Delete and a pin's Share / Rename / Delete still render and work as before (the `can*` → `capabilities` migration).

## §7 — Convention and guard (AC 7, AC 8)

- [ ] CI's Unit Tests job ran `action-gate.guard.test.ts` green on PR #696 — backend
- [ ] `CLAUDE.md` has the "Action Affordances & Permissions (apps/web)" section, and `.github/copilot-instructions.md` has the matching paragraph — backend

---

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org / view / station / entity ids, identity):
