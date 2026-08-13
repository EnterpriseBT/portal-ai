# assistant_help_tool — Smoke Suite

Manual smoke test for [#367](https://github.com/EnterpriseBT/portal-ai/issues/367) — the `platform_help` system tool the agent routes platform questions to. Covers routing in both directions, the station-specific answers, free-immunity, tier-immunity, the Help links, and the pack-less station that used to fail outright.

**Branch under test:** `feat/assistant-help-tool` — child of epic [#364](https://github.com/EnterpriseBT/portal-ai/issues/364), **PR base `epic/portal-guidance`, not `main`**. PR not yet opened when this doc was written; add the link when it is.

**This walkthrough is mostly conversation.** You are judging whether the agent reaches for the right tool and whether the answer it relays is true of the app in front of you. Read the replies as a user would, not as the author of the copy.

> **The premise changed during discovery.** There is **no `/help` command** — typing `/help` is just an ordinary message now. If you find yourself wanting to type it, that instinct is what §1 is testing: ask the question in plain language instead.

Run **§Preflight** once; sections are independent after that. Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/assistant-help-tool && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=packages/core` — the capability registry, the phase label, and `buildHelpUrl` all live in core, and the API resolves it through `dist/`. **A stale build means the tool isn't registered and every section below is meaningless.**
- [ ] **No migration.** No schema change, no seed, no new table.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`).
- [ ] Watch the API log during the walkthrough — tool calls and the `platform-help-tool` warn line are visible there.

### Fixtures

| Alias | Shape | Used by |
|---|---|---|
| **healthy** | A station with a connector instance, entities, **imported records**, and at least the data-query pack enabled | §1, §2, §5, §6 |
| **empty-records** | A station whose entities exist but have **zero** records (create the entity/connector, don't sync — or sync a source with no rows) | §3 |
| **no-sources** | A station with a tool pack enabled but **no connector instance** attached | §3 |
| **no-packs** | A station with **no tool packs enabled at all** — the case that used to fail | §4 |

Create the last three as throwaway stations; nothing is written by this feature.

### Reset between runs

- [ ] No reset needed — the tool is read-only and writes nothing. Start a fresh portal session per section so earlier answers aren't in context.

---

## §1 — Routing: does the agent reach for it? (the design's central risk)

There is no trigger, so this is the thing that can genuinely fail. On **healthy**, open a new portal session for each prompt.

- [ ] Ask: **"what can I do here?"** → the reply is platform orientation (what a portal is, how to ask), not a data answer and not "I don't have a tool for that". In the API log or the tool-activity strip, confirm the call was `platform_help` ("Looking up help").
- [ ] Ask: **"why are my answers empty?"** → routes to `platform_help`.
- [ ] Ask: **"what's a tool pack?"** → routes to `platform_help`, and the answer quotes the glossary/FAQ wording rather than improvising.
- [ ] Ask: **"how do I get better answers out of this?"** → routes to `platform_help`.
- [ ] **The other direction.** Ask a real data question against your records — e.g. **"how many orders are there?"** → the agent uses a **data tool** (`sql_query` or similar), *not* `platform_help`. A help tool answering a data question is as much a bug as the reverse.
- [ ] Ask something ambiguous on purpose — **"why is this empty?"** right after a query returned no rows. Note which tool it picks and whether the answer is useful. There is no single right answer here; record what happened.
- [ ] **If any of the first four misroute:** that is a real finding. File it. The fix is a description/prompt rewrite — **not** adding a `/help` command, which is the premise this ticket deliberately dropped.

## §2 — A follow-up is just another question

The reason the directive was dropped. On **healthy**:

- [ ] Ask **"what can I do here?"**, read the answer, then ask a plain follow-up: **"so how do I bring in my data?"**
- [ ] The follow-up is answered the same way — the agent can reach `platform_help` again. You never have to repeat a trigger.
- [ ] Ask a third, unrelated data question in the same session → it routes to a data tool. Help mode is not sticky, because there is no mode.

## §3 — Station-specific answers (the flagship case)

- [ ] On **empty-records**, ask: **"why are my answers empty?"** → the answer **names that specific condition** — entities exist but no records have been imported — and points at running a sync. It must not be a generic definition of a portal.
- [ ] On **no-sources**, ask the same question → the answer says there is no connected source yet and tells you to connect one. Different situation, different answer.
- [ ] On **healthy**, ask the same question → you get general orientation, *not* the empty-records answer. (The situations are ordered; a healthy station falls through to the default.)
- [ ] If your org has a plan-excluded pack attached to a station, ask **"why can't I use X?"** → the answer says the plan doesn't include it, and does **not** imply the feature doesn't exist.

## §4 — A pack-less station opens instead of failing (the behavior change)

This is the one pre-existing bug the ticket fixes. Before this branch, a station with no packs failed the whole session.

- [ ] On **no-packs**, open a portal session → it opens. No error banner, no failed stream.
- [ ] Ask **"what can I do here?"** → you get an answer explaining that no tool packs are attached and what to do about it.
- [ ] Confirm the session is genuinely usable: ask **"what time is it?"** → `current_time` answers. (Before this change, that tool was unavailable too — the throw fired before any system tool was attached.)
- [ ] Ask a data question on that station → the agent explains it can't query without a pack, rather than crashing.

## §5 — Cost and tier immunity

- [ ] Ask a `platform_help` question, then open **Settings → Organization** and confirm the usage figures **did not move**. Help is `free` — never charged.
- [ ] If you can arrange an exhausted quota (or temporarily lower the tier's allocation via `portalops`), ask a help question again → **it still answers**. Free is immune to the gate even under an exhausted quota.
- [ ] On a tier whose `builtinToolpacks` allowlist is narrow, confirm help still works. It is a system tool, so no tier can remove it.

## §6 — The answer itself

- [ ] The reply reads as the tool's text, not a paraphrase — the agent relays rather than rewrites. If it summarizes the answer away or adds product claims of its own, that is a finding.
- [ ] Help links appear in the reply and are addressable: click one → it lands on the **right Help tab and category** (e.g. FAQ → Analytics & Portals), not the Getting Started default.
- [ ] A link with an entry anchor opens that entry **expanded and scrolled to** (the #365 behavior this depends on).
- [ ] The answer does not claim capabilities the app doesn't have. Spot-check one factual claim against the running app.
- [ ] Nothing renders as literal markup (stray `**`, backticks) in the chat reply.

## §7 — Resilience

- [ ] While the API is running, ask a help question on a station id that no longer exists (or stop the DB briefly, if that's easy in your setup) → the agent still returns a general answer with a note that station details were unavailable. **The session must not error.**
- [ ] Confirm the API log carries the `platform_help could not read station state` warn line for that case.
- [ ] Ask a help question on a station with a **large** entity → the answer comes back promptly; it counts records with one aggregate rather than scanning rows.

## §8 — Not manually verifiable (recorded, not skipped)

The spec's first criterion — all cases pass, `lint` / `type-check` / `format:check` clean — is a **CI assertion**. Confirm CI is green on the PR; that plus your sign-off is the merge gate.

Also recorded: unit tests pin the *inputs* to routing (the tool description, the prompt section, the tool reaching `streamText`). **Routing behavior itself is only observable here, in §1** — that is why §1 leads.

---

## Sign-off checklist

- [ ] §1 (routing) — product questions reach `platform_help`; a data question does not.
- [ ] §2 (follow-ups) — no trigger to repeat; help is not a mode.
- [ ] §3 (station-specific) — empty-records, no-sources, healthy, and plan-excluded each get their own answer.
- [ ] §4 (pack-less station) — opens and is usable instead of failing.
- [ ] §5 (immunity) — not charged, answers under an exhausted quota, present on every tier.
- [ ] §6 (answer quality) — relayed not rewritten, links land correctly, claims are true.
- [ ] §7 (resilience) — a station-read failure degrades instead of erroring.
- [ ] CI green on the PR (§8).
- [ ] `<date>` — `<name>` — walked against my own running stack.

After every box is ticked: report ready-to-merge in the PR thread (base `epic/portal-guidance`), or file follow-up bugs. **This is the epic's last child** — once it merges, the close-out PR to `main` carries `Closes #364` plus all three children.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says should happen>
**Got:** <the agent transcript — include which tool was called>
**Repro:** <exact prompt + which fixture station>
**Station / org id:** <from the URL or db:studio>
```
