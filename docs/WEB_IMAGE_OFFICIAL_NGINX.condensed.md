# Web image on the official nginx base — Condensed design (#1096)

**Issue:** [EnterpriseBT/portal-ai#1096](https://github.com/EnterpriseBT/portal-ai/issues/1096) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Second round; the first (PR #1097) added the time-boxed exceptions that expired on 2026-11-26.

**Why.** Every `deploy-dev` fails at **Gate web image**: six fixable CRITICAL/HIGH CVEs in nginx 1.30.6. nginx 1.30.7 fixes them, but `nginxinc/nginx-unprivileged` still hasn't published `1.30.7-alpine-slim` a week later. The official `nginx:1.30.7-alpine-slim` has been out since 2026-11-19. This ticket moves the web runtime onto the official image and does the unprivileged hardening in our own Dockerfile. The container's contract stays the same: uid 101, port 8080, `config.js` rendered at startup. That ends our dependency on another image's release schedule. Touches `apps/web` (Dockerfile, comments), CI (the ignore file, the advisory script), and the Helm check/values comments and docs. No app code changes.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Runtime base | `apps/web/Dockerfile:69` | `nginxinc/nginx-unprivileged:1.30.6-alpine-slim@sha256:5d8b…`; `USER root` → `apk upgrade` + `nodejs` → `USER nginx` (`:76-78`) |
| Served files | `apps/web/Dockerfile:80-87` | Our `nginx.conf` → `conf.d/default.conf`; `40-render-config.sh` in `/docker-entrypoint.d/`; `dist` copied `--chown=nginx:nginx` so the entrypoint can write `config.js` |
| Server config | `apps/web/nginx.conf` | One `listen 8080;`, no ssl/http2/quic/mail/resolver/alias |
| Exceptions | `.github/actions/image-gate/trivyignore.yaml` | Six entries scoped to `pkg:apk/alpine/nginx@1.30.6-r1`, expired 2026-11-26 |
| Weekly check | `scripts/nginx-advisories.mjs:37` (Hub URL), `:156` (`readPin`), `:211` (fix text), `:253-281` (self-test fixtures), `:347` | Reads the version from the runtime `FROM`; looks for the fixed `-alpine-slim` tag on **nginx-unprivileged** |
| Residency contract | `deploy/helm/portalai/values.yaml:45-59`, `scripts/check-helm.mjs:775` | Port 8080, `runAsUser/Group: 101`, `runAsNonRoot`; no `readOnlyRootFilesystem` on web. Comments name nginx-unprivileged |
| Official image (checked by `docker run`) | `nginx:1.30.7-alpine-slim@sha256:8c950211…0a55` | `nginx` is uid/gid 101. `nginx.conf` has `user nginx;` and `pid /run/nginx.pid;`. Compiled temp paths are under `/var/cache/nginx` (root-owned). `/run` is root-owned. Entrypoint scripts: `10-listen-on-ipv6` exits 0 when it can't write `default.conf`; `20-envsubst` returns when `/etc/nginx/templates` is absent; `15-local-resolvers` and `30-tune-worker-processes` are opt-in by env |

## Decision — harden the official image ourselves

The ticket chose this approach on 2026-11-26. Waiting for nginx-unprivileged, or extending the exceptions, keeps prod blocked on someone else's schedule. The concrete shape:

1. `FROM nginx:1.30.8-alpine-slim@sha256:e9eaa7298465eab06d618c51556fdcf3fb5061f9ff40bd28ee898fbd7ee7f900 AS runtime`. That's 1.30.8 rather than the ticket's 1.30.7: during implementation the live advisory check found 1.30.8, released 23 Nov, which fixes CVE-2026-132779 (`ssl_early_data`), and its official image was already published, with the tag and the index digest pinned together. `readPin`'s regex already matches `nginx:`.
2. As root, in the same `RUN` as `apk upgrade && apk add nodejs`, edit `/etc/nginx/nginx.conf`:
   - drop `user`;
   - set `pid /tmp/nginx.pid`;
   - add `client_body_temp_path`, `proxy_temp_path`, `fastcgi_temp_path`, `uwsgi_temp_path` and `scgi_temp_path` under `/tmp` in `http {}`.

   Then `chown -R 101:101 /var/cache/nginx`, so the compiled-in paths are writable too. This is what nginx-unprivileged's own Dockerfile does.
3. Leave `/etc/nginx/conf.d` root-owned. We bake `default.conf` and use no templates, so `10-listen-on-ipv6` logs "can not modify" and exits 0, and it can never rewrite our listen. This is stricter than nginx-unprivileged, which needed conf.d writable for envsubst.
4. `COPY --chown=101:101` the `dist` (for `config.js`), then end on `USER 101`. The uid is numeric so `runAsNonRoot` can verify it. Keep `EXPOSE 8080`.
5. Set `trivyignore.yaml` back to `vulnerabilities: []`, keeping the header that explains the policy.
6. Point `nginx-advisories.mjs` at the new base:
   - the Hub URL becomes `library/nginx/tags/<v>-alpine-slim`;
   - the fix text names `nginx:` and its `imagetools inspect` command;
   - the self-test fixtures use the official `FROM`, keeping one nginx-unprivileged fixture so `readPin` stays image-agnostic.
7. **Found in implementation:** nginx.org dropped every `Severity:` line from its advisories page, so the check's `severity !== "none"` skip no longer caught CVE-2009-4487. That's log escaping, which nginx.org won't fix ("Not vulnerable: none" over "Vulnerable: all"), so the weekly check would have flagged every pin forever. The script now skips an advisory with no fix over "all", and its self-test fixture uses the page's new shape.

## Plan — 1 slice

**Files:**
- `apps/web/Dockerfile` (runtime stage + comments)
- `apps/web/nginx.conf` and `apps/web/scripts/40-render-config.sh` (header comments)
- `.github/actions/image-gate/trivyignore.yaml`
- `scripts/nginx-advisories.mjs`
- `deploy/helm/portalai/values.yaml` and `scripts/check-helm.mjs` (comments and test name only, values unchanged)
- `docs/SUPPLY_CHAIN.md` and `CLAUDE.md` (the supply-chain paragraph: the new base, and that we own the unprivileged hardening)

**Tests:**
- `npm run lint:nginx-advisories` (self-test)
- `npm run lint:helm`
- `npm run lint:ci-cache`
- a local image build + run (Smoke 1–4)

## Smoke (manual, against your dev stack)

1. `docker build -f apps/web/Dockerfile -t portalai-web:1096 .` succeeds. Then run `trivy image --severity CRITICAL,HIGH --ignore-unfixed portalai-web:1096` (or wait for the deploy gate) and confirm it shows 0 findings with the empty ignore file.
2. `docker run -d -p 8080:8080 --name web1096 portalai-web:1096`. In the logs, `render-config: wrote …config.js` appears and `10-listen-on-ipv6` reports "can not modify" with no error. `docker exec web1096 ps -o user,comm` shows only `nginx` / uid 101 (no root master), and `id` reports uid 101.
3. `curl -sI localhost:8080/` returns 200 with `Cache-Control: no-cache`. `curl -s localhost:8080/config.js` returns the rendered config, with `no-store`. `curl -sI localhost:8080/stations/abc` (a deep link) returns 200 and serves `index.html`. One `/assets/…` file returns `immutable`.
4. `docker run --user 101:101 …` and the Helm render (`runAsUser: 101`, `runAsNonRoot`) both start cleanly.
5. After merge: `deploy-dev` passes **Gate web image** for amd64 and arm64, then `verify-login` goes green, and app-dev serves #1133's launcher. v1.3.2 then cuts to prod (the release itself is a separate step).

## Out of scope

- `readOnlyRootFilesystem` for the web pod (it would need a `/tmp` emptyDir). The current contract doesn't set it, and this ticket keeps the contract.
- Moving the API image off its base, and any nginx config change.
- Cutting v1.3.2. That's the release checklist, once app-dev is green.
