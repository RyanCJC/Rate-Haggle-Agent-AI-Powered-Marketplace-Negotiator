import { test, expect, type Page } from "@playwright/test";
import { recordRun, runIdFromUrl } from "./helpers";
import { recordAndCleanupProfile } from "./profile-registry";

const BACKEND = "http://127.0.0.1:8000";

async function assertLight(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
}

async function screenshot(page: Page, name: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const directory = path.join(process.cwd(), "e2e-screenshots", "desktop-light");
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

async function startCopilot(
  page: Page,
  options: {
    item_title?: string;
    category?: string;
    persona?: string;
  } = {},
): Promise<string> {
  await page.goto("/");
  await assertLight(page);
  await page.getByRole("button", { name: "Copilot (real seller)" }).click();
  await page.getByRole("textbox", { name: "Item title (optional)" }).fill(options.item_title ?? "Dell monitor");
  await page.getByRole("textbox", { name: /asking price/i }).fill("1200");
  await page.getByRole("textbox", { name: /maximum budget/i }).fill("1000");
  if (options.category) {
    await page.getByLabel("Category").selectOption(options.category);
  }
  if (options.persona) {
    const personaLabel =
      options.persona.charAt(0).toUpperCase() + options.persona.slice(1) + " seller";
    await page.getByRole("button", { name: personaLabel }).click();
  }
  await page.getByTestId("start-negotiation").click();
  await page.waitForURL(/#\/run\/[0-9a-f]+/);
  const id = runIdFromUrl(page);
  if (!id) throw new Error("Copilot start did not navigate to a run.");
  recordRun(id);
  await expect(page.getByTestId("copilot-composer")).toBeVisible();
  return id;
}

async function startPractice(
  page: Page,
  options: {
    item_title?: string;
    category?: string;
    persona?: string;
  } = {},
): Promise<string> {
  await page.goto("/");
  await assertLight(page);
  await page.getByRole("button", { name: "Start negotiating" }).click();
  await page.getByRole("textbox", { name: "Item title (optional)" }).fill(options.item_title ?? "Canon camera body");
  await page.getByRole("textbox", { name: /asking price/i }).fill("1200");
  await page.getByRole("textbox", { name: /maximum budget/i }).fill("1000");
  if (options.category) {
    await page.getByLabel("Category").selectOption(options.category);
  }
  if (options.persona) {
    const personaLabel =
      options.persona.charAt(0).toUpperCase() + options.persona.slice(1) + " seller";
    await page.getByRole("button", { name: personaLabel }).click();
  }
  await page.getByTestId("start-negotiation").click();
  await page.waitForURL(/#\/run\/[0-9a-f]+/);
  const id = runIdFromUrl(page);
  if (!id) throw new Error("Practice start did not navigate to a run.");
  recordRun(id);
  // Wait for the practice negotiation to reach the approve gate (clarify has run by then)
  await expect(page.getByRole("heading", { name: /Accept RM/ })).toBeVisible({ timeout: 60000 });
  return id;
}

test.describe("Category and clarify workflow", () => {
  test("Category dropdown shows all 8 options and 'Other' shows helper line", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();

    // Category dropdown should show all 8 categories
    await page.getByLabel("Category").click();
    const select = page.getByLabel("Category");
    await expect(select.locator('option[value="monitors"]')).toHaveText("Monitor");
    await expect(select.locator('option[value="phones"]')).toHaveText("Phone");
    await expect(select.locator('option[value="laptops"]')).toHaveText("Laptop");
    await expect(select.locator('option[value="cameras"]')).toHaveText("Camera");
    await expect(select.locator('option[value="consoles"]')).toHaveText("Game console");
    await expect(select.locator('option[value="furniture"]')).toHaveText("Furniture");
    await expect(select.locator('option[value="appliances"]')).toHaveText("Home appliance");
    await expect(select.locator('option[value="other"]')).toHaveText("Other");

    // Select "Other" - helper line should appear
    await page.getByLabel("Category").selectOption("other");
    await expect(page.getByText("General guidance only. No category-specific notes.")).toBeVisible();

    // Select "Monitors" - helper line should disappear
    await page.getByLabel("Category").selectOption("monitors");
    await expect(
      page.getByText("General guidance only. No category-specific notes."),
    ).not.toBeVisible();

    await screenshot(page, "home-category-other");
  });

  test("Copilot start without category shows guessed category label", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();
    await page.getByRole("textbox", { name: "Item title (optional)" }).fill("Canon EOS 80D body");
    await page.getByRole("textbox", { name: /asking price/i }).fill("1200");
    await page.getByRole("textbox", { name: /maximum budget/i }).fill("1000");
    await page.getByTestId("start-negotiation").click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page);
    if (!id) throw new Error("Copilot start did not navigate to a run.");
    recordRun(id);

    const configResponse = await page.request.get(`/api/negotiations/${id}`);
    const snapshot = await configResponse.json() as { config: { category: string; category_guessed: boolean } };
    expect(snapshot.config.category).toBe("cameras");
    expect(snapshot.config.category_guessed).toBe(true);

    await page.getByRole("tab", { name: "Item" }).click();
    await expect(page.getByTestId("item-category")).toHaveText("Camera (guessed from the title)", { timeout: 30000 });

    await screenshot(page, "copilot-guessed-category");
  });

  test("Practice run with an evasive seller shows research in the Activity panel", async ({ page }) => {
    test.setTimeout(150000);

    // Create the run through the API (same /api base as the guessed-label test).
    const startResponse = await page.request.post("/api/negotiations", {
      data: {
        asking: "1200",
        budget: "1000",
        persona: "evasive",
        style: "balanced",
        autonomy: "approve_close",
        seed: 0,
      },
    });
    expect(startResponse.ok()).toBe(true);
    const { id } = (await startResponse.json()) as { id: string };
    if (!id) throw new Error("Practice start did not return a run id.");
    recordRun(id);

    // Assert at API level, auto-retrying, that the trace contains a clarify entry.
    // A failure here means the backend/run is the cause, before any UI step runs.
    await expect
      .poll(async () => {
        const snapshot = await page.request.get(`/api/negotiations/${id}`);
        const json = await snapshot.json() as { trace?: Array<{ node?: string }> };
        return json.trace?.some((entry) => entry.node === "clarify") ?? false;
      }, { timeout: 90000, interval: 1000 })
      .toBe(true);

    await page.goto(`/#/run/${id}`);
    await assertLight(page);
    await page.getByRole("tab", { name: "Activity" }).click();

    const researchHeading = page.getByTestId("activity").getByText("Research before this offer");
    await expect(researchHeading).toBeVisible({ timeout: 60000 });

    const listingTool = page.getByTestId("activity").getByText("Read the listing");
    await expect(listingTool.first()).toBeVisible({ timeout: 60000 });

    await screenshot(page, "copilot-evasive-research");
  });
});
