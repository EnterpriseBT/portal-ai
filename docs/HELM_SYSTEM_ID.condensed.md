# Helm per-install SYSTEM_ID — Condensed design (#953)

**Issue:** [EnterpriseBT/portal-ai#953](https://github.com/EnterpriseBT/portal-ai/issues/953) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The chart forces `SYSTEM_ID: "SYSTEM"` on every residency install and refuses any other value (`_env.tpl:9-21`). The pin existed because data migrations wrote the literal. Since #952 they read the principal from the `portalai.system_id` setting, so an install can carry its own id the way prod does: a UUID, traceable to that install. The id is write-once in practice: a change strands every row written under the old one. So lifting the pin also has to stop an upgrade from changing it. Chart only: `deploy/helm/portalai`, `scripts/check-helm.mjs`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The pin | `deploy/helm/portalai/templates/_env.tpl:9-21` | `fail`s on any `config.SYSTEM_ID` but `SYSTEM`, then sets `SYSTEM_ID: "SYSTEM"` |
| Where config renders | `portalai.configData` → `templates/configmap.yaml` (`<fullname>-config`) **and** `templates/hook-env.yaml` (the hook copy) | rendered twice per release |
| Kept-value pattern | `portalai.keptSecretValue`, `_helpers.tpl:66-83` | explicit, else `lookup` of the existing object, else `randAlphaNum` |
| Chart checks | `scripts/check-helm.mjs:116-129` (refusal), `:603-609` (the value is `SYSTEM`, once) | `helm template` only, so `lookup` returns nothing there |
| Docs | `deploy/helm/portalai/README.md:141` (`config` row) | "set by the chart … any other value is refused" |

## Decision — operator-chosen, kept, never generated

- **(a) Generate a UUID on first install, kept by `lookup`.** Rejected. `configData` renders twice in one pass, into the main ConfigMap and the hook copy. On a first install `lookup` finds neither, so each render would draw its **own** random id: the migrate hook writes one principal and the API reads another. `keptSecretValue` avoids this only by being rendered in exactly one Secret. There's no single object here that both the API and the pre-install hooks can read. `helm template` and GitOps would also get a new id on every render.
- **(b) Derive an id from the release name and namespace.** Rejected. It's stable, but two customers with the same release name and namespace collide, which defeats traceability.
- **(c) Chosen: the operator may set `config.SYSTEM_ID` once.** The rendered value is the first of:
  1. an explicit `config.SYSTEM_ID`;
  2. the `SYSTEM_ID` already in `<fullname>-config` (`lookup`);
  3. `"SYSTEM"`.

  The render `fail`s when an explicit value differs from an existing one:
  `config.SYSTEM_ID is write-once: this install uses "<existing>"; changing it strands every platform row written under it`.

  So:
  - existing installs keep `SYSTEM`;
  - a new install can set a UUID (the README recommends one, as prod does);
  - an upgrade can't change it.

  Both config copies render the same value, because each takes the same explicit/lookup/default chain. A blank or whitespace-only value is refused, like the API's boot guard.

## Plan — 1 slice

**Files:**
- `templates/_helpers.tpl`: new `portalai.systemId`, implementing the chain and the write-once `fail`.
- `templates/_env.tpl`: the pin goes; it uses `portalai.systemId`.
- `scripts/check-helm.mjs`:
  - the refusal case at `:116` becomes an acceptance;
  - the `:603` assertion becomes "default `SYSTEM`, once";
  - new cases cover an explicit UUID rendering once in **both** the config and hook ConfigMaps, and a blank value being refused.
- `README.md`: the `config` row, plus an **Upgrades** note on write-once.

**Tests (first):** write the `check-helm.mjs` cases above, red on today's chart. Then run `npm run lint:helm`.

The write-once `fail` needs a live `lookup`, which `helm template` can't do. It's covered by smoke steps 2–3.

## Smoke (manual, against your dev stack)

1. **Renders.**
   - `helm template p deploy/helm/portalai --set image.api.tag=x --set image.web.tag=x` renders `SYSTEM_ID: "SYSTEM"` in both the config ConfigMap and the hook copy.
   - The same with `--set config.SYSTEM_ID=5f0c2a7e-0000-4000-8000-000000000000` renders that UUID in both.
   - `--set-string config.SYSTEM_ID="  "` fails, naming `SYSTEM_ID`.
2. **The existing install keeps its id.** Upgrade the local install from #946 with no `config.SYSTEM_ID`: `helm upgrade portalai deploy/helm/portalai -n portalai -f <values> --atomic`.
   - It succeeds.
   - `kubectl get cm -n portalai portalai-config -o jsonpath='{.data.SYSTEM_ID}'` prints `SYSTEM`.
3. **An upgrade can't change it.** The same upgrade with `--set config.SYSTEM_ID=5f0c2a7e-0000-4000-8000-000000000000` fails before anything changes, with `config.SYSTEM_ID is write-once: this install uses "SYSTEM"…`. `helm history` shows no new revision.
4. **A fresh install with a UUID.**
   - Install into a scratch namespace with a UUID and the ingress disabled: `helm install p953 deploy/helm/portalai -n portalai953 --create-namespace -f <values> --set ingress.enabled=false --set config.SYSTEM_ID=<uuid>`.
   - The migrate Job completes.
   - `kubectl exec -n portalai953 <postgres pod> -- psql … -tAc "SELECT created_by FROM tiers WHERE slug='standard'"` prints the UUID: #952's 0133 relabeled 0065's literal.
   - The API pod is Ready.
   - Clean up: `helm uninstall p953 -n portalai953 && kubectl delete ns portalai953`.

## Out of scope

- Generating an id (option a): it needs one object both pre-install hooks and the API can read. That's a hook-scoped kept ConfigMap, more machinery than this needs.
- Migrating an existing install off `SYSTEM`. That would need a relabel of everything written under it; `SYSTEM` stays valid.
