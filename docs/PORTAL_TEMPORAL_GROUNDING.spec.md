# Portal temporal grounding — Spec

**The portal agent always has a way to know the current wall-clock time and the org's timezone.** The system prompt names the org's IANA timezone (static for the session) and tells the agent to call a new `get_current_time` tool before resolving any relative time expression ("today", "this Friday", "next week", etc.). When writing a `date` or `datetime` value into an entity, the agent honors the column's `canonicalFormat` if set; otherwise it emits ISO 8601 — `YYYY-MM-DD` for `date` columns, ISO 8601 with the org's UTC offset for `datetime` columns. `NormalizationService` stays strict on parsing.

Discovery: `docs/PORTAL_TEMPORAL_GROUNDING.discovery.md`. Decisions: D1=A (server clock), D2=A (org timezone), D3=B (tool, no static timestamp), D4=C (`canonicalFormat` with ISO 8601 fallback).

Issue: [EnterpriseBT/portal-ai#90](https://github.com/EnterpriseBT/portal-ai/issues/90).

## Scope

### In scope

1. **`get_current_time` tool** — new class `GetCurrentTimeTool` under `apps/api/src/tools/get-current-time.tool.ts`. Empty input schema. Returns `{ now, timezone, localTime }` where `now` is the server's current time in UTC as ISO 8601 with `Z` suffix; `timezone` is the org's IANA timezone string; `localTime` is the same instant rendered in the org's timezone as ISO 8601 with offset (e.g. `2026-06-01T11:47:05-07:00`).

2. **`StationContext.organizationTimezone`** — new `string` field on `StationContext` in `apps/api/src/prompts/system.prompt.ts:30`. Populated by `PortalService.createPortal` from the org row's `timezone` column. Always present (the org column is `notNull`); the field is required, not optional.

3. **Org row loaded at portal-create time** — `PortalService.createPortal` (`apps/api/src/services/portal.service.ts:260+`) gains a single read against `repo.organizations.findById(organizationId)` and pulls `timezone` from the result. No new repository method needed.

4. **New `## Current time` section in `buildSystemPrompt`** — rendered immediately after the lead "You are an analytics assistant..." line and before `## Available Data`. Always rendered (no toolpack gate). Contents:
   - One line naming the org's timezone.
   - One sentence directing the agent to call `get_current_time` before resolving relative time expressions, and to resolve them against the org's timezone.
   - One paragraph on date emission: "When writing a `date` or `datetime` value into an entity, follow the column's `canonicalFormat` if `_meta_columns.canonicalFormat` is set. Otherwise: `date` → `YYYY-MM-DD`; `datetime` → ISO 8601 with the org timezone offset (e.g. `2026-06-01T15:00:00-07:00`)."

5. **Tool registration** — `GetCurrentTimeTool` registered in `ToolService.buildAnalyticsTools` (`apps/api/src/services/tools.service.ts:284+`) **outside any toolpack gate**. Every portal gets it. The tool needs no station-scoped state; `build(organizationId)` is the only constructor argument it takes (used to look up org timezone on every call so the response reflects the org's current config, not a stale snapshot).

6. **Invalid-IANA fallback** — if the org's `timezone` value is not a recognized IANA name (validated by passing it to `Intl.DateTimeFormat`), the tool falls back to `"UTC"` for the response and the prompt renders `UTC`. A warning is logged (`logger.warn`) with the org id and the bad value. No exception bubbles to the caller.

7. **Tests**:
   - Unit tests on `GetCurrentTimeTool` covering response shape (all three fields), timezone fallback, and that `now` is parseable as a valid ISO 8601 UTC instant.
   - Snapshot/string tests on `buildSystemPrompt` asserting the new `## Current time` section renders with the org timezone, mentions the `get_current_time` tool, and includes the `canonicalFormat`-or-ISO date-emission rule.
   - Unit tests confirming the new prompt section renders even when no toolpacks are configured (the prompt is built unconditionally; only some downstream sections are gated).

### Out of scope

- **Per-user timezone column on `users`.** Org timezone is the canonical source for v1. A follow-up issue captures the per-user override case if anyone hits it.
- **A static timestamp in the prompt.** Decision 3 deliberately leaves the timestamp to the tool so long-running portal sessions stay correct.
- **Frontend changes.** No payload changes to `POST /api/portals`; no UI surface for setting a timezone. The org's existing `timezone` column is the source.
- **Tightening `entity_record_create` input validation to reject non-ISO date strings at the tool-input level.** That's a `NormalizationService` hardening pass; this spec doesn't touch the normalizer. The contract is just: the prompt instructs the agent to emit ISO when no `canonicalFormat` is set, and the normalizer already rejects strings it can't parse.
- **Backfilling already-written wrong dates** in existing records. Issue explicitly excludes this.
- **Caching `get_current_time` results** within a single assistant turn. If the agent calls the tool twice it gets two near-identical responses; not worth optimizing.

## Concept changes

### `StationContext`

```ts
export interface StationContext {
  stationId: string;
  stationName: string;
  entities: EntitySchema[];
  entityGroups: EntityGroupContext[];
  toolPacks: string[];
  entityCapabilities?: Record<string, ResolvedCapabilities>;
  connectorInstances?: ConnectorInstanceContext[];

  // NEW — IANA timezone for the org owning this portal. Always present.
  // Falls back to "UTC" if the stored value isn't a recognized IANA name.
  organizationTimezone: string;
}
```

Why required, not optional: the org column is `notNull` and the prompt section always renders. Making the field optional would just push a `?? "UTC"` into `buildSystemPrompt`; cleaner to do the fallback once at the load site and pass through a guaranteed string.

### `PortalService.createPortal`

After `AnalyticsService.loadStation` (`portal.service.ts:292`) and before `loadConnectorInstanceContexts` (`portal.service.ts:306`):

```ts
const org = await repo.organizations.findById(organizationId);
if (!org) throw new ApiError(...);
const organizationTimezone = isValidIanaTimezone(org.timezone)
  ? org.timezone
  : (logger.warn({ organizationId, badValue: org.timezone },
       "Org timezone is not a recognized IANA name, falling back to UTC"),
     "UTC");
```

A small `isValidIanaTimezone(tz: string): boolean` helper goes in `apps/api/src/utils/timezone.util.ts` and checks the string by constructing `new Intl.DateTimeFormat("en-US", { timeZone: tz })` inside a try/catch — `Intl.DateTimeFormat` throws on unknown IANA names. The helper is `O(1)` and synchronous.

`organizationTimezone` is then included in the `StationContext` assembly (`portal.service.ts:311`).

### `buildSystemPrompt` — `## Current time` section

Rendered immediately after the lead line and before `## Available Data`. Pseudocode:

```ts
lines.push("## Current time");
lines.push("");
lines.push(
  `The organization's timezone is **${stationContext.organizationTimezone}**.`
);
lines.push(
  "Before resolving any relative time expression (\"today\", \"this Friday\", " +
    "\"next week\", \"in 3 days\", \"end of month\", etc.), call the " +
    "`get_current_time` tool. Resolve the expression against the timestamp " +
    "in `localTime` (the org's timezone), not your training cutoff."
);
lines.push("");
lines.push(
  "When writing a `date` or `datetime` value into an entity:"
);
lines.push(
  "- If `_meta_columns.canonicalFormat` is set for the column, emit the " +
    "value in that exact format."
);
lines.push(
  "- Otherwise: `date` columns → `YYYY-MM-DD`; `datetime` columns → ISO " +
    "8601 with the org's UTC offset (e.g. `2026-06-01T15:00:00-07:00`)."
);
lines.push("");
```

The section appears whether `entity_management` and `data_query` are enabled or not. The date-emission paragraph references `_meta_columns` which only exists when `data_query` is enabled — that's fine; when the agent can't query, the rule has no surface to apply to, and the copy doesn't reference any toolpack-conditional section name explicitly.

### `GetCurrentTimeTool`

```ts
// apps/api/src/tools/get-current-time.tool.ts

const InputSchema = z.object({}).describe(
  "No arguments — returns the current server time."
);

export class GetCurrentTimeTool extends Tool<typeof InputSchema> {
  slug = "get_current_time";
  name = "Get Current Time";
  description =
    "Return the current date and time. Use this before resolving any " +
    "relative time expression like \"today\", \"this Friday\", \"next " +
    "week\", or \"end of month\". The response includes both UTC " +
    "(`now`) and the organization's local time (`localTime`); resolve " +
    "relative expressions against `localTime`.";

  get schema() {
    return InputSchema;
  }

  build(organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async () => {
        const org = await DbService.repository.organizations.findById(
          organizationId
        );
        const rawTz = org?.timezone ?? "UTC";
        const timezone = isValidIanaTimezone(rawTz) ? rawTz : "UTC";
        const nowDate = new Date();
        return {
          now: nowDate.toISOString(),                 // "2026-06-01T18:47:05.123Z"
          timezone,                                   // "America/Los_Angeles"
          localTime: formatIsoWithOffset(nowDate, timezone), // "2026-06-01T11:47:05-07:00"
        };
      },
    });
  }
}
```

`formatIsoWithOffset` lives in `apps/api/src/utils/timezone.util.ts` alongside `isValidIanaTimezone`. It uses `Intl.DateTimeFormat` parts to produce the offset; no external date library — the existing codebase doesn't carry one, and pulling in `date-fns-tz` for this is disproportionate.

The org lookup happens per-call so a config edit to `organizations.timezone` mid-session is reflected on the next tool invocation. The DB round-trip per call is acceptable — `organizations.findById` is a single-row lookup on a small table and is already used in many request paths.

### Tool registration in `ToolService`

A new block before the toolpack switches in `buildAnalyticsTools` (`tools.service.ts:316` area, right after `tools` is declared):

```ts
tools.get_current_time = new GetCurrentTimeTool().build(organizationId);
```

No `enabledPacks.has(...)` gate. Time is universal context.

## Surface

### `apps/api/src/prompts/system.prompt.ts` (edit)

- `StationContext` gains `organizationTimezone: string` (required).
- Inside `buildSystemPrompt`, after the lead line and before `## Available Data`, render the new `## Current time` section.

