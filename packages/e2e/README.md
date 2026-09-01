# @portalai/e2e

Playwright browser harness for **agent-guided UI smoke walks** against the local dev stack (#304). It exists so an in-container Claude session can open the running app, log in as a dedicated test user, navigate, screenshot, and read console/network output — walking a `.smoke.md` checklist and producing reviewable evidence instead of reasoning about the UI from source.

> **Scope.** This package is the *harness*. Automated `*.spec.ts` and the ephemeral CI runner are deferred to a follow-up ticket (prod / app-dev login verification). `test:unit` / `test:integration` are deliberately no-ops here, and `src/specs/` is empty for now.

The auth fixture and seeded org baseline are built so that follow-up plugs in without re-plumbing.

<!-- Session + walk instructions (seed → auth → drive via MCP / `/smoke-walk`) are
     filled in by the fixture and convention slices. -->
