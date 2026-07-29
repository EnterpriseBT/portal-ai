/**
 * Convention guard (#286) — components must not hand-roll HTTP.
 *
 * `CLAUDE.md` → "API Calls & SDK Helpers (apps/web)": *"No component — view,
 * workflow, module, or primitive — may call `fetch`, `useAuthFetch`, or
 * `fetchWithAuth` directly."* #286 was one such bypass surviving beside the
 * SDK endpoint that should have served it, in a file that also contained a
 * correct SDK mutation — so the file itself taught both patterns.
 *
 * This asserts over the source rather than behavior because the convention
 * *is* the deliverable: a future hand-rolled fetch fails here rather than
 * waiting to be noticed in review.
 *
 * Scope is deliberately narrow — the files #286 fixed. Widening it to all of
 * `apps/web` needs the sweep ticket the issue names as out of scope, since
 * other call sites are known to still violate this.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = join(here, "..");

const GUARDED_FILES = [
  "components/PortalMessage.component.tsx",
  "views/PinnedResultDetail.view.tsx",
];

describe("portal-results call sites route through the SDK (#286)", () => {
  it.each(GUARDED_FILES)("%s calls no HTTP helper directly", (relative) => {
    const source = readFileSync(join(webSrc, relative), "utf8");

    expect(source).not.toMatch(/\buseAuthFetch\b/);
    expect(source).not.toMatch(/\bfetchWithAuth\b/);
  });

  it.each(GUARDED_FILES)("%s uses the portal-results SDK", (relative) => {
    const source = readFileSync(join(webSrc, relative), "utf8");

    expect(source).toMatch(/sdk\.portalResults\.remove\(\)/);
  });
});
