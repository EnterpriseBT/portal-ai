# group-member-editing — Adversarial Review

Adversarial probes for [#637](https://github.com/EnterpriseBT/portal-ai/issues/637) — the `GET /api/groups/:id/members` read (org-membership-gated, org-scoped) + the dialog's seed/save-on-edit. **Branch under test:** `fix/637-group-member-editing` (PR [#639](https://github.com/EnterpriseBT/portal-ai/pull/639)).

Where smoke asks "do the criteria hold?", this asks "how does it break?". Each probe names the hostile action **and** the expected SAFE behavior — `verified` means the safe behavior was observed; a `mismatch` is a finding. You never check a box.

## Preflight

### Environment
- [ ] `git checkout fix/637-group-member-editing && git pull --ff-only && npm install`
- [ ] `npx turbo run build --filter=@portalai/core` (new `GroupMembersResponse` export). No migration.
- [ ] `npm run dev` (API :3001, web :3000)

### Fixtures
- [ ] A `customRbac` org with an **owner/admin** and a plain **member**; a group with ≥1 member. A **second org** with its own group (for cross-tenant probes). An authed request tool (browser network tab, or an authed `curl` with a member and an owner token).

### Reset between runs
- [ ] §6/§7 mutate membership — delete created groups / re-seed (`e2e:seed`) between runs.

## §1 — Boundary & limit inputs — `— backend`
- [ ] **Empty group.** `GET /api/groups/<empty-group-id>/members`. — SAFE: `200 { "userIds": [] }`, not an error.
- [ ] **Large group (the scale premise).** A group with a few hundred members. — SAFE: returns all ids in one response (no pagination yet — a *conscious* deferral), and the group **list** (`GET /api/groups`) is unaffected (no member ids on `GroupView`, `memberCount` only).

## §2 — Malformed & injection input — `— backend`
- [ ] **Junk / non-existent group id.** `GET /api/groups/not-a-real-id/members` and `…/'; DROP TABLE user_group;--/members`. — SAFE: **404** (org-scoped `load` miss), no 500, no SQL execution (Drizzle-parameterized), nothing leaked.

## §3 — Concurrency & races
- [ ] **N/A** — the read is stateless; membership save is a diff-based **full-set replace** (`setGroupMembers`), so two concurrent group edits are last-writer-wins with no check-then-act the change introduces. The one race that mattered (save-before-seed) is a **lifecycle** probe in §6, now guarded.

## §4 — Auth & permission boundaries
- [ ] **Plain member reads a group's members.** As a **member** (no `member.role.assign`, org may lack customRbac), `GET /api/groups/<id>/members`. — SAFE: **200** with the ids — this is the intended members-read gate (org membership), no more than the roster the member can already read. `— backend`
- [ ] **Members-read is NOT the authoring gate.** As that same member, `GET /api/groups/<id>` (detail) and `PUT /api/groups/<id>/members`. — SAFE: those stay **403** (customRbac + `member.role.assign`), only the members **read** is member-open. `— backend`
- [ ] **Disabled Save driven anyway.** In the editor, with the members query still loading, try to submit (Enter in the form / scripted click). — SAFE: no membership write fires — `handleSubmit` skips `setMembers` until the roster seeded, so nothing is wiped. `— manual` (timing)

## §5 — Multi-tenant isolation — `— backend`
- [ ] **Cross-org group id.** As **org-A** member, `GET /api/groups/<org-B-group-id>/members`. — SAFE: **404** (never org-B's member ids); the org-scope `load` runs before the read.
- [ ] **Cross-org member never seeds.** A group's roster only ever contains its own org's users (enforced at write by `assertMembers`); reading returns no foreign user ids. — SAFE: no cross-tenant identifiers in any response.

## §6 — State & lifecycle abuse
- [ ] **Soft-deleted group.** Delete a group, then `GET /api/groups/<deleted-id>/members`. — SAFE: **404** (base repo excludes `deleted`); no tombstoned roster returned. `— backend`
- [ ] **Removed member vanishes from the roster (the cascade).** Add member M to a group; remove M from the org (Settings → Members). Re-open the group / `GET …/members`. — SAFE: M is **absent** (no stale id), and the group's next edit **saves without** `RBAC_GRANTEE_NOT_MEMBER`. `— manual` (+ backend to confirm the read)
- [ ] **Save before the roster seeds (the wipe attempt).** Edit a group with members; with the members still loading (throttle) or after forcing the read to 500, save. — SAFE: membership is **untouched** (not wiped to `[]`); on a load error the dialog says so and only the name/policy update lands. `— manual` (fault injection)

## §7 — Misuse sequences
- [ ] **Open-edit-open churn.** Rapidly open a group for edit, close before it seeds, re-open. — SAFE: each open re-seeds from a fresh fetch (a `seededRef` reset per open); no stale/leaked member set from the previous open. `— manual`

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] ________ (date + name) — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org / group / member ids):
