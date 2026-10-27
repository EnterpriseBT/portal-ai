/**
 * The core loop on a freshly provisioned org (#489): dashboard → a CSV import
 * through the file-upload connector → its records → a new station → a portal
 * on it. Runs on the ephemeral stack (`scripts/e2e-stack.sh`), where the
 * interpret step's model calls go to the Anthropic stub, so no live LLM is
 * involved. `setup` signed in first, and that first login provisioned the org.
 */
import { expect, test, type Page } from "@playwright/test";

const FIXTURE = new URL("../fixtures/core-loop.csv", import.meta.url).pathname;

/** Console errors fail the walk; list one here only with a reason. */
const ALLOWED_CONSOLE: RegExp[] = [];

/** A real mouse drag from one grid cell to another (the region canvas reads
 *  pointer geometry, so a synthetic click won't draw). */
async function dragBetween(page: Page, from: string, to: string) {
  const dlg = page.getByRole("dialog", { name: /upload a spreadsheet/i });
  const a = await dlg.getByText(from, { exact: true }).first().boundingBox();
  const b = await dlg.getByText(to, { exact: true }).first().boundingBox();
  if (!a || !b) throw new Error(`cells ${from} / ${to} not on screen`);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test.describe.configure({ mode: "serial" });

test("a new org walks the core loop", async ({ page }) => {
  const run = Date.now().toString(36);
  const entityLabel = `E2E People ${run}`;
  const entityKey = `e2e_people_${run}`;
  const stationName = `E2E Station ${run}`;

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!ALLOWED_CONSOLE.some((re) => re.test(text))) consoleErrors.push(text);
  });

  await test.step("dashboard", async () => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
  });

  await test.step("import a CSV through the file-upload connector", async () => {
    await page.goto("/connectors");
    await page.getByRole("tab", { name: "Catalog" }).click();
    await page
      .locator(
        "xpath=//h6[normalize-space()='File Upload']/ancestor::*[.//button][1]//button"
      )
      .first()
      .click();

    const dlg = page.getByRole("dialog", { name: /upload a spreadsheet/i });
    await dlg.getByTestId("file-input").setInputFiles(FIXTURE);
    await dlg.getByRole("button", { name: "Upload" }).click();
    // Parsing finishes on the job stream (#886).
    await expect(dlg.getByText("name", { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });

    await dragBetween(page, "name", "240");
    await dlg.getByRole("button", { name: "+ Add row axis" }).click();
    await dlg.getByRole("button", { name: /create new entity/i }).click();
    const create = page
      .getByRole("dialog")
      .filter({ hasText: "Create new entity" });
    await create.getByLabel("Label").fill(entityLabel);
    await create.getByRole("button", { name: "Create" }).click();

    await dlg.getByRole("button", { name: "Interpret" }).click();
    await expect(dlg.getByText("Review interpretation")).toBeVisible({
      timeout: 60_000,
    });
    await dlg.getByRole("button", { name: "Commit plan" }).click();
    await page.waitForURL(/\/connectors\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByText(entityKey).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  await test.step("the entity's records", async () => {
    await page.goto("/entities");
    await page.getByText(entityKey).first().click();
    await page.waitForURL(/\/entities\/[0-9a-f-]{36}/);
    for (const value of ["Ada", "London", "Katherine", "240"]) {
      await expect(page.getByText(value, { exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
    }
  });

  await test.step("create a station", async () => {
    await page.goto("/stations");
    await page.getByRole("button", { name: "New Station" }).click();
    const dlg = page.getByRole("dialog").filter({ hasText: "New Station" });
    await dlg.getByLabel("Name").fill(stationName);
    await dlg.getByRole("button", { name: "Create" }).click();
    await expect(dlg).toBeHidden();
    await page.getByText(stationName).first().click();
    await page.waitForURL(/\/stations\/[0-9a-f-]{36}/);
  });

  await test.step("open a portal on it", async () => {
    await page.getByRole("button", { name: "Open Portal" }).click();
    await page.waitForURL(/\/portals\/[0-9a-f-]{36}/);
    await expect(
      page.getByPlaceholder(/ask a question, visualize your data/i)
    ).toBeVisible();
    await expect(page.getByText(stationName).first()).toBeVisible();
  });

  expect(consoleErrors, "console errors during the walk").toEqual([]);
});
