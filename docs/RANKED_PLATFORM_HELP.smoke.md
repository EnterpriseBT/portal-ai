# ranked-platform-help — Smoke Suite

Manual smoke test for [#1049](https://github.com/EnterpriseBT/portal-ai/issues/1049):
- `platform_help` ranks FAQ, glossary and troubleshooting entries, and answers with a `help` block quoting them exactly;
- Help gets a Troubleshooting tab, and its search uses the same ranking.

**Branch under test:** `feat/1049-ranked-platform-help` (PR [#1098](https://github.com/EnterpriseBT/portal-ai/pull/1098)).

Run **§Preflight** once; after that the sections are independent.
- **Untagged steps** are browser steps `/smoke-walk` can drive.
- **`— backend`** steps are DB reads or CLI commands.
- **`— manual`** steps need a human.

## Preflight

### Environment

- [ ] `git checkout feat/1049-ranked-platform-help && git pull --ff-only`
- [ ] `npm install && npm run build --workspace @portalai/core`. Core's content and contracts changed. There's **no migration**.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). Restart the API after the core build: nodemon watches `apps/api/src` only.

### Fixtures

| Alias | What |
|---|---|
| **qa** | `qa@portalsai.io`, the e2e owner, signed in through the e2e storageState. |
| **Help org** | "Smoke 1049", created for this walk: `npx portalai org create --name "Smoke 1049" --owner-email qa@portalsai.io --env local --yes --json`. Since #1044, its Administrate and Playground stations start with the Help pack. Switch qa into it. — backend |

### Reset between runs

- [ ] Delete the Help org (`npx portalai org delete <id> --env local --yes`), and switch qa back to "My Organization". — backend

## §1 — A help block in the portal (slices 4–5)

On the Help org's **Playground**, open a portal for each question.

- [ ] Ask *"How do I bring in a spreadsheet?"*.
  - The reply has a **help block**, a region named "Help: How do I bring in a spreadsheet?".
  - Its first entry, labelled FAQ, is **"How do I connect my first data source?"**, with its answer and "Open in Help".
  - The block is the whole reply: the assistant writes no text before or after it.
- [ ] The stored message has a `help` block whose first entry's `body` equals that FAQ's answer exactly: `select blocks from portal_messages where portal_id='<id>' and role='assistant'`, compared with `FAQ_ENTRIES` in `faq.util.ts`. — backend
- [ ] Ask *"What is a portal?"*. The block leads with the glossary entry **Portal**.
- [ ] Ask *"my sync failed"*. The block leads with the troubleshooting entry **"A sync or import job failed"**, showing "Why it happens: …" and "What to do: …".
- [ ] Ask *"What's the weather in Paris?"*. The block says **"No help entry covers this."** with "Browse Help", and the assistant doesn't answer the question itself.
- [ ] In the first portal, click **"Open in Help"**. Help opens on the FAQ tab with "How do I connect my first data source?" expanded.
- [ ] Reload the first portal. The help block still renders, from the stored message.

## §2 — The Help page (slices 2–3)

- [ ] Open Help → **Troubleshooting**. It lists six entries, and expanding one shows "Why it happens", "What to do" and "Related" links.
- [ ] Open `/help?tab=troubleshooting#troubleshooting-entry-actions-are-paused-because-a-job-is-running`. The tab opens with that entry expanded.
- [ ] In "A sync or import job failed", click the related **"Why did my job fail?"**. The FAQ tab opens with that entry expanded.
- [ ] On the FAQ tab, search *"How do I bring in a spreadsheet?"*. The first entry listed is "How do I connect my first data source?", the same as the portal.
- [ ] On the Glossary tab, type *"connec"*. The list still narrows to the connector entries while the word is incomplete.

## §3 — Without the Help pack (unchanged)

- [ ] In qa's original org ("My Organization", whose Playground has no Help pack), open a portal on Playground and ask *"What is a tool pack?"*. The reply says to attach the Help tool pack, with **no** help block.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (exact prompt / click): · Identifiers (org / station / portal ids):
