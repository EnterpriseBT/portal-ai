// Husky's documented CI/Docker/prod guard (#232): `npm ci --omit=dev` runs
// the `prepare` lifecycle script, but husky is a devDependency — a bare
// "prepare": "husky" kills production installs (sh: husky: not found,
// exit 127; broke every deploy-backend since #178). Skip when we're in
// CI/production or husky simply isn't installed; run it everywhere else
// so local `npm install` keeps wiring the pre-commit hook.
//
// NOTE: these guards only run once this file loads. The API Dockerfile
// copies only manifests before `npm ci`, so this file is *absent* there and
// `node .husky/install.mjs` would crash with MODULE_NOT_FOUND before any
// guard executes — which is why `prepare` is `test -f .husky/install.mjs &&
// node .husky/install.mjs || true`. Keep that wrapper: the `test -f` skips
// the crash cleanly when the file is absent (Docker), and `|| true` keeps a
// husky-run failure from ever failing an install. This file's internal
// guards are what keep CI/prod logs quiet when the file *is* present.
if (process.env.CI === "true" || process.env.NODE_ENV === "production") {
  process.exit(0);
}
try {
  const { default: husky } = await import("husky");
  console.log(husky());
} catch {
  process.exit(0);
}
