import { readFileSync } from "node:fs";

// #293 slice 5, spec case 24. The convention IS the thing being fixed, so it
// is asserted at source level: a behavioral test cannot catch a future
// reintroduction of a local Snackbar, and that reintroduction is the failure
// mode this ticket exists to prevent.

const read = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

/** Migrated off their own Snackbar in #293. */
const MIGRATED = [
  "views/Toolpacks.view.tsx",
  "views/Settings.view.tsx",
  "views/EditLayoutPlan.view.tsx",
];

/**
 * Recorded exceptions, NOT precedents: polling and progress are not toast
 * surfaces. Each must keep saying so in-file, so the next reader finds a
 * decision rather than an oversight.
 */
const HOLDOUTS = [
  "components/UpdateBanner.component.tsx",
  "components/ConnectorInstanceSyncFeedback.component.tsx",
];

describe("toast migrations (#293)", () => {
  it.each(MIGRATED)("%s no longer owns a Snackbar", (file) => {
    const source = read(file);
    expect(source).not.toContain('from "@mui/material/Snackbar"');
    expect(source).not.toContain("<Snackbar");
  });

  it.each(MIGRATED)("%s raises through useToast instead", (file) => {
    expect(read(file)).toContain("useToast");
  });
});

describe("toast holdouts (#293)", () => {
  it.each(HOLDOUTS)("%s keeps its Snackbar", (file) => {
    expect(read(file)).toContain("<Snackbar");
  });

  it.each(HOLDOUTS)("%s records WHY it is exempt", (file) => {
    // A bare exemption invites a sixth Snackbar; the reason is the guard.
    const source = read(file);
    expect(source).toMatch(/NOT a toast/i);
    expect(source).toContain("#293");
  });
});
