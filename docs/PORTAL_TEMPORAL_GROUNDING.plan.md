# Portal temporal grounding — Plan

**TDD-sequenced implementation of the contract in `docs/PORTAL_TEMPORAL_GROUNDING.spec.md`. Four code slices plus a final manual-smoke / acceptance walkthrough. Each slice lands as one commit behind a green test suite. Slices are ordered leaf-first: util → tool → registration → prompt wiring, so every dependency is fully tested before its consumer lands.**

Spec: `docs/PORTAL_TEMPORAL_GROUNDING.spec.md`. Discovery: `docs/PORTAL_TEMPORAL_GROUNDING.discovery.md`.

Run tests with:

```bash
# api gates
npm run test:unit --workspace=apps/api
npm run test:integration --workspace=apps/api

# repo gates at slice boundaries
npm run lint
npm run type-check
```

Each slice loop:

1. Write failing tests for the slice's new behavior.
2. Implement the smallest change that makes them pass.
3. Run the focused tests; confirm green.
4. Run the entire `apps/api` unit suite — every existing test must continue to pass.
5. Lint + type-check at slice boundary.
6. Commit.

---

## Slice 0 — `timezone.util.ts`

**Why first.** Pure leaf. No consumers yet. The util ships behind its own tests so slice 1 (the tool) and slice 3 (the service) can compose it without re-litigating its behavior.

**Files**

- New: `apps/api/src/utils/timezone.util.ts` — exports `isValidIanaTimezone(tz: string): boolean` and `formatIsoWithOffset(date: Date, tz: string): string`.
- New: `apps/api/src/__tests__/utils/timezone.util.test.ts` — cases 11 + 12 from the spec.

**Steps**

1. **Write all failing tests** in `timezone.util.test.ts` (cases 11 + 12 from the spec). Imports point at the not-yet-existent `apps/api/src/utils/timezone.util.ts`; the test file fails to compile, which is the red state. Cases:

   - `isValidIanaTimezone("America/Los_Angeles") === true`
   - `isValidIanaTimezone("Europe/London") === true`
   - `isValidIanaTimezone("UTC") === true`
   - `isValidIanaTimezone("Mars/Olympus") === false`
   - `isValidIanaTimezone("") === false`
   - `isValidIanaTimezone("not a real tz") === false`
   - `formatIsoWithOffset(new Date("2026-06-01T18:47:05Z"), "America/Los_Angeles") === "2026-06-01T11:47:05-07:00"` (PDT)
   - `formatIsoWithOffset(new Date("2026-12-01T18:47:05Z"), "America/Los_Angeles") === "2026-12-01T10:47:05-08:00"` (PST — DST-aware)
   - `formatIsoWithOffset(new Date("2026-06-01T18:47:05Z"), "UTC") === "2026-06-01T18:47:05+00:00"`
   - `formatIsoWithOffset(new Date("2026-06-01T18:47:05Z"), "Europe/London") === "2026-06-01T19:47:05+01:00"` (BST)
   - Round-trip: `new Date(formatIsoWithOffset(d, tz)).getTime() === d.getTime()` for each case above.

2. **Confirm red.** `npm run test:unit --workspace=apps/api -- --testPathPattern=timezone` shows compile error / import failure.

3. **Implement `isValidIanaTimezone`:**
   ```ts
   export function isValidIanaTimezone(tz: string): boolean {
     if (!tz) return false;
     try {
       new Intl.DateTimeFormat("en-US", { timeZone: tz });
       return true;
     } catch {
       return false;
     }
   }
   ```

4. **Implement `formatIsoWithOffset`:**
   - Use `Intl.DateTimeFormat(...).formatToParts(date)` with the org timezone to extract year/month/day/hour/minute/second.
   - Compute the offset in minutes by comparing `date.getTime()` against a `Date.UTC(...)` reconstruction from those parts.
   - Format the offset as `±HH:MM` (e.g. `-07:00`, `+00:00`).

5. **Confirm green.** Util tests pass.

6. **Run the full `apps/api` unit suite.** Unchanged.

7. **Lint + type-check.** Clean.

