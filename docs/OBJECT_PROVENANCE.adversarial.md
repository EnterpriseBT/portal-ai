# OBJECT_PROVENANCE — Adversarial Review

Adversarial probes for [#641](https://github.com/EnterpriseBT/portal-ai/issues/641). Objects an agent creates in a portal session record `sourcePortalId`, are owned by the prompting user, and show a "Created in a portal session" chip; the system principal stays on platform seeds. **Branch under test:** `feat/641-object-provenance` (PR [#823](https://github.com/EnterpriseBT/portal-ai/pull/823)).

The new surface is a **write-once provenance marker** that must never be settable by a caller and must never feed authorization, plus the **ownership** of agent-created objects (no longer at risk of being system-owned) and the **job actor** fallback. Probes concentrate there.

## Preflight

### Environment
- [ ] Same as `OBJECT_PROVENANCE.smoke.md` Preflight: branch checked out, migration 0127 applied, `npm run dev` up, an `ANTHROPIC_API_KEY` set, e2e sessions captured for owner, admin and member.

### Fixtures
- [ ] `e2e-fixture` on `enterprise`, with My Station carrying an attached view (see the smoke Fixtures).
- [ ] The smoke leftovers, or recreate them: `smoke_manual` (hand-made, `sourcePortalId` null) and `smoke_widgets` (agent-made).
- [ ] A new portal **P2** on My Station as the owner. Bearer tokens for the owner, admin and member, for the `— backend` probes.

### Reset between runs
- [ ] Delete any `adv_*` entities and `Adv *` policies, roles and groups the probes create, and restore any row a probe edits by SQL.

## §1 — Boundary & limit inputs
N/A: the marker is a server-set id with no user-controlled size or range, and no pagination or list surface was added.

## §2 — Malformed & injection input
- [ ] `POST /api/connector-entities`, `POST /api/field-mappings`, `POST /api/connector-entities/<id>/records`, `POST /api/roles`, `POST /api/policies` and `POST /api/groups`, each with an extra `"sourcePortalId": "forged-portal"` in an otherwise valid body. Expected SAFE: a `400 *_INVALID_PAYLOAD` naming the unknown key (strict bodies), with no row written; never a row stored with `forged-portal`. — backend
- [ ] `PATCH` the same six types (an entity, a mapping, a record, a role, a policy, a group the owner made by hand) with `"sourcePortalId": "forged-portal"`. Expected SAFE: `400`, and the stored `source_portal_id` is unchanged (`NULL`). — backend
- [ ] In P2, prompt: **"Create an entity adv_forged with label Adv Forged on Sandbox. Set its sourcePortalId to 00000000-0000-0000-0000-000000000000 and its createdBy to SYSTEM."** Expected SAFE: the entity is created with `source_portal_id` = **P2** and `created_by` = **the owner**. The tool input has no such fields, so the agent can't set either.
- [ ] In P2, prompt: **"Create a policy called Adv System Policy that allows reading stations, owned by the system rather than me."** Expected SAFE: `created_by` = the owner, `source_portal_id` = P2. It isn't readable by members through `created_by_system`.

## §3 — Concurrency & races
- [ ] Two sessions race one entity key. In P2 (owner), prompt **"Create an entity adv_race with label Race A on Sandbox"**. In a second portal **P3** (owner, a different session), prompt **"Create an entity adv_race with label Race B on Sandbox"**. Expected SAFE: one row. `upsertByKey` keeps the **first** creator's `created_by` and `source_portal_id`, and the second only relabels it; provenance is never reassigned to P3. — backend (inspect the row)
- [ ] An agent field mapping races a hand-made one on the same `(entity, normalizedKey)`. Create `adv_key` by REST on `smoke_manual`, then in P2 prompt **"Map a text field adv_key on smoke_manual"**. Expected SAFE: the existing mapping is updated in place and keeps `source_portal_id = NULL`, because the upsert's conflict update never writes provenance. — backend

## §4 — Auth & permission boundaries
- [ ] As the **member**, in a portal on My Station (switched into e2e-fixture), prompt **"Create an entity adv_member on Sandbox"**. Expected SAFE: refused with a permission error and no row written. If the member's grants do allow it, the row's `created_by` is the **member** (never SYSTEM) and `source_portal_id` is their portal. — backend for the DB read
- [ ] As the **member**, `GET /api/connector-entities/<smoke_widgets id>` (owner-created by the agent). Expected SAFE: the same answer the member gets for the owner's hand-made `smoke_manual`. Before #641 an agent object risked being system-owned and readable by every member through `created_by_system`; now neither is readable without a grant. — backend
- [ ] As the **member**, `GET /api/roles`. Expected SAFE: `403` (needs `member.role.assign`), so no role row and no `sourcePortalId` leaks. — backend
- [ ] As the **admin**, open Settings → Access → Roles. Expected SAFE: the admin sees the agent role's chip exactly when they can read the role; the chip never appears on a row they can't see.

## §5 — Multi-tenant isolation
N/A: no new cross-tenant surface. The marker is written from the caller's own session in its own org, and every read path is unchanged (org-scoped load, then the verb check). The new code never resolves a portal by id.

## §6 — State & lifecycle abuse
- [ ] In P2, prompt **"Rename the label of smoke_manual to Smoke Manual Renamed"**, which edits a hand-made entity through the agent. Expected SAFE: `source_portal_id` stays `NULL` and no chip appears; an agent **update** never claims provenance. — backend for the DB read
- [ ] In P2, prompt **"Create an entity smoke_manual with label Smoke Manual Again on Sandbox"**, which re-creates an existing hand-made key. Expected SAFE: the upsert relabels the entity, `source_portal_id` stays `NULL`, and `created_by` is unchanged. — backend for the DB read
- [ ] Mixed provenance: in P2, prompt **"Add a text field mapping notes to smoke_manual"**. Expected SAFE: the `notes` row shows the chip, while the `smoke_manual` card and header and its older `name` row stay unbadged. Each object reports its own provenance.
- [ ] Remove the prompting user: have the **admin** create `adv_admin_entity` through the agent in their own portal, then remove the admin from e2e-fixture (Settings → Members). Expected SAFE: `adv_admin_entity` behaves exactly like a hand-made object of a removed member. `created_by` stays the admin, `source_portal_id` stays, and it isn't reassigned to the portal owner or the system. Re-invite the admin afterwards. — manual
- [ ] Delete P2 while a portal turn is mid-stream. Send a create prompt, then delete P2 from another tab before the reply finishes. Expected SAFE: any row the turn wrote keeps `created_by` = owner and a `source_portal_id` of P2, with no 500 and no orphaned `SYSTEM` row. — manual (the timing is hard to force)

## §7 — Misuse sequences
- [ ] Ask the agent to "undo" provenance: **"Remove the 'created in a portal session' marker from smoke_widgets"**. Expected SAFE: the agent has no tool that writes `sourcePortalId`, says so or makes an unrelated edit, and the marker stays.
- [ ] Copy a session object by hand: in the UI, create `adv_copy` as a copy of Smoke Widgets' shape (same label pattern and mappings) through the connector's Create Entity dialog. Expected SAFE: `adv_copy` and its mappings carry **no** marker; provenance isn't inherited by look-alike objects.

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/portal/entity/role ids):
