# @portalai/spreadsheet-parsing

Provider-agnostic spreadsheet interpretation and replay. Turns irregular CSV/XLSX/Google-Sheets/Excel-Online workbooks into a declarative `LayoutPlan`, then deterministically replays that plan to produce records.

See [`docs/SPREADSHEET_PARSING.architecture.spec.md`](../../docs/SPREADSHEET_PARSING.architecture.spec.md) for the domain model and [`docs/SPREADSHEET_PARSING.backend.spec.md`](../../docs/SPREADSHEET_PARSING.backend.spec.md) for concrete types and algorithms. [`docs/SPREADSHEET_PARSING.backend.plan.md`](../../docs/SPREADSHEET_PARSING.backend.plan.md) is the phased build-out.

## Three-subpath export convention

Consumers never reach into `src/`. They pick a subpath based on where the code will run:

| Subpath | Runs in | Contents |
|---|---|---|
| `@portalai/spreadsheet-parsing` | Node **and** browser | Cross-compatible code — Zod schemas, types, pure helpers, the `interpret()` orchestrator, the `LlmBridge` namespace (prompt templates + response schemas + sampler), workbook accessors, warning codes. No Node builtins, no DOM APIs. |
| `@portalai/spreadsheet-parsing/replay` | Node only | `replay(plan, workbook)` and its helpers. Uses `node:crypto` for SHA-256 checksums so the plan-driven write path matches `record-import.util.ts` byte-for-byte. Never import this from web or Storybook — Vite externalizes `node:crypto` and the bundle breaks at runtime. |
| `@portalai/spreadsheet-parsing/ui` | Browser only | Landing zone for browser-only exports (DOM APIs, React hooks, `globalThis.crypto.subtle`, etc.). Empty today; intended for future additions. Never import from `/replay`. |

### Why the split

The parser is consumed from both halves of the monorepo:

- `apps/api` invokes `interpret()` and `replay()` from the Node server.
- `apps/web` and its Storybook load the parser's types, schemas, and pure helpers via `@portalai/core/contracts` so the region editor can validate drafts in-browser without a round-trip.

A single barrel forces every consumer to bundle every dependency transitively. Any Node-only import (`node:crypto`, `node:fs`, …) would break Vite, and any browser-only API would break Node. Subpath exports let each consumer pull only what runs in its environment.

### Decision flow for new code

1. Does the code use **only** Node builtins or Node-only libraries (e.g. `fs`, `crypto`, `child_process`)? → `src/replay/` (or a new Node-only subpath modelled on it).
2. Does the code use **only** browser APIs or React? → `src/ui/`.
3. Otherwise (pure JS, Zod, TextEncoder, DataView, `globalThis.crypto.subtle`): → main entry.

If in doubt, start in the main entry. Moving code out later is cheap; splitting imports after a browser bundle breaks is not.

## Compile-time enforcement

`src/__tests__/forbidden-deps.test.ts` is the audit. It runs with the normal unit suite and blocks:

- External dependencies beyond `zod` (`ai`, `@ai-sdk/*`, `pino`, `axios`, …) — anywhere in `src/`.
- Node builtins (`node:crypto`, `node:fs`, …) — anywhere except under `src/replay/`.
- `process.env` reads — anywhere in `src/`.
- **Cross-subpath imports**:
  - main entry → `/replay` or `/ui` (would drag environment-specific code into the cross-compat bundle)
  - `/ui` → `/replay` (would drag Node code into the browser bundle)

A regression in the source tree fails the audit before it reaches a bundler.

## Public surface at a glance

```ts
// Main entry — use from anywhere.
import {
  PLAN_VERSION,
  LayoutPlanSchema, RegionSchema, WorkbookSchema,
  interpret,
  LlmBridge,                     // prompt + schema + sampler
  computeWorkbookFingerprint,
  makeWorkbook, makeSheetAccessor,
  WarningCode,
} from "@portalai/spreadsheet-parsing";

// Node-only.
import { replay } from "@portalai/spreadsheet-parsing/replay";

// Browser-only. Empty today — expand under `src/ui/` as browser helpers land.
import {} from "@portalai/spreadsheet-parsing/ui";
```

## Status

- Phase 0 — Package scaffold + core re-export ✅
- Phase 1 — Workbook abstraction + CSV/XLSX adapters ✅
- Phase 2 — `LayoutPlan` Zod schemas + frontend type unification ✅
- Phase 3 — `interpret()` stage skeletons + `InterpretState` ✅
- Phase 4 — LLM-backed classifier + axis-name recommender (factory in `apps/api`) ✅
- Phase 5 — `replay()` + drift detection ✅
- Phase 6 — `connector_instance_layout_plans` table + repository + cascade ✅
- Phase 7 — Layout-plan endpoints (interpret, GET, PATCH) + Swagger JSDoc ✅
- Phase 8 — Commit endpoint + plan-driven `ConnectorEntity`/`FieldMapping`/`entity_records` write path + drift gating ✅
- Phase 9 — Structured stage observability (`interpret.stage.completed` + `interpret.cost.summary`) + blocker-warnings commit gate ✅
- Phase 10 — Final audit + docs ✅

See [`docs/SPREADSHEET_PARSING.backend.plan.md`](../../docs/SPREADSHEET_PARSING.backend.plan.md).
