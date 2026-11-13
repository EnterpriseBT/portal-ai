/**
 * Fixture checks for the story gate's pure helpers (#799). Run with the
 * sweep by `npm run a11y:stories`.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

import {
  orphanedSkips,
  repoStoryFiles,
  SKIPPED,
  STORY_SHARDS,
  type RawRun,
  staleSkips,
  unlistedSkips,
  violatingRuns,
} from "./story-sweep";

describe("story gate helpers", () => {
  const run = (
    story: string,
    status: RawRun["status"],
    ids: string[] = [],
    error?: string
  ): RawRun => ({
    context: { file: "pkg/src/A.stories.tsx", story },
    status,
    error,
    violations: ids.map((id) => ({
      id,
      impact: "serious",
      tags: [],
      nodes: [],
    })),
  });

  it("lists a rendered story with violations, with its rule ids", () => {
    expect(
      violatingRuns([
        run("Clean", "ok"),
        run("Bad", "ok", ["button-name", "label"]),
        run("Broken", "skipped", [], "boom"),
      ])
    ).toEqual(["pkg/src/A.stories.tsx#Bad: button-name, label"]);
  });

  it("lists a skip the allowlist doesn't name", () => {
    const runs = [
      run("Listed", "skipped", [], "a"),
      run("New", "skipped", [], "b"),
    ];
    expect(
      unlistedSkips(runs, { "pkg/src/A.stories.tsx#Listed": "reason" })
    ).toEqual(["pkg/src/A.stories.tsx#New: b"]);
  });

  it("lists an allowlisted story that renders now or is gone", () => {
    const runs = [run("Fixed", "ok"), run("Still", "skipped", [], "x")];
    expect(
      staleSkips(runs, {
        "pkg/src/A.stories.tsx#Fixed": "reason",
        "pkg/src/A.stories.tsx#Still": "reason",
        "pkg/src/A.stories.tsx#Gone": "reason",
      })
    ).toEqual(["pkg/src/A.stories.tsx#Fixed", "pkg/src/A.stories.tsx#Gone"]);
  });

  it("has exactly one shard file per shard, so no story file goes unswept", () => {
    const dir = path.join(process.cwd(), "src", "__tests__", "__a11y__");
    const shards = readdirSync(dir)
      .filter((f) => /^stories-\d+\.a11y\.tsx$/.test(f))
      .sort();
    expect(shards).toEqual(
      Array.from(
        { length: STORY_SHARDS },
        (_, i) => `stories-${i + 1}.a11y.tsx`
      ).sort()
    );
  });

  it("lists an allowlisted story whose file is gone", () => {
    expect(
      orphanedSkips(
        {
          "pkg/src/A.stories.tsx#Kept": "reason",
          "pkg/src/Gone.stories.tsx#X": "reason",
          "pkg/src/Gone.stories.tsx#*": "reason",
        },
        ["pkg/src/A.stories.tsx"]
      )
    ).toEqual(["pkg/src/Gone.stories.tsx#X", "pkg/src/Gone.stories.tsx#*"]);
  });

  it("allowlists no story whose file is gone", () => {
    if (process.env.A11Y_REPORT_ONLY === "1") return;
    expect(orphanedSkips(SKIPPED, repoStoryFiles())).toEqual([]);
  });
});
