# Portal temporal grounding — Discovery

**Issue:** [EnterpriseBT/portal-ai#90](https://github.com/EnterpriseBT/portal-ai/issues/90)

**Why this exists.** Inside a portal session the agent has no idea what day, hour, or timezone it is. Prompting "add a todo for **this Friday**" produces an invented date — the LLM resolves relative time expressions against its training cutoff, which is months stale. The same hole shows up for "tomorrow", "next week", "end of month", "in 3 days", and anywhere else the user expects the agent to write a `date` or `datetime` cell into an entity.

This is the system-prompt section that anchors the agent in real wall-clock time.

## The current shape

### System prompt builder

`buildSystemPrompt()` in `apps/api/src/prompts/system.prompt.ts:48` accumulates a multi-section prompt from `StationContext`. The sections are appended in this order:

| Section | Header line | Gate |
|---|---|---|
| Available Data | `system.prompt.ts:52` | `entities.length > 0` |
| Cross-Entity Relationships | `system.prompt.ts:83` | `entityGroups.length > 0` |
| Entity Management Notes | `system.prompt.ts:105` | `toolPacks.includes("entity_management")` |
| SQL Guidance + Schema Introspection + Creating a new entity | `system.prompt.ts:148` | `toolPacks.includes("data_query")` |
| Available Connector Instances | `system.prompt.ts:272` | entity-management on, instances non-empty |
| Response Style | `system.prompt.ts:289` | always |

No section today injects current-date / current-time / timezone. A `grep -ni "date\|today\|now\|timezone"` over `system.prompt.ts` returns only code comments.

### Portal session entry point

`POST /api/portals` is handled by `apps/api/src/routes/portal.router.ts:88`. The route pulls `stationId` from the body, `organizationId` + `userId` from auth metadata (`portal.router.ts:100–101`), and delegates to `PortalService.createPortal()` (`apps/api/src/services/portal.service.ts:240`). That method:

1. Loads the station via `AnalyticsService.loadStation` (`portal.service.ts:292–295`).
2. Resolves entity capabilities when entity-management is on (`portal.service.ts:296–298`).
3. Loads connector instances via `loadConnectorInstanceContexts(stationId)` (`portal.service.ts:306–309`, helper at `portal.service.ts:852–891`).
4. Assembles the `StationContext` (`portal.service.ts:311–319`) — `stationId`, `stationName`, `entities`, `entityGroups`, `toolPacks`, `entityCapabilities?`, `connectorInstances?`.

The `StationContext` is what `buildSystemPrompt()` consumes — adding a new field here is the standard extension point.

### Timezone in the data model

| Table | Has timezone? | Citation |
|---|---|---|
| `organizations` | **Yes**, `text("timezone").notNull()` | `apps/api/src/db/schema/organizations.table.ts:11` |
| `users` | No | `apps/api/src/db/schema/users.table.ts:10–17` |
| `stations` | No | `apps/api/src/db/schema/stations.table.ts:13–20` |

Org-level timezone is mandatory and already loaded as part of org context. User- and station-level timezone do not exist.

### Existing session-start context precedent

`loadConnectorInstanceContexts` (`portal.service.ts:852–891`) is the canonical pattern for "static-per-session context to inject into the prompt": fetch once at `createPortal`, narrow to a safe projection, hang off `StationContext`, render conditionally in `buildSystemPrompt`. The temporal section follows the same shape — load org timezone + capture server clock at session start, attach to context, render unconditionally.

### Tool registry

Tools register through `apps/api/src/services/tools.service.ts:208–216` (region) and are assembled per station by `ToolService.buildAnalyticsTools()` (220+). Each tool is a class with a `build(stationId, organizationId, userId)` method that returns a Vercel AI SDK `tool()` with `description`, `inputSchema` (Zod), and `execute`. A `get_current_time` tool would slot in the same way.

### Date / datetime values today

`column-definitions.table.ts:12–23` defines `date` and `datetime` as first-class column types. `EntityRecordCreateTool.InputSchema` (`apps/api/src/tools/entity-record-create.tool.ts:29–33`) accepts `data: Record<string, unknown>` — no per-type Zod refinement. Values flow through `NormalizationService.normalizeMany()` (`entity-record-create.tool.ts:105–114`) before they hit the wide table; the normalizer is where format coercion happens. The agent currently has no prompt guidance about *what* string to emit for a date.

### Frontend portal launch

`apps/web/src/api/portals.api.ts:40–43` exposes `portals.create()` as a `useAuthMutation` posting `{ stationId }`. The frontend doesn't send any client clock or timezone today — `organizationId` and `userId` come off the auth token server-side.

## The design space

### Decision 1 — Source of "now"

| | A. Server clock at session start | B. Client clock sent in create payload | C. Both — server canonical, client tz hint |
|---|---|---|---|
| Correctness | Trusted server clock | Subject to client clock skew | Best of both |
| Plumbing | Zero — `new Date()` in `createPortal` | Web payload change + types | Web payload change + types |
| Sec posture | Server-controlled | Client-controlled (low risk here but novel) | Mixed |

**Lean: A.** The agent runs server-side. Authoritative time should come from the server it's running on. Client clock skew exists in the wild and there's no reason to inherit it.

### Decision 2 — Source of timezone

| | A. Org-level | B. User-level (new column) | C. Browser-detected per session | D. Org default + per-portal client override |
|---|---|---|---|---|
| Already in DB? | Yes (`organizations.timezone`, notNull) | No — needs migration | No (client only) | Partial |
| Cost | Free | Migration + UI to edit | Web payload change | Both |
| Matches mental model | Tenant-wide convention | Each user's locale | Each session's locale | Tenant default, overridable |

**Lean: A.** The org column already exists, is mandatory, and is the simplest answer. Per-user timezone is a real feature but isn't this ticket — defer to a follow-up issue if anyone asks. Browser-detected is novel plumbing for a marginal correctness win when the user is travelling.

### Decision 3 — Static prompt block vs. callable tool

| | A. Static "## Current time" block at session start | B. `get_current_time` tool only | C. Both — static block + tool for mid-session refresh |
|---|---|---|---|
| Token cost | One short block, prompt-cached | Per-call round-trip when invoked | Block always + occasional tool call |
| Freshness on long sessions | Stale by N minutes | Always current | Always current when tool is called |
| Agent reliability | Agent always sees the timestamp | Agent must remember to call the tool | Same as A for the easy case |
| Matches the issue's request | Yes | Doesn't address "session start" alone | Yes, optional B |

**Lean: B (with a small prompt-side hook).** Portal-session length varies by customer — some users may keep a portal open for hours across multiple work intervals, and a stale static timestamp would silently drift. A `get_current_time` tool keeps the agent honest at the moment temporal context matters. Add a one-line prompt section that (a) names the org's timezone (which *is* static for the session) and (b) directs the agent to call `get_current_time` before resolving any relative time expression. The timestamp itself lives in the tool response, not the prompt.

### Decision 4 — Date output format guidance to the agent

| | A. ISO 8601 UTC (`Z`) for everything | B. ISO 8601 with offset for datetime, `YYYY-MM-DD` for date | C. `canonicalFormat` when set, ISO 8601 fallback | D. No guidance |
|---|---|---|---|---|
| Respects per-column intent | No | No | Yes | No |
| Author can shape downstream display | No | No | Yes (via `canonicalFormat`) | No |
| Predictable when unconfigured | Yes | Yes | Yes (ISO 8601 fallback) | No |
| Normalizer compatibility | Strict-safe | Strict-safe | Strict-safe | Risky |
| Agent token cost | Trivial | Trivial | Per-column lookup (already in `_meta_columns`) | Zero |

**Lean: C.** Column definitions already carry `canonicalFormat` exactly so the org can shape the storage/display string per column; the agent honors it when set. When a column has no `canonicalFormat`, the prompt instructs the agent to emit ISO 8601: `YYYY-MM-DD` for `date` columns and ISO 8601 with the org's timezone offset for `datetime` columns. `NormalizationService` stays strict — no loose human-readable strings, no per-column parser branching — so the contract between the agent and the normalizer is simple: either follow the column's declared `canonicalFormat`, or follow the ISO default. `_meta_columns` already exposes `canonicalFormat` per column so the agent can read it inline with the entity it's writing to.

## Tradeoff comparison

| | Server clock (D1=A) | Org timezone (D2=A) | Tool + prompt hook (D3=B) | `canonicalFormat` + human-readable (D4=C) |
|---|---|---|---|---|
| Spread to spec | Yes — small | Yes — `organizationTimezone` field on `StationContext` | Yes — new tool class + prompt section advertising it | Yes — prompt copy referencing `_meta_columns.canonicalFormat` |
| Migration needed | No | No | No | No |
| Touches frontend | No | No | No | No |
| Touches tool inputs | No | No | New `get_current_time` tool registers with `ToolService` | No (normalizer stays strict ISO; agent emits ISO when no `canonicalFormat`) |

All four leans are backend-only, no schema migration, no frontend touch. The combined surface is one `StationContext` field, one new tool class wired into `ToolService`, and a new prompt section.

## Recommendation

1. Capture the server clock at tool-call time inside the new `get_current_time` tool — not at session start. The tool returns `{ now: ISO 8601 string in UTC, timezone: <org IANA>, localTime: <ISO 8601 with offset in org tz> }`.
2. Load the org's `timezone` (already required, already loaded with the org row) and surface it as `organizationTimezone: string` on `StationContext`, so the prompt can name it without a tool round-trip.
3. Add a `GetCurrentTimeTool` class under `apps/api/src/tools/` following the existing `Tool<InputSchema>` shape; register it in `apps/api/src/services/tools.service.ts` so every portal session has it available (no toolpack gate — time is universal).
4. Render a new `## Current time` section at the top of the system prompt — before `## Available Data` — naming the org's timezone (static for the session) and instructing the agent to call `get_current_time` before resolving any relative time expression. Pin relative-time resolution to the tool's response rather than training cutoff.
5. In the same section (or appended to the entity-creation guidance under `## SQL Guidance`), instruct the agent: when a column's `canonicalFormat` is set (visible in `_meta_columns`), emit the date/datetime in that format; otherwise emit ISO 8601 — `YYYY-MM-DD` for `date` columns, ISO 8601 with the org's timezone offset for `datetime` columns. `NormalizationService` stays strict (ISO-only when no `canonicalFormat`); no loose human-readable parsing.
6. Do **not** add a per-user timezone column in this PR. Hold it as a follow-up.

## Open questions

1. **Where exactly does the `## Current time` section render?** Top of the prompt (before `## Available Data`) or grouped with `## SQL Guidance`? **Lean: top.** It's universal context, not data-query-specific. Render it before any data so the agent has it whether or not the data-query toolpack is on.

2. **Is `get_current_time` exposed for every toolpack, or gated?** **Lean: no gate.** Time is universal — every conversation can benefit. The tool's input schema is empty (or accepts a placeholder), so it has no scope to misuse. Putting it behind a toolpack adds plumbing for no security or correctness win.

3. **What about an organization whose `timezone` is not a valid IANA name (corrupt data, hand-edited)?** **Lean: fall back to `UTC` with a warning log.** The column is `notNull` text — we don't validate the value at write time today. A bad value blowing up the prompt or the tool's `localTime` field is worse than a UTC-rendered timestamp.

4. **How do we test that the agent actually uses the tool?** Unit-testing the prompt copy and the tool's response shape is easy. End-to-end "agent calls `get_current_time` then resolves Friday correctly" is an LLM behavior test that's flaky by nature. **Lean: prompt-snapshot test + tool unit test only.** The behavior change is observable — the tool's `description` plus the prompt directive give the agent strong signal to call it. A snapshot test on the rendered prompt section + a unit test of the tool's response + one manual check in a real portal is sufficient.

5. **Per-user override path later.** If a user asks "what's my timezone?" while in a portal, they'll get the org's. **Lean: accept this for v1.** Per-user timezone is a discrete follow-up — file as a new issue if anyone hits it.

## What this doesn't decide

- **Whether `entity_record_create` should validate date/datetime inputs against the column's type** at the tool-input level (today, validation happens inside `NormalizationService` after the tool accepts `unknown`). Out of scope — that's a separate hardening pass that affects more than time.
- **Per-user timezone column on `users`.** Out of scope — defer; org timezone covers the canonical case.
- **Backfilling already-written wrong dates.** Issue explicitly says not in scope.
- **Caching of `get_current_time` results within a single turn.** If the agent calls the tool twice in one assistant turn, it gets two near-identical responses. Not worth optimizing in v1.

## Next step

Write `docs/PORTAL_TEMPORAL_GROUNDING.spec.md` (contract) and `.plan.md` (slices). The plan slices to one branch / one PR, but cleanly splits into two commits:

1. **`get_current_time` tool.** New class under `apps/api/src/tools/`, registered in `tools.service.ts`. Returns `{ now, timezone, localTime }`. Unit tests cover the response shape and the invalid-IANA fallback.
2. **Prompt section + `StationContext` field.** `StationContext` gains `organizationTimezone`; `PortalService.createPortal` populates it from the org row; `buildSystemPrompt` renders the new `## Current time` section advertising the tool and (separately) the `canonicalFormat`-or-ISO-8601 rule for date/datetime emission. Prompt snapshot tests assert both pieces.

All commits land on the existing `fix/portal-temporal-grounding` branch under one PR.