**Done when:** `isValidIanaTimezone` and `formatIsoWithOffset` exist as standalone tested utilities; no other code consumes them yet.

**Risk:** `formatIsoWithOffset`'s offset-computation arithmetic is fiddly across DST boundaries. **Mitigation:** the DST test cases (June + December for `America/Los_Angeles`) lock the boundaries. If a third edge case breaks, add it to the test and fix.

---

## Slice 1 — `GetCurrentTimeTool`

**Why now.** Slice 0 provided the formatting + validation primitives. This slice ships the tool class behind its own unit tests but doesn't yet register it with `ToolService` — slice 2 does that.

**Files**

- New: `apps/api/src/tools/get-current-time.tool.ts` — `GetCurrentTimeTool` class per spec § Surface.
- New: `apps/api/src/__tests__/tools/get-current-time.tool.test.ts` — cases 6–10 from the spec.

**Steps**

1. **Write all failing tests** in `get-current-time.tool.test.ts` following the `jest.unstable_mockModule` pattern used by the other tool tests (e.g. `connector-entity-create.tool.test.ts`). Imports point at the not-yet-existent `apps/api/src/tools/get-current-time.tool.ts`; the file fails to compile (red).

   - **6** — execute the tool with a mocked org returning `{ timezone: "America/Los_Angeles" }`; assert the response has `now` (ISO 8601 with `Z`), `timezone === "America/Los_Angeles"`, and `localTime` (ISO 8601 with `±HH:MM`).
   - **7** — `Math.abs(Date.parse(response.now) - Date.now()) < 1000`.
   - **8** — `Date.parse(response.localTime) === Date.parse(response.now)`.
   - **9** — mock org returns `{ timezone: "Mars/Olympus" }`; assert `response.timezone === "UTC"`, `response.localTime` ends in `+00:00`, and a `logger.warn` spy was called with the org id + bad value.
   - **10** — mock `findById` to return `undefined`; assert `response.timezone === "UTC"` and the tool returns a sensible response (no throw).

2. **Confirm red.** Test suite shows the import failure / missing class.

3. **Implement `GetCurrentTimeTool`:**
   - Class extends `Tool<typeof InputSchema>` where `InputSchema = z.object({})`.
   - `description` matches the spec § Concept changes.
   - `build(organizationId)` returns the Vercel AI SDK `tool()` whose `execute`:
     - Loads `org = await DbService.repository.organizations.findById(organizationId)`.
     - `rawTz = org?.timezone ?? "UTC"`.
     - `timezone = isValidIanaTimezone(rawTz) ? rawTz : (logger.warn(...), "UTC")`.
     - `nowDate = new Date()`.
     - Returns `{ now: nowDate.toISOString(), timezone, localTime: formatIsoWithOffset(nowDate, timezone) }`.

4. **Confirm green.** Cases 6–10 pass.

