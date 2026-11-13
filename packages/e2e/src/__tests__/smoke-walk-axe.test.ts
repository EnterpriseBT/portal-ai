/**
 * The /smoke-walk skill audits each step with axe (#799), listing the tags it
 * runs between `<!-- axe-tags:start -->` and `<!-- axe-tags:end -->` in its
 * SKILL.md. They must be the walks' own `AXE_TAGS`, so an agent's walk and
 * `npm run a11y:axe` judge a page by the same rules.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { AXE_TAGS } from "../lib/a11y-walk.js";

const SKILL = path.resolve(
  process.cwd(),
  "../../.claude/skills/smoke-walk/SKILL.md"
);

function skillTags(markdown: string): string[] | null {
  const block = /<!-- axe-tags:start -->([\s\S]*?)<!-- axe-tags:end -->/.exec(
    markdown
  );
  if (!block) return null;
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("/smoke-walk's axe tags", () => {
  it("reads the tags between the markers", () => {
    expect(
      skillTags(
        'x\n<!-- axe-tags:start -->\n```js\n["wcag2a", "best-practice"]\n```\n<!-- axe-tags:end -->'
      )
    ).toEqual(["wcag2a", "best-practice"]);
    expect(skillTags("no markers")).toBeNull();
  });

  it("are the walks' AXE_TAGS", () => {
    expect(skillTags(readFileSync(SKILL, "utf8"))).toEqual([...AXE_TAGS]);
  });
});
