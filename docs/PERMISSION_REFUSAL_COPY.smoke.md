# PERMISSION_REFUSAL_COPY — Smoke Suite

Manual smoke test for [#711](https://github.com/EnterpriseBT/portal-ai/issues/711). A permission refusal is now `403 PERMISSION_DENIED`, and its message names the permission ("You don't have permission to manage billing."), never a role. Dialogs and toasts show it the same way, and hints, help, the agent and the API docs say what access is needed. **Branch under test:** `fix/711-permission-refusal-copy` (PR [#712](https://github.com/EnterpriseBT/portal-ai/pull/712)).

Untagged steps can be walked in the browser (`/smoke-walk`). `— manual` needs a human. `— backend` is an API or DB probe outside the browser.

**Acceptance criteria → sections:**
- AC1 (403 `PERMISSION_DENIED` + permission message; no role words except the role-assignment rule) → §1, §2.3
- AC2 (dialog shows the message once with `(PERMISSION_DENIED)`; toast shows the same) → §2
- AC3 (Views hint; Accept Invitation never says "admin") → §3
- AC4 (FAQ and glossary in the app and on the site) → §4
- AC5 (the agent relays a permission-framed refusal; prompt not "admin-only") → §5
- AC6 (cross-org connector create → `ORGANIZATION_MISMATCH`) → §1.5
- AC7 (CI fails on a role-framed phrase) → §6

## Preflight

### Environment

- [ ] `git checkout fix/711-permission-refusal-copy && git pull --ff-only`
- [ ] `npm install`, then `npm run build --workspace @portalai/core` (the FAQ and glossary changed). No migration.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000). For §4.3, also the site (:3002).
- [ ] `npm run --workspace @portalai/e2e e2e:auth:all`, then switch the owner, admin and member into **e2e-fixture** (`POST /api/organization/switch`)

### Fixtures

- [ ] Tokens for curl: the owner's, admin's and member's bearer tokens from their `packages/e2e/.auth/*.storageState.json` localStorage. Written below as `$OWNER`, `$ADMIN`, `$MEMBER`. — backend
- [ ] The member's user id (`GET /api/organization/current` as the member) as `$MEMBER_ID`, and the e2e-fixture org id as `$ORG`. — backend
- [ ] As **owner**, a station **smoke711** in e2e-fixture, shared with the member at **Read & write** (station page → Share).

### Reset between runs

- [ ] Delete the **smoke711** station. Undo any role change from §2.3 (the member keeps only the member role). — backend

## §1 — The API refuses by permission

- [ ] Billing, as member: `curl -s -X POST localhost:3001/api/billing/portal -H "Authorization: Bearer $MEMBER" -H 'Content-Type: application/json' -d '{}' | jq '{code: .code, message: .message}'`. Expected: `{"code":"PERMISSION_DENIED","message":"You don't have permission to manage billing."}` and HTTP 403. — backend
- [ ] Audit log, as member: `curl -s -o /dev/stderr -w '%{http_code}' 'localhost:3001/api/organization/audit-log' -H "Authorization: Bearer $MEMBER"`. Expected: 403, `PERMISSION_DENIED`, "You don't have permission to view the audit log." — backend
- [ ] Org delete, as admin: `curl -s -X DELETE localhost:3001/api/organization/$ORG -H "Authorization: Bearer $ADMIN" | jq '.code, .message'`. Expected: `PERMISSION_DENIED`, "You don't have permission to delete the organization." The org is **not** deleted (`GET /api/organization/current` as owner still returns it). — backend
- [ ] Remove a member, as member: `curl -s -X DELETE localhost:3001/api/organization/members/<admin user id> -H "Authorization: Bearer $MEMBER" | jq '.code, .message'`. Expected: `PERMISSION_DENIED`, "You don't have permission to remove members." The admin is still listed in `GET /api/organization/members`. (Not invite: the e2e member holds `member.invite` — `capabilities["member.invite"]: true` — so an invite succeeds.) — backend
- [ ] Cross-org connector create: as owner, `POST /api/connector-instances` with an `organizationId` that isn't the caller's active org (e.g. a random UUID). Expected: 403 with code `ORGANIZATION_MISMATCH` and "You can only create connector instances in your current organization", not `PERMISSION_DENIED`. — backend
- [ ] None of the responses above contains "role", "owner" or "admin". `GET localhost:3001/api/docs/spec | grep -cE 'INSUFFICIENT_ROLE|BILLING_NOT_OWNER|ORGANIZATION_NOT_OWNER|AUDIT_LOG_NOT_AUTHORIZED'` gives `0`. — backend