5. **Run the full `apps/api` unit suite.** Unchanged (the tool isn't yet registered, so no other test reaches it).

6. **Lint + type-check.** Clean.

**Done when:** `GetCurrentTimeTool` is callable from a test, returns the spec's response shape, falls back to UTC for invalid IANA values, and logs the fallback. Production code does not yet expose it.

**Risk:** the `logger.warn` mocking pattern across the tool tests is fiddly with `jest.unstable_mockModule`. **Mitigation:** the reference test `connector-entity-create.tool.test.ts` already mocks several modules with this pattern — follow it directly.

---

## Slice 2 — Register the tool in `ToolService`

**Why now.** Slice 1's tool exists and is tested. This slice wires it into every portal session by registering it unconditionally in `ToolService.buildAnalyticsTools`. Smallest possible diff — one import, one assignment, one test.

**Files**

- New (if not present) or Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — case 15.
- Edit: `apps/api/src/services/tools.service.ts` — import `GetCurrentTimeTool`; register `tools.get_current_time = new GetCurrentTimeTool().build(organizationId)` inside `buildAnalyticsTools`, immediately after `const tools: Record<string, Tool> = {};` and before the first toolpack switch.

**Steps**

1. **Write the failing test** (case 15). If `tools.service.test.ts` doesn't exist, create it with the minimal mocking scaffold (`jest.unstable_mockModule` for `db.service.js`, the repos `buildAnalyticsTools` reads, and `AnalyticsService.loadStation`). The single assertion:
   - For a station fixture with only one toolpack enabled (e.g. `web_search`), `buildAnalyticsTools(orgId, stationId, userId)` returns a tools record containing `get_current_time`.

2. **Confirm red.** The test fails — registration doesn't exist yet.

3. **Implement the registration** in `tools.service.ts:316` area:
   ```ts
   const tools: Record<string, Tool> = {};

   // get_current_time is registered for every portal — temporal context
   // is universal, not pack-gated.
   tools.get_current_time = new GetCurrentTimeTool().build(organizationId);

   // -------------------------------------------------------------------
   // Pack: data_query
   // -------------------------------------------------------------------
   if (enabledPacks.has("data_query")) { ... }
   ```

4. **Confirm green.** Case 15 passes.

5. **Run the full `apps/api` unit suite.** Unchanged — existing tests don't assert which tools are absent, so they don't fail when a new one is added.

6. **Lint + type-check.** Clean.

**Done when:** every call to `buildAnalyticsTools` returns a tools record that includes `get_current_time`.

**Risk:** custom-toolpack registrations bypass `buildAnalyticsTools` and miss the new tool. **Mitigation:** `tools.service.ts:299–301` references `customPackIds` but the surrounding code only validates them, not registers a separate tool set — custom packs flow through the same builder. Spec § Risks captures the broader concern; verify with a manual smoke in slice 4 against a station that has a custom pack enabled.

---

## Slice 3 — `StationContext.organizationTimezone` + prompt section + service population

**Why now.** With the tool registered and exposed, the prompt can safely advertise it. This slice is the largest of the four because the change is cross-cutting: a required field added to a shared type breaks every existing fixture, and the prompt builder gains a new section. Done in one slice to keep the prompt-snapshot tests in lock-step with the field's introduction.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts:30+` — `StationContext` gains `organizationTimezone: string` (required).
- Edit: `apps/api/src/prompts/system.prompt.ts:48+` — `buildSystemPrompt` renders the new `## Current time` section after the lead line and before `## Available Data`.
- Edit: `apps/api/src/services/portal.service.ts:260+` — `createPortal` loads the org row, validates timezone via the slice-0 util, populates `organizationTimezone` on the assembled `StationContext`.
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` — every existing fixture gets `organizationTimezone: "UTC"` (search-and-replace); add cases 2–5 from the spec.
- Edit (optional): `apps/api/src/__tests__/__integration__/services/portal.service.integration.test.ts` (if it exists) — add cases 13 + 14.

**Steps**

This slice runs two red-green cycles back-to-back: prompt behavior first, then service behavior. Within each cycle, all failing tests land before any implementation.

### Cycle A — prompt section

1. **Write all failing prompt tests** (cases 2–5) inside `system.prompt.test.ts`. Each builds its own fixture with `organizationTimezone: "America/Los_Angeles"` (or `"UTC"` where it doesn't matter for the assertion). The new fixtures *include* the not-yet-existent field on `StationContext`.
   - **2** — `## Current time` and `America/Los_Angeles` present in rendered prompt.
   - **3** — prompt contains `get_current_time` and a phrase like "relative time expression".
   - **4** — prompt contains `canonicalFormat`, `YYYY-MM-DD`, and an ISO 8601 with offset matching `/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/`.
   - **5** — fixture with `toolPacks: []`; `## Current time` still present.

2. **Confirm red — phase 1: compile failure.** The new fixtures reference `organizationTimezone` which doesn't exist on `StationContext`. The type checker fails on every fixture in the file (new and existing).

3. **Add `organizationTimezone: string` to `StationContext`** (`system.prompt.ts:30+`). Required, not optional — see spec § Concept changes.

4. **Update every existing fixture** in `system.prompt.test.ts` that constructs a `StationContext`. The type checker enumerates the sites; add `organizationTimezone: "UTC"` to each (~5–10 spots in this file plus any other test file that constructs the context).

5. **Confirm red — phase 2: runtime failure.** Compilation passes. Cases 2–5 run and fail — the prompt builder doesn't render the new section yet, so the assertions on `## Current time` / `get_current_time` / `canonicalFormat` miss.

6. **Implement the prompt section** in `buildSystemPrompt`, inserted after the lead line (`system.prompt.ts:50` area) and before `## Available Data`:
   ```ts
   const lines: string[] = [
     `You are an analytics assistant for the "${stationContext.stationName}" station.`,
     "",
     "## Current time",
     "",
     `The organization's timezone is **${stationContext.organizationTimezone}**.`,
     "Before resolving any relative time expression (\"today\", \"this Friday\", \"next week\", \"in 3 days\", \"end of month\", etc.), call the `get_current_time` tool. Resolve the expression against the timestamp in `localTime` (the org's timezone), not your training cutoff.",
     "",
     "When writing a `date` or `datetime` value into an entity:",
     "- If `_meta_columns.canonicalFormat` is set for the column, emit the value in that exact format.",
     "- Otherwise: `date` columns → `YYYY-MM-DD`; `datetime` columns → ISO 8601 with the org's UTC offset (e.g. `2026-06-01T15:00:00-07:00`).",
     "",
     "## Available Data",
     "",
   ];
   ```

7. **Confirm green.** Cases 2–5 pass.

### Cycle B — service population

8. **Write failing service tests** (cases 13 + 14) in `portal.service.integration.test.ts` (create the file if it doesn't yet exist; use the same integration scaffold as the other portal-related integration tests):
   - **13** — seed an org with `timezone: "Europe/London"`; call `createPortal`; assert `stationContext.organizationTimezone === "Europe/London"`.
   - **14** — seed an org with `timezone: "Not/Real"`; assert `stationContext.organizationTimezone === "UTC"` and `logger.warn` fired.

9. **Confirm red.** The new field is on `StationContext` but `PortalService.createPortal` doesn't populate it; cases 13 + 14 fail (`stationContext.organizationTimezone` is `undefined`, which surfaces as the TS narrowing assertion or a missing-property check, depending on Jest's reporting).

10. **Implement the service population** in `portal.service.ts` between line 295 (after `loadStation`) and line 311 (before the `StationContext` assembly):
    ```ts
    const org = await DbService.repository.organizations.findById(organizationId);
    if (!org) throw new ApiError(...);  // existing error pattern; ORG_NOT_FOUND
    const organizationTimezone = isValidIanaTimezone(org.timezone)
      ? org.timezone
      : (logger.warn(
          { organizationId, badValue: org.timezone },
          "Org timezone is not a recognized IANA name, falling back to UTC"
        ),
        "UTC");
    ```
    Then add `organizationTimezone` to the `StationContext` assembly at line 311+.

11. **Confirm green.** Cases 13 + 14 pass.

### Slice close

12. **Run the full `apps/api` unit suite.** Every existing test passes — fixture updates are mechanical; the prompt builder still produces the same output for `## Available Data` and downstream sections.

