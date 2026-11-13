/**
 * The /smoke-walk skill audits each step with axe (#799) by running the
 * snippet between `<!-- axe-tags:start -->` and `<!-- axe-tags:end -->` in
 * its SKILL.md. The snippet's `TAGS` must be the walks' own `AXE_TAGS`, so
 * an agent's walk and `npm run a11y:axe` judge a page by the same rules.
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
  const tags = block && /\bTAGS\s*=\s*\[([^\]]*)\]/.exec(block[1]);
  if (!tags) return null;
  return [...tags[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("/smoke-walk's axe tags", () => {
  it("reads the snippet's TAGS between the markers", () => {
    expect(
      skillTags(
        'x\n<!-- axe-tags:start -->\n```js\nasync (page) => {\n  const TAGS = ["wcag2a", "best-practice"];\n  await page.addScriptTag({ path: "/x/axe.min.js" });\n}\n```\n<!-- axe-tags:end -->'
      )
    ).toEqual(["wcag2a", "best-practice"]);
    expect(skillTags("no markers")).toBeNull();
    expect(
      skillTags("<!-- axe-tags:start -->no list<!-- axe-tags:end -->")
    ).toBeNull();
  });

  it("are the walks' AXE_TAGS", () => {
    expect(skillTags(readFileSync(SKILL, "utf8"))).toEqual([...AXE_TAGS]);
  });
});
