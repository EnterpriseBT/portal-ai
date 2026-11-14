# Portals AI — Accessibility Conformance Report

**WCAG 2.2 edition.** This report follows the structure of the ITI VPAT® 2.x WCAG edition. It covers WCAG 2.2 Level A and Level AA, and the WAI-ARIA Authoring Practices (APG) patterns the interface follows.

## Product information

| | |
|---|---|
| **Product** | Portals AI: the web application and the public marketing site |
| **Evaluated build** | `epic/a11y-conformance` at `a590c6cd` (2026-11-13), plus the walks recorded in `docs/A11Y_AUDIT.md` |
| **First release carrying it** | The first production release after epic #791 merges to `main` |
| **Report date** | 2026-11-14 |
| **Contact** | support@portalsai.io (accessibility feedback); sales@portalsai.io (procurement and report requests) |
| **Evidence log** | [`docs/A11Y_AUDIT.md`](A11Y_AUDIT.md): the automated audit history, the keyboard pass (KB-nn), the resize, reflow, text-spacing and orientation pass (RZ-nn), and the screen-reader pass (SR flows) |

## Scope

- **Covered:** the signed-in web application, as a member with any set of permissions. The SaaS service and residency (self-hosted) installs run the same codebase, so this report covers both. The application's sign-in page (`/login`). The public marketing site.
- **Not covered: third-party hosted pages.** Sign-in hands off to Google or Auth0, and billing checkout hands off to Stripe Checkout. Those pages are the vendors' own and are outside this report.
- **Content the agent authors.** Charts (`visualize_d3`) and maps (`visualize_map`) are generated per request. The text alternatives around them are the product's and are covered. The graphic itself is covered with the limitation recorded under 1.4.1 and 1.4.11.

## Evaluation methods