### `apps/api/src/services/portal.service.ts` (edit)

- `createPortal`: load the org row, validate timezone, populate `organizationTimezone` on the `StationContext` assembled at lines 311–319.

### `apps/api/src/utils/timezone.util.ts` (new)

- `isValidIanaTimezone(tz: string): boolean`.
- `formatIsoWithOffset(date: Date, tz: string): string` — returns ISO 8601 with `±HH:MM` offset.

### `apps/api/src/tools/get-current-time.tool.ts` (new)

- `GetCurrentTimeTool` class; constructor `build(organizationId: string)`.

### `apps/api/src/services/tools.service.ts` (edit)

- Import `GetCurrentTimeTool`.
- Register `tools.get_current_time` unconditionally inside `buildAnalyticsTools` before the toolpack switches.

### `apps/api/src/__tests__/prompts/system.prompt.test.ts` (edit)

- Update existing tests that construct `StationContext` fixtures — every fixture gains `organizationTimezone: "UTC"` (or a meaningful value where it matters).
- New tests assert the rendered prompt contains `## Current time`, the org's timezone, the directive to call `get_current_time`, and the `canonicalFormat`-or-ISO date-emission rule.

### `apps/api/src/__tests__/tools/get-current-time.tool.test.ts` (new)

- Response shape (all three fields).
- `now` is parseable as ISO 8601 and is within a small window of `Date.now()`.
- `localTime` parses to the same instant as `now`.
- Invalid IANA value in DB → `timezone` is `"UTC"`, `logger.warn` invoked.
- Org missing entirely (defensive) → `timezone` is `"UTC"`.