## §2 — Dialogs and toasts show the same message

- [ ] As **member**, open the **smoke711** station page. **Edit** is enabled (Read & write share).
- [ ] As **owner**, downgrade the member's share on **smoke711** to **Read** (Share dialog, or the grants API). Leave the member's page open, without reloading.
- [ ] As **member**, on the still-open page, click **Edit**, change the name to "smoke711 renamed" and submit (an unchanged form closes without a request). Expected: the dialog stays open and shows **one** alert reading "You don't have permission to edit this station." with "(PERMISSION_DENIED)" beneath it. No "Your role …" text anywhere. After closing it, the station's affordances refresh and **Edit** is gone (the 403 invalidated the capabilities).
- [ ] As **admin**, open **Settings → Members**, open the member's role menu and try to add **admin**. Expected: an error toast reading "Only the owner can assign or remove the owner or admin role" (the one rule *about* roles, code `MEMBER_ROLE_ASSIGNMENT_RESTRICTED`). The member's roles are unchanged after a reload. If the menu doesn't offer **admin** to the admin, run the same as `PUT /api/organization/members/$MEMBER_ID/roles` with `{"roleSlugs":["member","admin"]}` and check the code and message. — backend

## §3 — Hints and invitation copy

- [ ] As **member**, open **Views**. Hover the disabled **Create View**. Expected tooltip: "Ask for access to create views" (no "owner or admin").
- [ ] As **member**, open **Tags**, **Entity Groups** and **Column Definitions**. Wherever Create is disabled, its tooltip reads "Ask for access to create …" with no role named. The seeded e2e member gets a 403 page on all three (no `view page` grant; its text, "You don't have permission to access this resource.", names no role). To walk the hints, first grant the pages as **owner** in **Settings → Access**: a policy with `allow view page:tags`, `allow view page:entity_groups` and `allow view page:column_definitions`, in a group containing the member. Delete both afterwards.
- [ ] Open `localhost:3000/invitations/accept?token=not-a-real-token` (signed in as member). Expected: the error body says "Ask the person who invited you …", and the page contains neither "admin" nor "owner".

## §4 — Help content, in the app and on the site

- [ ] As **member**, open **Help → FAQ**. The billing entry reads "Anyone with permission to manage billing …"; the delete-organization entry reads "Only someone with permission to delete the organization can delete it …". Neither says "owner".
- [ ] **Help → Glossary**: **Permission Boundary**, **Subscription Plan** and **Billing Portal** describe access by permission, with no "owner" or "admin" framing.
- [ ] On the marketing site (`localhost:3002`, after `npm run build --workspace @portalai/site` or its dev server), the FAQ shows the same two answers. — manual

## §5 — The agent

- [ ] As **member**, in a portal on **smoke711**'s station, prompt: "Create a new column definition called smoke711_col". Expected: the agent does not create it and says why in permission terms (e.g. it can't create column definitions / lacks permission). It never says "admin-only", "ask an admin" or "your role". — manual (LLM wording varies; judge the framing)
- [ ] `grep -cE 'admin-only|admin-curated|ask their admin' apps/api/src/prompts/system.prompt.ts` gives `0`. — backend

## §6 — The guard

- [ ] Append `// Your role does not permit this action` to `apps/web/src/views/Settings.view.tsx`, run `npm run test:unit --workspace @portalai/web -- --testPathPattern permission-copy.guard`. Expected: fails, naming `views/Settings.view.tsx`. Revert the line; the test passes. — backend
- [ ] Same in `apps/api/src/services/permission-refusal.ts` with the API workspace's `test:unit`. Expected: fails naming the file; passes after revert. — backend

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/user/station ids, response body):
