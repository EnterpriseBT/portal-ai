# Portal message timestamps — Condensed design (#180)

**Issue:** [EnterpriseBT/portal-ai#180](https://github.com/EnterpriseBT/portal-ai/issues/180) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Portal session messages render with no time context. Show a timestamp on every user prompt and agent response so a conversation reads like a text thread. Frontend-only — the data already exists (`message.created`, epoch ms, from `CoreObjectSchema`).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Pure UI, user bubble | `PortalMessage.component.tsx:146–168` (`PortalMessageUI`) | right-aligned `Paper`; renders `message.blocks` |
| Pure UI, assistant | `PortalMessage.component.tsx:171–280` | left-aligned block list |
| Streaming (in-flight) assistant | `PortalSession.component.tsx:71–88` (`MessageList`) | renders `streamingBlocks` inline — **not** a `PortalMessage`, has no `created` |
| Relative-time formatter (precedent) | `DateFactory.relativeTime(ts)` (`packages/core/src/utils/date.factory.ts:152`) | `"just now" / "5m ago" / "3h ago" / "2d ago"`; already used by `RecentPortalsList.component.tsx:80` |

`message` (`PortalMessageResponse`) carries `created`. `PortalMessageUI` is a clean pure-UI component (props-only) — the right seam for the label.

## Decision — formatting

Two options from the ticket: relative (`"5m ago"`) vs short local time-of-day (day/time).

**Decision: absolute local date+time** — `new Intl.DateTimeFormat(undefined, { month, day, hour, minute }).format(created)` → e.g. "Jul 8, 2:34 PM", rendered in the **viewer's browser timezone + locale**, with a full timezone-qualified datetime tooltip on `title`.

**Why not relative time (revised after #180 smoke):** the initial pick was `DateFactory.relativeTime` ("5m ago"), reusing the `RecentPortalsList` formatter. Smoke surfaced the problem: `relativeTime` is pure elapsed-ms (`Date.now() - created`), so it's *timezone-independent* — a message sent just after the viewer's local midnight shows "1h ago" (correct by elapsed time) even though it's "yesterday" on the viewer's calendar (reported from MDT). For a **thread**, an absolute local timestamp is both clearer and unambiguous across a local-day boundary. It's also **pure** — depends only on `created` + the (stable) browser locale/tz, never on "now" — which satisfies the `react-hooks/purity` lint (a `Date.now()`/`new Date()` in render is an error) without a now-tick.

Trade-off accepted: no relative "Today/Yesterday" prefix (that needs "now", which is impure in render and would reintroduce drift). Absolute local date+time is unambiguous and standard for a sparse thread.

## Plan — one slice

New pure-UI primitive (Component File Policy: a named, reused fragment gets its own file — mirrors `FormAlert.component.tsx`), wired into all three render sites.

**Files**
- New: `apps/web/src/components/MessageTimestamp.component.tsx` — `MessageTimestamp` (pure UI): props `{ created: number; align?: "left" | "right" }`; renders a `<Typography variant="caption" color="text.secondary" title={toLocaleString}>` showing `DateFactory.relativeTime(created)`.
- Edit: `apps/web/src/components/PortalMessage.component.tsx` — render `<MessageTimestamp created={message.created} align="right" />` under the user bubble and `align="left"` under the assistant block group.
- Edit: `apps/web/src/components/PortalSession.component.tsx` — render `<MessageTimestamp created={Date.now()} />` under the in-flight `streamingBlocks` group (a sensible "just now"; not blank until persisted).

**Tests**
- New: `apps/web/src/__tests__/MessageTimestamp.test.tsx` — renders a known `created`, asserts the relative label text and the `title` full-datetime attribute.
- Edit: `PortalMessage` UI test (`apps/web/src/__tests__/PortalMessage.test.tsx` if present) — drive `PortalMessageUI` with a `created` and assert the label renders for both roles.
- `npm run test:unit` (web), `type-check`, `lint`.

**Accessibility:** label is text (not color-only); `title` carries the exact datetime for the short relative label. No `role` needed on a caption.

## Smoke (manual, against your dev stack)
1. Open a portal session with existing history → every user + assistant message shows a relative timestamp; hover shows the full datetime.
2. Send a new prompt → the in-flight assistant response shows "just now" while streaming (not blank), and the persisted messages keep their timestamps after the stream completes.
3. Mobile width → timestamps don't break the bubble layout (caption under each).

## Out of scope
- Grouping/day-divider headers ("Today", "Yesterday") — relative labels + tooltip suffice for v1.
- Live-ticking relative times (a re-render interval) — acceptable to update on the next message/refetch.
- Any API/schema/migration work — `created` already exists.