Automated checks that gate every pull request in CI:
- **jsx-a11y, strict preset**, in `npm run lint` for the web app, the shared component library and the marketing site (eslint-plugin-astro's `flat/jsx-a11y-strict`). Lint is a zero-warning gate.
- **axe-core (jest-axe) in component tests.** Every component's own test runs `expectNoAxeViolations` against WCAG 2.2 A/AA and best-practice rules, and `component-axe.guard.test.ts` fails CI on a component whose test doesn't. Every component that renders a dialog runs axe on the open dialog in its own test (guard R6); the dialog test checklist adds the error state, which code review enforces. jsdom can't measure colour contrast or landmarks, so those two rules are off there.
- **`theme-contrast.test.ts`** holds both themes' palettes (Brand and Brand Dark) at AA: text 4.5:1, large text and UI components 3:1.

There is no browser-based axe run in CI. A full browser audit (axe in Playwright across every app route for three member configurations, five page states and both themes, plus every marketing-site page) last ran on 2026-11-13 and found no violations. It isn't repeated per pull request.

Manual and scripted walks:
- **Keyboard pass** (2026-11-04, re-walked 2026-11-05): six flows, keyboard only, in Chromium. Checks 2.1.1, 2.1.2, 2.4.3, 2.4.7, 2.4.11, 2.5.7 and 2.5.8. Three of its rows (KB-07…KB-09) were confirmed by code inspection rather than walked. KB-11 (a persistent error-toast stack over focused controls) was added on 2026-11-14. 3.3.7 is evidenced by the screen-reader pass and 3.3.8 by inspection of the sign-in page.
- **Screen-reader pass** (2026-11-05): the same six flows with VoiceOver + Safari (macOS) and NVDA + Firefox (Windows).
- **Resize, reflow, text-spacing and orientation pass** (2026-11-13, re-run in Brand Dark 2026-11-14): scripted in Chromium, both themes. 320 CSS px; WCAG text-spacing overrides; 200% text and 200% zoom; four orientations. Covers the app, a dialog, the spreadsheet region editor and every marketing-site page.

APG patterns used: dialog (modal), grid (the spreadsheet region editor and editable tables), tabs, menu and menu button, accordion, combobox (searchable selects), disclosure, and the toolbar's live result announcements.

## Terms

- **Supports:** the functionality meets the criterion without known defects, or meets it with equivalent facilitation.
- **Partially Supports:** some functionality doesn't meet the criterion. Each such row names the limitation and the open issue tracking it.
- **Does Not Support:** the majority of functionality doesn't meet the criterion.
- **Not Applicable:** the criterion isn't relevant to the product.

## Table 1: Success Criteria, Level A

| Criteria | Conformance Level | Remarks and Explanations |
|---|---|---|
| 1.1.1 Non-text Content | Partially Supports | Images carry alt text (jsx-a11y `alt-text`), icon-only buttons are named, decorative icons are hidden. Every chart and map is a figure named by its title and described by a visible summary that the agent must write. "Show data" opens the plotted data as a table; a map offers "Features in view" (#796). **Limitation:** the chart and map alternatives are held by unit tests, but their screen-reader walk (SR flow 3, steps 3 and 5) hasn't been done yet, so this row stays Partially Supports until it is. Tracked in #800. |
| 1.2.1 Audio-only and Video-only (Prerecorded) | Not Applicable | The product contains no audio or video. |
| 1.2.2 Captions (Prerecorded) | Not Applicable | No audio or video. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | Not Applicable | No audio or video. |
| 1.3.1 Info and Relationships | Supports | One `h1` per page and ordered headings; landmarks (skip link, Primary navigation, main). Tables are named, with header cells and `aria-sort` on the sorted column. Form fields are labelled, with errors linked by `aria-describedby`. Lists, groups and dialogs use native or APG semantics. Checked by jsx-a11y, component axe tests and the screen-reader pass. |
| 1.3.2 Meaningful Sequence | Supports | Reading order follows DOM order, and nothing is reordered visually. Confirmed by the screen-reader pass. |
| 1.3.3 Sensory Characteristics | Supports | Instructions don't rely on shape, position or sound alone. The region editor's "drag to outline a region" also offers a typed range ("type its range"). |
| 1.4.1 Use of Color | Partially Supports | The product's own UI never uses colour alone: status chips carry text, errors carry text and an icon, and focus has a ring. **Limitation:** agent-generated charts and map layers can tell categories apart by colour alone; no colour or labelling contract binds the agent. The data stays available as text through the summary, "Show data" and "Features in view". Tracked in #1022. |
| 1.4.2 Audio Control | Not Applicable | No audio. |
| 2.1.1 Keyboard | Supports | Every function works from the keyboard (keyboard pass KB-01…KB-10, all closed; KB-07…KB-09 confirmed by inspection). The spreadsheet region editor is a keyboard grid: Shift-selection plus Enter creates a region, Enter opens one. Column reordering has Move up/down buttons. A map's canvas takes arrow keys, and its features are reachable through "Features in view". The chart and map keyboard paths are held by #796's tests, not by a walk: the evaluation org's plan doesn't include the Visualize or GIS toolpacks. |
| 2.1.2 No Keyboard Trap | Supports | Every walked page completed a full tab cycle. Dialogs return focus to their trigger on close. |
| 2.1.4 Character Key Shortcuts | Supports | There are no single-character shortcuts. The region editor's Delete/Backspace and Escape act only while focus is on the sheet, and its other shortcuts use a modifier. |
| 2.2.1 Timing Adjustable | Partially Supports | No session or form has a time limit; sign-in renews silently. Error notifications persist until dismissed. **Limitation:** success notifications hide after 4 s and info/warning after 6 s, and hovering or focusing doesn't pause them. Two info notices (a cleared view filter, an unconfirmed Stripe subscription) say something the page doesn't. Tracked in #1021. |
| 2.2.2 Pause, Stop, Hide | Supports | No content moves, blinks or scrolls automatically. Loading indicators stop when their content arrives. Live updates (a streaming reply, job progress) are started by the user and end when the work does. |
| 2.3.1 Three Flashes or Below Threshold | Supports | Nothing flashes. |
| 2.4.1 Bypass Blocks | Supports | Every app layout starts with a "Skip to main content" link and every site page with "Skip to content", and landmarks are named (KB-01). |
| 2.4.2 Page Titled | Supports | Each page's title is `<h1> · Portals AI`, set by the route announcer, which also moves focus to the `h1` after navigation. Site pages carry their own titles. |
| 2.4.3 Focus Order | Supports | Focus order follows reading order. List pages open on their `h1`, not on a search field (KB-02). Dialogs move focus in and back. |
| 2.4.4 Link Purpose (In Context) | Supports | Links are named by their text or label. Row and card links name their object, and icon-only row actions name their row ("Delete {name}"). |
| 2.5.1 Pointer Gestures | Supports | No multipoint or path gesture is required. Maps have zoom buttons and double-click-to-zoom alongside pinch. |
| 2.5.2 Pointer Cancellation | Supports | Controls activate on release (native and MUI buttons). No down-event actions. |
| 2.5.3 Label in Name | Supports | Accessible names begin with or contain the visible label (e.g. visible "Delete", name "Delete {name}"). |
| 2.5.4 Motion Actuation | Not Applicable | No function uses device motion. |
| 3.1.1 Language of Page | Supports | `<html lang="en">` in the app and on the site. |
| 3.2.1 On Focus | Supports | Focus never changes context. |
| 3.2.2 On Input | Supports | Changing a field never navigates or submits. Filters and category chips update the list in place and replace the URL. |
| 3.2.6 Consistent Help | Supports | Help sits in the same place in the app's navigation on every page. The site's contact link sits in the same place in its footer. |
| 3.3.1 Error Identification | Supports | Field errors appear as text after blur or submit and mark the field `aria-invalid`, and focus moves to the first invalid field. Server errors appear in an alert within the form. |
| 3.3.2 Labels or Instructions | Supports | Every field has a visible label; required fields are marked. Helper text gives the expected format where one applies. |
| 3.3.7 Redundant Entry | Supports | Multi-step wizards keep earlier input across steps, and a failed import keeps the user's input in the dialog. Confirmed end to end in the screen-reader pass (flow 2). |
| 4.1.1 Parsing | Supports | WCAG 2.2 treats this criterion as obsolete and always satisfied. The markup is generated by React and Astro. |
| 4.1.2 Name, Role, Value | Supports | Controls use native elements or APG patterns with names, roles and states (selected tab, expanded accordion, checked option, `aria-current` page, `aria-disabled` with its reason as a description). Checked by jsx-a11y, component axe tests and the screen-reader pass. |

## Table 2: Success Criteria, Level AA

| Criteria | Conformance Level | Remarks and Explanations |
|---|---|---|
| 1.2.4 Captions (Live) | Not Applicable | No live audio or video. |
| 1.2.5 Audio Description (Prerecorded) | Not Applicable | No video. |
| 1.3.4 Orientation | Supports | Content works in portrait and landscape at tablet and phone sizes. Nothing locks orientation (RZ-05). |
| 1.3.5 Identify Input Purpose | Supports | The only field that collects the user's own information, the sign-in email, carries `autocomplete="email"`. Other fields hold data about other things (connectors, records, invitees). |
| 1.4.3 Contrast (Minimum) | Supports | Both themes' text colours are held at 4.5:1 (3:1 for large text) by `theme-contrast.test.ts`, and code-block token colours too. The last full browser audit (2026-11-13) found no contrast violations in either theme. Text inside an agent-generated chart is covered by 1.4.1 and 1.4.11's limitation (#1022). |
| 1.4.4 Resize Text | Supports | No loss of content or function at 200% text-only zoom or 200% browser zoom, in both themes, in the app, dialogs, the region editor or on the site (RZ-03, RZ-04). On the site, text-only zoom caps the page heading at 1.23×; browser zoom scales it fully. |
| 1.4.5 Images of Text | Supports | Text is rendered as text; the only images of text are the logos. |
| 1.4.10 Reflow | Partially Supports | At 320 CSS px, in both themes, every walked page, dialog and the region editor reflow to one column, and only tables, grids and code scroll in two dimensions. Charts and maps weren't walked: the evaluation org's plan doesn't include the Visualize or GIS toolpacks. **Limitation:** connector detail pages scroll sideways, because the Capabilities row doesn't wrap and the Config code block's box doesn't shrink (RZ-01). Tracked in #1019. |
| 1.4.11 Non-text Contrast | Partially Supports | Focus rings, field borders, chips and controls are held at 3:1 in both themes by `theme-contrast.test.ts`. **Limitation:** no contrast check covers the lines, bars, markers and map features in agent-generated charts and maps. Tracked in #1022. |
| 1.4.12 Text Spacing | Partially Supports | With WCAG's text-spacing overrides, in both themes, no content is lost on any walked app page, dialog, the region editor or the site. **Limitation:** long card titles (connector and other card lists) are cut off mid-word instead of wrapping or ending in an ellipsis; the full name stays in the card's link name (RZ-02). Tracked in #1020. |
| 1.4.13 Content on Hover or Focus | Supports | Tooltips (MUI) can be hovered, stay while hovered or focused, and close on Escape. A disabled control's reason is also its permanent description, not only a tooltip. |
| 2.4.5 Multiple Ways | Supports | App pages are reached through the navigation, breadcrumbs and the dashboard, and list pages are searchable. Site pages are reached through the header navigation, the footer navigation and links from the home page. |
| 2.4.6 Headings and Labels | Supports | Headings and labels describe their topic or purpose. Option lists name each option distinctly (#986). |
| 2.4.7 Focus Visible | Supports | Every focusable control gets a 2px focus ring from the theme, in both themes (KB-04, KB-05). |
| 2.4.11 Focus Not Obscured (Minimum) | Partially Supports | The app header doesn't cover focused controls, and dialogs keep focus inside them. **Limitation:** error notifications persist until dismissed and stack at the bottom right over the page. With two or three showing, controls near the bottom of a page (e.g. a table's last rows' actions) can take focus while fully covered (KB-11). Tracked in #1024. |
| 2.5.7 Dragging Movements | Supports | Each drag has a single-pointer alternative: Move up/down for column order (KB-07); a typed range or click-selection for regions (KB-08); zoom buttons and double-click-to-zoom for maps. |
| 2.5.8 Target Size (Minimum) | Supports | Targets are at least 24 × 24 CSS px or meet the spacing exception (KB-06, KB-10). Inline links in sentences are exempt. |
| 3.1.2 Language of Parts | Supports | The interface is English throughout. Data the user brings is shown as entered. |
| 3.2.3 Consistent Navigation | Supports | The app shell and the site's header and footer repeat in the same order on every page. |
| 3.2.4 Consistent Identification | Supports | The same functions carry the same names and icons across the product (shared components). |
| 3.3.3 Error Suggestion | Supports | Validation messages say how to fix the input (limits, required fields, formats). Server errors carry a message and code. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Supports | Deletes ask for confirmation. Billing changes complete on Stripe's own checkout page, which reviews them before payment. |
| 3.3.8 Accessible Authentication (Minimum) | Supports | The product's sign-in page asks for no cognitive test: an email field (autocomplete enabled) and provider buttons. Authentication itself happens on Google's or Auth0's page, which is outside scope. |
| 4.1.3 Status Messages | Supports | Status messages render through `StatusMessage` (`role="status"`, or `role="alert"` for an error) or as a notification in the one Notifications region, and never take focus. List toolbars announce result counts after a search, filter or page change. Streaming replies and job progress are announced without moving focus (screen-reader pass). |

## Keeping this report true

The report is a durable reference. `CLAUDE.md` → "Keeping Documentation in Sync" lists it as a documentation surface. A change that adds a page or route, an interactive pattern, a third-party hosted step, or changes keyboard, focus or announcement behaviour, or the accessibility checks, re-checks the affected rows, the methods section and the report date in the same pull request. When a tracked issue closes, its row moves to Supports with the evidence that closed it.
