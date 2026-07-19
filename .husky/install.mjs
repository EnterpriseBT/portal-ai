// Husky's documented CI/Docker/prod guard (#232): `npm ci --omit=dev` runs
// the `prepare` lifecycle script, but husky is a devDependency — a bare
// "prepare": "husky" kills production installs (sh: husky: not found,
// exit 127; broke every deploy-backend since #178). Skip when we're in
// CI/production or husky simply isn't installed; run it everywhere else
// so local `npm install` keeps wiring the pre-commit hook.
if (process.env.CI === "true" || process.env.NODE_ENV === "production") {
  process.exit(0);
}
try {
  const { default: husky } = await import("husky");
  console.log(husky());
} catch {
  process.exit(0);
}
