# One zod for the AI SDK — Condensed design (#846)

**Issue:** [EnterpriseBT/portal-ai#846](https://github.com/EnterpriseBT/portal-ai/issues/846) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The AI SDK validates a model's tool call against the tool's `inputSchema` before `execute` runs, using zod 3.25.76's bundled `zod/v4` core rather than the zod 4.6.x our schemas were built with. Under that mismatch:
- a failed `.refine` leaves the schema object on the issue, so the agent gets a schema dump (529 characters for a one-line reason);
- when the schema holds the recursive `FilterExpressionSchema`, reading `error.message` throws `Converting circular structure to JSON`.

#645 worked around it in two tools. This ticket removes the cause by making the SDK resolve the same zod as the app. Touches the root `package.json` and lockfile, plus `apps/api` (the workaround reverted, and a guard test).

## Current shape

| Piece | Location | Note |
|---|---|---|
| SDK validation | `node_modules/@ai-sdk/provider-utils/dist/index.mjs:2427` `zod4Schema` → `z4.safeParseAsync` (`:2441`) | resolves whichever `zod` sits beside it |
| Who needs zod 3 | `@tanstack/router-generator`, `@tanstack/router-plugin` (`dependencies.zod: ^3.24.2`) | the reason npm hoists 3.25.76 to the root |
| AI SDK's zod | `ai`, `@ai-sdk/provider-utils`, `@ai-sdk/anthropic`, `@ai-sdk/gateway`: **peer** `^3.25.76 \|\| ^4.1.8` (not a pinned dependency, as the issue guessed) | a peer resolves to the root copy, 3.25.76 |
| Our zod | every workspace: `zod ^4.3.6`, so nested 4.6.1 under `apps/api` and `packages/core` | two copies at runtime |
| #645 workaround | `apps/api/src/tools/curated-views/curated-view-{create,update}.tool.ts`: refine-free `InputSchema`, refines in `execute` via `CheckedSchema` | pinned by `__tests__/tools/curated-views/curated-view-tools.test.ts:404-482` ("passes the SDK and is refused in execute") |
| Prod image | `apps/api/Dockerfile:45` `npm ci --omit=dev`, then `:81` copies `apps/api/node_modules` over the root `node_modules` | today that copy mixes 4.6.1's files over 3.25.76's in `node_modules/zod` |

Repro (`apps/api`, `asSchema(...).validate`): before, issue keys are `code,path,schema,message`, the message is 529 characters, and the recursive case throws.

## Decision — move zod 4 to the root, rather than overriding it

- **A. `overrides: { zod: ^4.3.6 }` (rejected, tried).** It dedupes the SDK but also forces TanStack's router generator onto 4. `apps/web` then fails `vite build` with `z.function(...).returns is not a function`.
- **B. Root `devDependencies: { zod: ^4.3.6 }` (chosen, verified).** npm then hoists 4.6.7 to the root, which the AI SDK peers, `drizzle-zod` and every workspace resolve. TanStack keeps a nested, dev-only 3.25.76. The lockfile marks root `zod@4.6.7` prod, so the image (`--omit=dev`) ships it, and the Dockerfile overlay no longer mixes versions.
  - Repro after: keys `code,path,message`, a 93-character message, and the recursive case prints "both filter modes".
  - `npm run build`, `type-check`, `lint` and all 8 unit suites pass (zod moves 4.6.1 → 4.6.7, a patch).
- **C. A shared refine-free helper (the issue's direction 2) (rejected).** It treats the symptom in every tool and keeps two zods at runtime.

**Revert #645's split:** with one zod, the refines go back on the schema the model sees. Refusals arrive before `execute`, readable, as the SDK's typed input error, and the per-tool duplicate schemas go.

**Guard (direction 3):** `ai-sdk-zod.guard.test.ts` asserts that `zod` resolved from `@ai-sdk/provider-utils` is the **same file** as `apps/api`'s, the root cause, and that a refusal through `asSchema` from real tools (`FieldMappingUpdateTool`, and `CuratedViewCreateTool` with its recursive filter) has no `schema` key and a printable message. A future lockfile re-hoist fails CI instead of the agent.

## Plan — 2 slices

**Slice 1: one zod + guard.**
- Edit root `package.json` and `package-lock.json`.
- New `apps/api/src/__tests__/ai-sdk-zod.guard.test.ts`.
- Tests: `npm run test:unit --workspace @portalai/api -- --testPathPattern ai-sdk-zod`. It fails before the edit (resolution differs, schema key present) and passes after. Then root `npm run build`, `type-check` and `lint`, and every workspace's `test:unit`.

**Slice 2: revert the #645 workaround.**
- Edit `curated-view-create.tool.ts` and `curated-view-update.tool.ts`: one schema with its refines, no `CheckedSchema`.
- Edit `curated-view-tools.test.ts:455-481`: the four cases flip to "refused by the SDK with the refine's message, no schema key".
- Tests: `npm run test:unit --workspace @portalai/api -- --testPathPattern curated-view|ai-sdk-zod`.

## Smoke (manual, against your dev stack)

1. `npm install`, then `npm ls zod`: the root is 4.6.x, `apps/api` and `packages/core` have no nested copy, and only `@tanstack/router-*` hold 3.25.76.
2. `npm run dev`. In a portal on a station with the Curated Views pack, prompt: **"Create a view on <entity> with both a structured filter and the SQL filter `amount > 10`."** The agent relays "set filter or filterSql, not both" (or similar refine text), not "Type validation failed" or "circular structure".
3. Same portal: **"Rename field mapping <key> to c_total."** The agent relays the `c_` prefix refusal in one line, with no schema dump in the tool result (open the tool-call panel).
4. `npm run build --workspace @portalai/web` passes (TanStack's generator still on zod 3).

## Out of scope

- Upgrading TanStack's router packages to a zod-4 generator (they'd let the nested 3.x go; that's a separate dependency bump).
- Tightening any tool's refine messages: the wording is unchanged and simply arrives intact.