### `apps/api/src/__tests__/utils/timezone.util.test.ts` (new)

- `isValidIanaTimezone("America/Los_Angeles") === true`.
- `isValidIanaTimezone("Mars/Olympus") === false`.
- `isValidIanaTimezone("") === false`.
- `formatIsoWithOffset(new Date("2026-06-01T18:47:05Z"), "America/Los_Angeles")` returns `"2026-06-01T11:47:05-07:00"`.
- `formatIsoWithOffset(..., "UTC")` returns `"2026-06-01T18:47:05+00:00"`.

## Tests

### Unit — `system.prompt.test.ts`

1. Existing tests' `StationContext` fixtures get `organizationTimezone: "UTC"` added; assertions unchanged.
2. **`renders the Current time section with the org's timezone`** — fixture with `organizationTimezone: "America/Los_Angeles"`; assert the rendered prompt contains `## Current time` and `America/Los_Angeles`.
3. **`directs the agent to call get_current_time before resolving relative expressions`** — assert the prompt contains `get_current_time` and a phrase like "relative time expression".
4. **`renders the date-emission rule with canonicalFormat reference and ISO 8601 fallback`** — assert the prompt mentions `canonicalFormat`, `YYYY-MM-DD`, and an example ISO 8601 with offset.
5. **`renders Current time section even when no toolpacks are enabled`** — fixture with `toolPacks: []`; assert `## Current time` is present.

### Unit — `get-current-time.tool.test.ts`

6. **`returns now, timezone, and localTime`** — mock `repo.organizations.findById` to return `{ timezone: "America/Los_Angeles" }`; execute the tool; assert the response has all three fields with the expected shapes.
7. **`now is a valid ISO 8601 UTC instant within 1s of Date.now()`**.
8. **`localTime parses to the same instant as now`** — `new Date(localTime).getTime() === new Date(now).getTime()`.
9. **`falls back to UTC when the org's timezone is not a valid IANA name`** — mock the org to return `{ timezone: "Mars/Olympus" }`; assert `timezone === "UTC"`, `localTime` ends in `+00:00` or `Z`, and `logger.warn` was called.
10. **`falls back to UTC when org row is missing`** — defensive; mock `findById` to return `undefined`; assert `timezone === "UTC"`.

