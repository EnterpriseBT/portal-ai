#!/usr/bin/env node
/**
 * Fails when the review-chain merge gate drifts between the surfaces that
 * describe it (#634).
 *
 * Why this exists: the gate lives in prose across three places that drift
 * independently — `CLAUDE.md` (the authoritative "### The merge gate" section,
 * the coverage matrix, and the PR `## Test plan` checklist template) and its
 * `.github/copilot-instructions.md` mirror — plus two skills (`/adversarial-review`
 * scaffolds the checklist, generalized `/smoke-walk` walks it). Every one of
 * these can be edited without touching the others, and the failure is silent:
 * a PR checklist that quietly drops `security`, or a mirror that never learned
 * about `adversarial`, reads as fine in the diff and gates nothing. None of it
 * had a test before this script. This is the same class of silent doc-drift the
 * repo already guards with `check-ci-cache.mjs` / `check-doc-pointers.mjs`.
 *
 * Prose has no natural unit-test surface, so the four rules are exercised
 * against embedded synthetic fixtures on every run, then against the real tree.
 * `--self-test` runs only the fixtures.
 *
 * Rules (see `docs/REVIEW_CHAIN_MERGE_GATE.spec.md` §E):
 *   1. The four gate phases are named in BOTH CLAUDE.md's merge-gate section
 *      and the copilot mirror's lifecycle section.
 *   2. The PR `## Test plan` gate checklist lists exactly the five conditions,
 *      in canonical order (CI + the four phases).
 *   3. `/adversarial-review` SKILL.md exists and declares its name; `/smoke-walk`
 *      references both `.smoke.md` and `.adversarial.md`.
 *   4. The coverage matrix carries a row for every documented ticket kind.
 *
 * Usage: npm run lint:review-chain [-- --self-test]
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CLAUDE_MD = "CLAUDE.md";
const COPILOT_MD = ".github/copilot-instructions.md";
const ADVERSARIAL_SKILL = ".claude/skills/adversarial-review/SKILL.md";
const SMOKE_WALK_SKILL = ".claude/skills/smoke-walk/SKILL.md";

/** The four human-confirmed review phases, in chain order. */
const GATE_PHASES = ["code-review", "security", "smoke", "adversarial"];

/** The five merge-gate conditions the PR checklist must list, in order. */
const GATE_CONDITIONS = ["ci", ...GATE_PHASES];

/** Every ticket kind the coverage matrix must address. */
const TICKET_KINDS = [
  { key: "feature", re: /feature/i },
  { key: "bug", re: /\bbug\b/i },
  { key: "condensed", re: /condensed/i },
  { key: "chore", re: /chore/i },
  { key: "trivial", re: /trivial/i },
];

