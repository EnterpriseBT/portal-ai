# Wire CloudFormation schema validation + standardize the editor extension set — #524

**Why.** The `epic/demo-org` branch added `yaml.customTags` to `.vscode/settings.json` to silence 360 false-positive "Unresolved tag" warnings from CloudFormation short-form intrinsics (`!Ref`, `!Sub`, …) across `infra/cloudformation/*.yml`. That taught the language server the *tags* but validates nothing. Two follow-ups make the tooling correct and consistent for the whole team: (1) associate the real CFN JSON schema so genuine template mistakes surface, and (2) codify the editor extension set in the devcontainer (today it declares none) so every dev's container stops drifting, while `.vscode/extensions.json` still recommends unused extensions (Tailwind, stylelint) and a nightly TS that conflicts with the pinned workspace TS.

## Current shape

- `.vscode/settings.json` — has `yaml.customTags` (24 CFN intrinsics) + a `[yaml]` prettier formatter, **no** `yaml.schemas`.
- `.devcontainer/devcontainer.json` — no `customizations` block at all.
- `.vscode/extensions.json` — recommends `eslint`, `prettier`, `stylelint`, `tailwindcss`, `typescript-next`; empty `unwantedRecommendations`.
- `infra/cloudformation/*.yml` — 10 templates.

**Discovery — `.vscode/` is gitignored (since `f0c44d49`) and has never been tracked.** The ticket's premise that `epic/demo-org` committed `yaml.customTags` to `.vscode/settings.json` is off: a gitignored file can't be committed, so that fix only ever helped the dev who edited it locally, and both this ticket's `.vscode/` deliverables (CFN `yaml.schemas`, the `extensions.json` set) would be equally local-only. To make them team-wide, we **un-ignore just those two files** — `.vscode/*` then `!.vscode/settings.json` / `!.vscode/extensions.json` (git can't re-include a file whose parent dir is ignored, so the dir contents are ignored and the two files negated). Everything else in `.vscode/` stays ignored. The devcontainer stays the canonical source of truth for the *extension set*; `extensions.json` is its mirror for non-container users plus the `unwantedRecommendations` home.

## Decision — editor-time validation, devcontainer as the source of truth

1. **CFN schema** — add `yaml.schemas` mapping the goformation CloudFormation schema (`https://raw.githubusercontent.com/awslabs/goformation/master/schema/cloudformation.schema.json`, verified live: HTTP 200, 7280 resource-type definitions incl. `AWS::S3::Bucket`) to the `infra/cloudformation/*.yml` glob **only** — workflows and `docker-compose.yml` stay untouched. Keep `yaml.customTags` so short-form intrinsics resolve *under* the schema. Chose goformation (the de-facto redhat.vscode-yaml CFN schema) over SchemaStore, whose hosted URL is dead.
2. **Devcontainer extensions** — declare the 8-extension canonical auto-install set under `customizations.vscode.extensions`. Keep `.vscode/extensions.json` as the mirror for non-container users and the home for `unwantedRecommendations` (which devcontainer customizations can't express).
   - **Add:** `redhat.vscode-yaml` (the schema-validation engine), `astro-build.astro-vscode` (`apps/site` is Astro), `editorconfig.editorconfig` (a real `.editorconfig` is committed, nothing honors it).
   - **Keep:** `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `mtxr.sqltools` + `mtxr.sqltools-driver-pg`, `ms-azuretools.vscode-containers`.
   - **Remove → `unwantedRecommendations`:** `bradlc.vscode-tailwindcss`, `stylelint.vscode-stylelint`, `ms-vscode.vscode-typescript-next`, `ms-azuretools.vscode-docker` (legacy, superseded). Also drop `mads-hartmann.bash-ide-vscode` (0 tracked `.sh` files) — it was only installed ad hoc, never recommended, so it needs no unwanted entry.
   - **Recommend, don't force:** `ms-playwright.playwright` in `recommendations` only (smoke drives Playwright via MCP, not the test-runner UI). AWS Toolkit + `anthropic.claude-code` stay out of the repo-declared set (CLI-first repo; Claude Code is each dev's own setup) — per the ticket's leans.

`recommendations` (9) = the 8 devcontainer ids + `ms-playwright.playwright`. `unwantedRecommendations` (4) = the four still-installable-by-hand removed ids.

## Plan — 1 slice (4 config files)

1. `.gitignore`: un-ignore `.vscode/settings.json` + `.vscode/extensions.json`. `.vscode/settings.json`: add `yaml.schemas` (CFN glob → goformation schema). `.devcontainer/devcontainer.json`: add `customizations.vscode.extensions` (8). `.vscode/extensions.json`: replace with the 9 recommendations + 4 unwanted. No code, no tests (editor config).

## Smoke (manual, against your editor)

- Open any `infra/cloudformation/*.yml` → **zero** "Unresolved tag" warnings, and a deliberately misspelled `Type:` / missing required property surfaces a schema diagnostic (then revert). `docker-compose.yml` and `.github/workflows/*.yml` show no new warnings (glob-scoped).
- Rebuild the devcontainer → the 8 canonical extensions auto-install; none of the four removed ids are recommended; the four appear only under `unwantedRecommendations`.

## Out of scope

- A **CI** YAML/CFN lint gate (`cfn-lint`/`yamllint`/`actionlint`) — editor-time only here.
- Reformatting or changing the CloudFormation templates themselves.