13. **Run the full `apps/api` integration suite.** Green.

14. **Lint + type-check.** Clean.

**Done when:** cycle A and cycle B are both green; `StationContext.organizationTimezone` is required and populated; every portal's system prompt includes the `## Current time` section.

**Risk:** missed fixture updates produce TypeScript compile errors at every test file that constructs a `StationContext`. **Mitigation:** that's the point of making the field required — step 4's type checker enumerates every site to update. Mechanical.

**Risk 2:** a snapshot test exists for the rendered prompt and compares against a frozen string that doesn't include the new section. **Mitigation:** if found, regenerate the snapshot as part of step 6 and visually diff it against the spec's section copy before committing.

---

## Slice 4 — Manual smoke + acceptance criteria walkthrough

**Why last.** All code changes are complete after slice 3. This slice verifies the contract end-to-end against a running portal and ticks the spec's acceptance criteria.

**Files**

- None — manual verification only. (If the smoke turns up a regression, it goes in its own commit ahead of merge.)

**Steps**

1. **Boot the dev environment:**
   ```bash
   npm run dev
   ```
   Wait for the API on `:3001` and the web app on `:3000`.

2. **Create a portal** in a station with `entity_management` + `data_query` enabled.

3. **Verify the agent calls `get_current_time`:**
   - Prompt: "what day is it today?"
   - Expected: the agent invokes `get_current_time` (visible in the tool-call block) and reports the actual current date.
   - Pass/fail: the agent's response date matches the real current date.

