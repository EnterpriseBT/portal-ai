/**
 * The raw result format the accessibility walks write (#792), read by
 * `scripts/a11y-inventory.mjs`. The web and core stories sweeps write the
 * same shape. Node HTML is dropped: it can carry page text (seeded names,
 * values), and the inventory needs only where a violation was, not what it
 * said.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { E2eIdentity } from "./target.js";

export type A11yState = "populated" | "empty" | "error" | "loading" | "locked";
export type A11yTheme = "brand" | "brand.dark";
export const A11Y_THEMES: readonly A11yTheme[] = ["brand", "brand.dark"];

export interface RawViolation {
  id: string;
  impact: string | null;
  tags: string[];
  nodes: { target: string[] }[];
}

export interface RawRun {
  context: {
    route?: string;
    url?: string;
    owner?: number;
    role?: E2eIdentity | null;
    state?: A11yState;
    theme?: A11yTheme;
  };
  status: "ok" | "skipped";
  error?: string;
  violations: RawViolation[];
}

export interface RawResultFile {
  tool: "axe-app" | "axe-site";
  package: string;
  generatedAt: string;
  axeVersion: string;
  runs: RawRun[];
}

/** The parts of an axe result this reads. axe's own objects carry more
 *  (description, html, failureSummary), which is what gets dropped. */
interface AxeViolationLike {
  id: string;
  impact?: string | null;
  tags: string[];
  nodes: ({ target: unknown[] } & Record<string, unknown>)[];
  [key: string]: unknown;
}

const selector = (t: unknown): string =>
  Array.isArray(t) ? t.map(String).join(" >>> ") : String(t);

export function trimViolations(violations: AxeViolationLike[]): RawViolation[] {
  return violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? null,
    tags: [...v.tags],
    nodes: v.nodes.map((n) => ({ target: n.target.map(selector) })),
  }));
}

export function writeRawResults(file: string, data: RawResultFile): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}