/** Leading `#` count of a markdown heading line, or 0 if not a heading. */
function headingLevel(line) {
  const m = /^(#{1,6})\s/.exec(line);
  return m ? m[1].length : 0;
}

/**
 * The body of the first section whose heading matches `headingRe`, up to (not
 * including) the next heading of the same or a higher level. "" if not found.
 * Deliberately text-based: these sections are prose + tables, not structured
 * data, so the fixtures and the real tree run the exact same extraction.
 */
function sliceSection(md, headingRe) {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start === -1) return "";
  const level = headingLevel(lines[start]);
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const lvl = headingLevel(lines[i]);
    if (lvl > 0 && lvl <= level) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

/** Map a checklist label to its canonical condition key, or null if unknown. */
function labelToConditionKey(label) {
  const lower = label.toLowerCase();
  for (const phase of GATE_PHASES) if (lower.includes(phase)) return phase;
  if (/\bci\b/.test(lower)) return "ci";
  return null;
}

/**
 * The ordered condition keys of the PR `## Test plan` gate checklist — the
 * `- [ ] …` lines directly under a `## Merge gate` heading (fenced or not).
 * null when no such checklist block is present.
 */
function parseGateChecklist(md) {
  const lines = md.split("\n");
  // Leading whitespace tolerated: the template is naturally indented under a
  // PR-body list item, and may sit inside a fenced block.
  const start = lines.findIndex((l) => /^\s*##\s+Merge gate\s*$/.test(l));
  if (start === -1) return null;
  const keys = [];
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^\s*- \[[ xX]\]\s+(.*)$/.exec(lines[i]);
    if (!m) {
      if (lines[i].trim() === "") continue; // tolerate a blank line inside the block
      break;
    }
    keys.push(labelToConditionKey(m[1]));
  }
  return keys;
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Finds every rule violation. Pure: takes already-read text, touches no
 * filesystem, so the fixtures below and the real tree share one code path.
 *
 * @param {{claudeMd?: string, copilotMd?: string, adversarialSkill?: string|null, smokeWalkSkill?: string|null}} input
 * @returns {Array<{rule: number, file: string, message: string}>}
 */
export function findViolations({
  claudeMd = "",
  copilotMd = "",
  adversarialSkill = null,
  smokeWalkSkill = null,
} = {}) {
  const violations = [];

  // Rule 1 — both surfaces name all four phases in their gate/lifecycle section.
  const gateSection = sliceSection(claudeMd, /^###\s+The merge gate\b/);
  if (!gateSection) {
    violations.push({
      rule: 1,
      file: CLAUDE_MD,
      message: 'no "### The merge gate" section — the authoritative gate description is missing.',
    });
  } else {
    const missing = GATE_PHASES.filter((p) => !gateSection.toLowerCase().includes(p));
    if (missing.length) {
      violations.push({
        rule: 1,
        file: CLAUDE_MD,
        message: `the merge-gate section does not name ${missing.join(", ")}. All four review phases must appear there.`,
      });
    }
  }

  const copilotLifecycle = sliceSection(copilotMd, /^##\s+Issue → PR workflow/);
  if (!copilotLifecycle) {
    violations.push({
      rule: 1,
      file: COPILOT_MD,
      message: 'no "## Issue → PR workflow" lifecycle section — the mirror cannot describe the gate.',
    });
  } else {
    const missing = GATE_PHASES.filter((p) => !copilotLifecycle.toLowerCase().includes(p));
    if (missing.length) {
      violations.push({
        rule: 1,
        file: COPILOT_MD,
        message: `the lifecycle mirror does not name ${missing.join(", ")}. It must stay in sync with CLAUDE.md's gate (a mirror that drops a phase gates nothing).`,
      });
    }
  }

  // Rule 2 — the PR checklist lists exactly the five conditions, in order.
  const checklist = parseGateChecklist(claudeMd);
  if (checklist === null) {
    violations.push({
      rule: 2,
      file: CLAUDE_MD,
      message: 'no "## Merge gate" PR checklist template — the PR `## Test plan` gate checklist is undocumented.',
    });
  } else if (!arraysEqual(checklist, GATE_CONDITIONS)) {
    violations.push({
      rule: 2,
      file: CLAUDE_MD,
      message:
        `the PR gate checklist is [${checklist.join(", ") || "empty"}], expected ` +
        `[${GATE_CONDITIONS.join(", ")}] in that order. A checklist that drops or reorders ` +
        `a condition silently changes what merges.`,
    });
  }

  // Rule 3 — the two skills exist and cross-reference the checklist docs.
  if (!adversarialSkill) {
    violations.push({
      rule: 3,
      file: ADVERSARIAL_SKILL,
      message: "missing — the /adversarial-review scaffolder skill must exist.",
    });
  } else if (!/^name:\s*adversarial-review\s*$/m.test(adversarialSkill)) {
    violations.push({
      rule: 3,
      file: ADVERSARIAL_SKILL,
      message: "does not declare `name: adversarial-review` in its frontmatter.",
    });
  }

  if (!smokeWalkSkill) {
    violations.push({
      rule: 3,
      file: SMOKE_WALK_SKILL,
      message: "missing — /smoke-walk is the shared walk engine and must exist.",
    });
  } else {
    for (const ref of [".smoke.md", ".adversarial.md"]) {
      if (!smokeWalkSkill.includes(ref)) {
        violations.push({
          rule: 3,
          file: SMOKE_WALK_SKILL,
          message: `does not reference \`${ref}\`. The generalized walk must handle both checklist kinds.`,
        });
      }
    }
  }

  // Rule 4 — the coverage matrix addresses every ticket kind.
  const coverage = sliceSection(claudeMd, /^###\s+Coverage by ticket kind\b/);
  if (!coverage) {
    violations.push({
      rule: 4,
      file: CLAUDE_MD,
      message: 'no "### Coverage by ticket kind" matrix — the per-kind gate coverage is undocumented.',
    });
  } else {
    const missing = TICKET_KINDS.filter((k) => !k.re.test(coverage)).map((k) => k.key);
    if (missing.length) {
      violations.push({
        rule: 4,
        file: CLAUDE_MD,
        message: `the coverage matrix has no row for: ${missing.join(", ")}. Every ticket kind needs an explicit coverage rule.`,
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Fixtures — synthetic surfaces asserting the RULE, not today's docs.
// ---------------------------------------------------------------------------

const CHECKLIST_BLOCK = `## Merge gate
- [ ] CI green
- [ ] code-review confirmed (or waived: <reason>)
- [ ] security confirmed (or waived: <reason>)
- [ ] smoke confirmed
- [ ] adversarial confirmed (or waived: <reason>)`;

const cleanClaude = ({
  gatePhases = GATE_PHASES,
  checklist = CHECKLIST_BLOCK,
  kinds = TICKET_KINDS.map((k) => k.key),
} = {}) => `## Issue → PR Workflow

### Pull requests

The PR body's \`## Test plan\` carries the gate checklist:

\`\`\`
${checklist}
\`\`\`

### The merge gate

A PR merges only when all hold: CI green, and the human has confirmed each of
${gatePhases.join(", ")}. The agent produces evidence and never checks a box.

### Coverage by ticket kind

| Ticket kind | code-review | security | smoke | adversarial |
|---|---|---|---|---|
${kinds
  .map((k) => `| ${k[0].toUpperCase() + k.slice(1)} row | required | required | required | required |`)
  .join("\n")}

### After merge

Housekeeping.
`;

const cleanCopilot = ({ gatePhases = GATE_PHASES } = {}) => `## Issue → PR workflow (lifecycle)

One feature = one branch = one PR. The merge gate requires green CI plus human
confirmation of ${gatePhases.join(", ")}. Each phase has a skill.

## Next section

Unrelated.
`;

const cleanAdvSkill = `---
name: adversarial-review
description: scaffold the adversarial probe checklist.
---
# /adversarial-review
`;

const cleanSmokeWalk = ({ refs = [".smoke.md", ".adversarial.md"] } = {}) => `---
name: smoke-walk
description: walk a tagged verification checklist.
---
# /smoke-walk

Resolves ${refs.join(" or ")} for the branch and walks it.
`;

const FIXTURES = [
  {
    name: "all clean",
    input: {
      claudeMd: cleanClaude(),
      copilotMd: cleanCopilot(),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: null,
  },
  {
    name: "rule 1 — CLAUDE.md gate section drops a phase",
    input: {
      claudeMd: cleanClaude({ gatePhases: ["code-review", "security", "smoke"] }),
      copilotMd: cleanCopilot(),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: 1,
  },
  {
    name: "rule 1 — copilot mirror drops a phase",
    input: {
      claudeMd: cleanClaude(),
      copilotMd: cleanCopilot({ gatePhases: ["code-review", "security", "smoke"] }),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: 1,
  },
  {
    name: "rule 2 — indented PR checklist (nested under a bullet) still parses",
    input: {
      claudeMd: cleanClaude({
        checklist: `  ## Merge gate
  - [ ] CI green
  - [ ] code-review confirmed
  - [ ] security confirmed
  - [ ] smoke confirmed
  - [ ] adversarial confirmed`,
      }),
      copilotMd: cleanCopilot(),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: null,
  },
  {
    name: "rule 2 — PR checklist drops security",
    input: {
      claudeMd: cleanClaude({
        checklist: `## Merge gate
- [ ] CI green
- [ ] code-review confirmed
- [ ] smoke confirmed
- [ ] adversarial confirmed`,
      }),
      copilotMd: cleanCopilot(),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: 2,
  },
  {
    name: "rule 2 — PR checklist reordered",
    input: {
      claudeMd: cleanClaude({
        checklist: `## Merge gate
- [ ] code-review confirmed
- [ ] CI green
- [ ] security confirmed
- [ ] smoke confirmed
- [ ] adversarial confirmed`,
      }),
      copilotMd: cleanCopilot(),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: 2,
  },
  {
    name: "rule 2 — no checklist block at all",
    input: {
      claudeMd: cleanClaude({ checklist: "(no checklist here)" }),
      copilotMd: cleanCopilot(),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: 2,
  },
  {
    name: "rule 3 — adversarial-review skill missing",
    input: {
      claudeMd: cleanClaude(),
      copilotMd: cleanCopilot(),
      adversarialSkill: null,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: 3,
  },
  {
    name: "rule 3 — smoke-walk references only .smoke.md",
    input: {
      claudeMd: cleanClaude(),
      copilotMd: cleanCopilot(),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk({ refs: [".smoke.md"] }),
    },
    expectRule: 3,
  },
  {
    name: "rule 4 — coverage matrix missing the chore row",
    input: {
      claudeMd: cleanClaude({ kinds: ["feature", "bug", "condensed", "trivial"] }),
      copilotMd: cleanCopilot(),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: 4,
  },
  {
    name: "rule 4 — coverage section absent",
    input: {
      claudeMd: cleanClaude().replace("### Coverage by ticket kind", "### Something else"),
      copilotMd: cleanCopilot(),
      adversarialSkill: cleanAdvSkill,
      smokeWalkSkill: cleanSmokeWalk(),
    },
    expectRule: 4,
  },
];

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function runSelfTest() {
  const failures = [];

  for (const fixture of FIXTURES) {
    const found = findViolations(fixture.input);

    if (fixture.expectRule === null) {
      if (found.length > 0) {
        failures.push(
          `  ✗ ${fixture.name}\n      expected no violation, got: ${found
            .map((v) => `rule ${v.rule} (${v.message})`)
            .join("; ")}`
        );
      }
      continue;
    }

    if (!found.some((v) => v.rule === fixture.expectRule)) {
      failures.push(
        `  ✗ ${fixture.name}\n      expected a rule ${fixture.expectRule} violation, got: ${
          found.length ? found.map((v) => `rule ${v.rule}`).join("; ") : "none"
        }`
      );
    }
  }

  if (failures.length) {
    console.error(`self-test: ${failures.length} of ${FIXTURES.length} fixture(s) failed\n`);
    console.error(failures.join("\n"));
    return false;
  }

  console.log(`self-test: ${FIXTURES.length} fixture(s) passed`);
  return true;
}

function readOrNull(relPath) {
  try {
    return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
  } catch {
    return null;
  }
}

function runRealTree() {
  const found = findViolations({
    claudeMd: readOrNull(CLAUDE_MD) ?? "",
    copilotMd: readOrNull(COPILOT_MD) ?? "",
    adversarialSkill: readOrNull(ADVERSARIAL_SKILL),
    smokeWalkSkill: readOrNull(SMOKE_WALK_SKILL),
  });

  if (found.length) {
    console.error(`\nreview-chain: ${found.length} violation(s)\n`);
    for (const v of found) console.error(`  ✗ [rule ${v.rule}] ${v.file}: ${v.message}`);
    return false;
  }

  console.log("review-chain: gate surfaces consistent");
  return true;
}

const selfTestOnly = process.argv.includes("--self-test");
const ok = runSelfTest() && (selfTestOnly || runRealTree());
process.exit(ok ? 0 : 1);