4. **Verify relative-date resolution:**
   - Prompt: "add a todo for next Friday named 'plan-test'" (in a station with a todo entity that has a `dueDate` datetime column).
   - Expected: the agent calls `get_current_time`, then `entity_record_create` with `dueDate` set to the ISO 8601 string for actual next Friday at a sensible default time (e.g. end of day) in the org's timezone.
   - Pass/fail: the persisted `dueDate` in the wide table matches real next Friday.

5. **Verify `canonicalFormat` honoring:**
   - On a `date`-type column with `canonicalFormat: "MM/DD/YYYY"`, prompt: "add a record with the start date today."
   - Expected: the agent emits the value in `MM/DD/YYYY` shape.
   - Pass/fail: the persisted value matches the column's `canonicalFormat`.

6. **Verify invalid-IANA fallback** (optional — requires DB access):
   - Manually update an org's `timezone` column to a junk value via `db:studio`.
   - Open a new portal in that org.
   - Expected: the API logs the `WARN` line about the bad timezone; the prompt renders `UTC`; the `get_current_time` tool returns `timezone: "UTC"`.
   - Restore the org's original timezone after testing.

7. **Walk through the spec's acceptance criteria** in `docs/PORTAL_TEMPORAL_GROUNDING.spec.md#acceptance-criteria` and tick each box that's satisfied. Anything outstanding goes back to the relevant slice.

**Done when:** every acceptance criterion in the spec is ticked.

**Risk:** the LLM doesn't reliably call `get_current_time` despite the prompt directive — manifests as the agent inventing dates anyway. **Mitigation:** the system-prompt section is rendered before `## Available Data` (high salience) and is repeated in the tool's `description`. If telemetry shows non-calls in real sessions, the follow-up is stronger directives (e.g. `IMPORTANT: you MUST call get_current_time before any date arithmetic`) or per-call instrumentation that flags writes to date columns when no `get_current_time` was called that turn.

---

## Cross-slice gates

After every slice (0–3):

1. `npm run test:unit --workspace=apps/api` is green.
2. `npm run test:integration --workspace=apps/api` is green (only relevant where the slice touches integration-tested surface — slice 3).
3. `npm run lint && npm run type-check` from repo root are clean.
4. `git diff --stat` matches the slice's "Files" list.

After slice 3, before slice 4:

- `grep -rn "organizationTimezone" apps/api/src` returns matches in **only** the four expected spots: the `StationContext` interface, the `PortalService.createPortal` body, the prompt builder, and the test fixtures.
- `grep -rn "get_current_time" apps/api/src` returns matches in the tool file, the registration in `tools.service.ts`, the prompt builder, and the tests.

After slice 4 (work end):

- All new test cases (1–15 from the spec's Tests section) pass.
- All acceptance-criteria checkboxes in the spec are ticked.

---

## What this plan does *not* attempt

- **Per-user timezone column on `users`.** Org timezone is the canonical source; per-user is a follow-up issue.
- **A static "## Current time" timestamp** (option A in discovery decision 3). The tool is the only source of `now`.
- **Tightening `entity_record_create` input validation** to reject non-ISO strings at the tool-input level. The prompt instructs the agent to emit ISO when no `canonicalFormat` is set; `NormalizationService` remains the arbiter and stays strict.
- **Caching `get_current_time` per assistant turn.** Repeated calls within one turn return slightly different timestamps; not worth optimizing.
- **A frontend timezone picker or any web-app change.** This is server-side only.
- **Migrating existing wrong dates.** Out of scope per the issue.