### Unit — `timezone.util.test.ts`

11. `isValidIanaTimezone` truth table (see Surface section above).
12. `formatIsoWithOffset` cases (see Surface section above).

### Integration — `portal.service.integration.test.ts` (if a portal-creation integration suite exists; otherwise unit-level on `PortalService.createPortal` is fine)

13. **`createPortal populates StationContext.organizationTimezone from the org row`** — seed an org with `timezone: "Europe/London"`; create a portal; assert the returned `stationContext.organizationTimezone === "Europe/London"`.
14. **`createPortal falls back to UTC for an org with an invalid IANA timezone`** — seed an org with `timezone: "Not/Real"`; assert `stationContext.organizationTimezone === "UTC"` and warn was logged.

### Tool-registry coverage — `tools.service.test.ts` (if it exists)

15. **`get_current_time is always present regardless of toolpack`** — for a station with only one toolpack enabled (any pack), `buildAnalyticsTools` returns a tools record where `get_current_time` exists.

## Acceptance criteria

- [ ] `StationContext.organizationTimezone` exists, is required, and is populated by `PortalService.createPortal`.
- [ ] `buildSystemPrompt` renders a `## Current time` section that names the org's timezone, references `get_current_time`, and explains the `canonicalFormat`-or-ISO date-emission rule.
- [ ] `GetCurrentTimeTool` is registered in `ToolService.buildAnalyticsTools` for every portal regardless of toolpack.
- [ ] `get_current_time` returns `{ now, timezone, localTime }` with `now` and `localTime` representing the same instant.
- [ ] Invalid IANA values fall back to `UTC` at both the prompt-render and tool-invocation paths with a `logger.warn`.
- [ ] All new unit tests pass; existing prompt and tools tests pass after the fixture updates.
- [ ] `npm run type-check` clean.
- [ ] Manual smoke: open a portal, ask "what day is it?" and "add a todo for next Friday named X" — the agent invokes `get_current_time` and the resulting record's `dueDate` matches the real next Friday.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Agent doesn't call `get_current_time` reliably and invents a date anyway. | The system prompt's `## Current time` section is rendered before `## Available Data` (high salience) and explicitly directs the call. The tool's `description` repeats the same directive. If LLM telemetry shows non-calls, we follow up with stronger directives or instrument a "no get_current_time call but date-typed write" warning. |
| `Intl.DateTimeFormat` is slow under load when called per tool invocation. | One construction per call; the V8 implementation is heavily optimized and is comparable to a `Date()` constructor. Per-call DB hit for the org row dominates the cost; if profiling shows otherwise, a 1-call-per-portal cache is a trivial follow-up. |
| Org timezone is corrupt in production data. | The `isValidIanaTimezone` guard short-circuits to UTC + a `logger.warn`. The agent's worst case is to resolve relative dates in UTC for that org — degraded but not broken. A separate cleanup PR can sweep `organizations.timezone` for invalid values once observed. |
| Adding a required field to `StationContext` breaks every fixture in the test suite. | `system.prompt.test.ts` already has multiple fixtures; the slice adds `organizationTimezone: "UTC"` to each (search-and-replace). The type checker catches every miss. Other consumers (`portal.service.ts`, `portal-events.router.ts`) only read the field, not construct it, so they're not affected. |
| `formatIsoWithOffset` produces a string that the agent or normalizer can't round-trip. | The function uses `Intl.DateTimeFormat` parts to construct the canonical `YYYY-MM-DDTHH:mm:ss±HH:MM` shape. The unit tests (case 12) lock that shape and JavaScript's `new Date(...)` parses it back to the same instant. |

**Rollback**: revert the merge commit. The new tool deregisters, the prompt section vanishes, `StationContext.organizationTimezone` is removed, the new util file deletes. No DB migration to undo. Frontend untouched.

## Cross-references

- `docs/PORTAL_TEMPORAL_GROUNDING.discovery.md` — design space + decision rationale.
- `apps/api/src/prompts/system.prompt.ts:30` — `StationContext` interface; field added here.
- `apps/api/src/services/portal.service.ts:260` — `createPortal`; org load + timezone resolution added here.
- `apps/api/src/services/tools.service.ts:284` — `buildAnalyticsTools`; tool registration added here.
- `apps/api/src/db/schema/organizations.table.ts:11` — `timezone: text("timezone").notNull()` (the source).
- `apps/api/src/db/repositories/organizations.repository.ts:37` — `organizationsRepo` (used to load the org row).
