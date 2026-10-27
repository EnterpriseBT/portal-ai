# Rename the dev stack's compose network — Condensed design (#882)

**Issue:** [EnterpriseBT/portal-ai#882](https://github.com/EnterpriseBT/portal-ai/issues/882) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Every service in `docker-compose.yml` joins a network named `mcp-net`. It's just the dev stack's shared network, and it predates the Playwright MCP harness, but the name suggests it's MCP-specific. Renaming it to `portal-net` says what it is. The one cost is a one-time devcontainer rebuild, since every container's network changes. Touches `docker-compose.yml` and `docs/LOCAL_DEVELOPMENT.md` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Network declaration | `docker-compose.yml:131` | `mcp-net: { driver: bridge }`, no `name:`, so Docker calls it `<project>_mcp-net` (here `portalai_mcp-net`; on CI runners `portal-ai_mcp-net`) |
| Service memberships | `docker-compose.yml:21`, `:36`, `:51`, `:80`, `:102`, `:123` | `dev`, `ollama`, `redis`, `postgres`, `postgres-test`, `s3mock`: the only references outside phase docs |
| Devcontainer | `.devcontainer/devcontainer.json:3` | `dockerComposeFile` + `service: "dev"`, no `runServices`, so a rebuild brings up every non-profile service |
| Reached by name from inside | `packages/e2e/scripts/e2e-stack.sh:36` | `postgres-test:5432`, `redis:6379`, `s3mock:9090` when run in the devcontainer |
| CI | `.github/workflows/integration-test.yml:130`, `e2e-test.yml:126` | compose on the runner, reached on localhost ports; the network name doesn't matter there |
| Turbo | `turbo.json:25` | `docker-compose.yml` is a `globalDependency`: editing it invalidates every cached task once (a perf event, per CLAUDE.md) |

## Decision — rename to `portal-net`, keep it a declared network

- **Rename (chosen).** `mcp-net` becomes `portal-net` in the six memberships and the declaration. Docker then calls it `<project>_portal-net`. Nothing else names the network.
- **Drop the declaration and use compose's default network (rejected).** It works the same, but `<project>_default` describes nothing either, and an explicit network keeps the membership visible in the file.
- **Migration.** Containers attached to `portalai_mcp-net` must be recreated onto the new network. After pulling, "Rebuild Container" runs `docker compose up`, which recreates every service whose config changed, so they all move together. Profile services (`s3mock`) move the next time the e2e stack starts them. Named volumes (`pgdata`, `redis-data`, `ollama_data`) are untouched, so no data is lost. The old network then sits empty. Find it with `docker network ls --filter name=mcp-net`, since its prefix is each checkout's compose project, then remove it; that refuses harmlessly if anything still uses it.
  - A branch cut before #882 still declares `mcp-net`, so starting compose from it recreates the old network. The note says to merge `main` first.
  - A split shows in the e2e stack as a fallback to localhost ports (`e2e-stack.sh:35`), i.e. `ECONNREFUSED`, not `ENOTFOUND`. The note lists both.
  - Until the rebuild, the running stack keeps working on the old network. But a compose command that recreates one service (say `e2e:stack:up` recreating `postgres-test`) puts that service on `portal-net`, where the old devcontainer can't reach it by name. Hence the note says to rebuild first.

## Plan — 1 slice

**Files**
- Edit: `docker-compose.yml`: the six memberships and the declaration, `mcp-net` → `portal-net`.
- Edit: `docs/LOCAL_DEVELOPMENT.md`: a short "Compose network renamed (#882)" note covering the rebuild, the empty old network, volumes untouched, and rebuilding before running the e2e stack.

**Tests**
- None automated: compose topology isn't under test. CI's Integration Tests and E2E Tests bring the stack up from this file on every push, so a broken file fails them. The smoke below checks the devcontainer side.
- `git grep mcp-net` outside phase docs returns nothing.

## Smoke (manual, against your dev stack)

1. Pull the branch and "Rebuild Container". Then `docker network ls --filter name=portal-net` shows `<project>_portal-net`, and `docker network inspect <that name>` lists `dev`, `postgres`, `postgres-test`, `redis` and `ollama`.
2. From the devcontainer: `getent hosts postgres redis ollama` resolves all three, and `npm run dev` serves web :3000 and API :3001 (`/api/health` 200) as before.
3. `npm run --workspace @portalai/e2e e2e:stack:up` reaches `postgres-test`, `redis` and `s3mock` by name, and `test:e2e` passes. Then `e2e:stack:down`.
4. `docker network ls --filter name=mcp-net` names the old network (`<project>_mcp-net`; the prefix is your checkout folder's), and `docker network rm <that name>` succeeds, since nothing is attached any more. `git grep mcp-net` outside `docs/*.{discovery,spec,plan,smoke,adversarial,condensed}.md` is empty.

## Out of scope

- **Any other compose restructuring.**
