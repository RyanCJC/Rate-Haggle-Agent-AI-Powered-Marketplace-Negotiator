import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { recordRun, runIdFromUrl } from "./helpers";
import { recordAndCleanupProfile } from "./profile-registry";

const errorsByPage = new WeakMap<Page, string[]>();

function watchPageErrors(page: Page): void {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource:.*status of (?:409|422|503)/.test(message.text())
    ) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
}

async function assertLight(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
}

async function screenshot(page: Page, name: string): Promise<void> {
  const directory = path.join(process.cwd(), "e2e-screenshots", "desktop-light");
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

async function assertNoSeriousAxeViolations(page: Page, label: string): Promise<void> {
  const { AxeBuilder } = await import("@axe-core/playwright");
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, `${label} serious/critical axe violations`).toEqual([]);
}

async function startCopilotMarketplace(page: Page): Promise<string> {
  await page.goto("/");
  await assertLight(page);
  await page.getByRole("button", { name: "Copilot (real seller)" }).click();
  await page.getByRole("textbox", { name: "Item title (optional)" }).fill("Dell monitor");
  await page.getByRole("textbox", { name: /asking price/i }).fill("1200");
  await page.getByRole("textbox", { name: /maximum budget/i }).fill("1000");
  await page.getByRole("radio", { name: /Haggle sends them after I approve/ }).click();
  await page.getByTestId("start-negotiation").click();
  await page.waitForURL(/#\/run\/[0-9a-f]+/);
  const id = runIdFromUrl(page);
  if (!id) throw new Error("Copilot marketplace start did not navigate to a run.");
  recordRun(id);
  await expect(page.getByTestId("copilot-composer")).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveText(/Waiting for your OK to send/);
  return id;
}

async function startCopilotManual(page: Page): Promise<string> {
  await page.goto("/");
  await assertLight(page);
  await page.getByRole("button", { name: "Copilot (real seller)" }).click();
  await page.getByRole("textbox", { name: "Item title (optional)" }).fill("Dell monitor");
  await page.getByRole("textbox", { name: /asking price/i }).fill("1200");
  await page.getByRole("textbox", { name: /maximum budget/i }).fill("1000");
  // Channel defaults to manual; do not select the marketplace channel.
  await page.getByTestId("start-negotiation").click();
  await page.waitForURL(/#\/run\/[0-9a-f]+/);
  const id = runIdFromUrl(page);
  if (!id) throw new Error("Copilot manual start did not navigate to a run.");
  recordRun(id);
  await expect(page.getByTestId("copilot-composer")).toBeVisible();
  return id;
}

test.describe("MCP connections view", () => {
  test.beforeEach(async ({ page }) => {
    watchPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    const id = runIdFromUrl(page);
    if (id) recordRun(id);
    await recordAndCleanupProfile(page);
    expect(errorsByPage.get(page) ?? [], "browser console and page errors").toEqual([]);
  });

  test("Connections page lists both servers and their tools", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await page.getByRole("link", { name: "Connections" }).click();
    await page.waitForURL("#/connections");
    await assertLight(page);
    await screenshot(page, "connections-page");
    await assertNoSeriousAxeViolations(page, "connections page");

    const calendar = page.getByTestId("server-calendar");
    await expect(calendar).toBeVisible();
    await expect(calendar.getByTestId("server-calendar-status")).toHaveText("connected");
    for (const tool of ["propose_slots", "book_slot", "cancel_booking"]) {
      await expect(page.getByTestId(`tool-${tool}`)).toBeVisible();
    }

    const marketplace = page.getByTestId("server-marketplace");
    await expect(marketplace).toBeVisible();
    await expect(marketplace.getByTestId("server-marketplace-status")).toHaveText("connected");
    for (const tool of ["open_conversation", "send_offer", "send_message", "get_conversation"]) {
      await expect(page.getByTestId(`tool-${tool}`)).toBeVisible();
    }
  });

  test("Drawer shows live calls and the seller's side of a marketplace run", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startCopilotMarketplace(page);
    const shortId = id.slice(0, 8);

    // First gate: open the drawer and inspect the Calls tab.
    await page.getByTestId("open-connections").click();
    await expect(page.getByRole("dialog", { name: "Connections" })).toBeVisible();
    await page.getByRole("tab", { name: "Calls" }).click();
    await expect(page.getByText("marketplace.open_conversation").first()).toBeVisible({ timeout: 15000 });
    await screenshot(page, "connections-drawer-calls");
    await assertNoSeriousAxeViolations(page, "open drawer");

    // Capture the offered price from the draft, send it from the page behind the
    // drawer, then reopen the drawer and inspect the Calls tab again.
    const draft = page.getByTestId("copilot-draft");
    const source = await draft.inputValue();
    const priceMatch = source.match(/RM\s*([\d,]+)/);
    const price = priceMatch ? priceMatch[1].replace(/,/g, "") : "820";

    await page.getByTestId("close-connections").click();
    await expect(page.getByTestId("open-connections")).toBeFocused();
    await page.getByTestId("marketplace-send").click();
    await expect(page.getByTestId("copilot-draft")).not.toHaveValue(source, { timeout: 60000 });
    await expect(page.getByTestId("run-status")).toHaveText("Waiting for your OK to send");

    await page.getByTestId("open-connections").click();
    await expect(page.getByRole("dialog", { name: "Connections" })).toBeVisible();
    await page.getByRole("tab", { name: "Calls" }).click();
    await expect(page.getByText("marketplace.send_offer")).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator('[data-testid="call-row"]').filter({ hasText: `RM ${price}` }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Seller's view" }).click();
    const sellerView = page.getByTestId("seller-view");
    await expect(sellerView.getByText("Hello, RM 1,200, can pick up anytime.")).toBeVisible();
    await expect(sellerView.getByText(`How about RM ${price}?`)).toBeVisible();
    await expect(sellerView.getByText("You (seller)")).toHaveCount(2); // opening + the seller's reply
    await expect(page.getByRole("tab", { name: "Seller's view" })).toHaveAttribute("aria-selected", "true");
    await screenshot(page, "connections-drawer-seller");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Connections" })).not.toBeVisible();
    await expect(page.getByTestId("open-connections")).toBeFocused();
  });

  test("Pop-out page", async ({ page, context }) => {
    test.setTimeout(180_000);
    const id = await startCopilotMarketplace(page);
    const shortId = id.slice(0, 8);

    await page.getByTestId("open-connections").click();
    await expect(page.getByRole("dialog", { name: "Connections" })).toBeVisible();

    const [popout] = await Promise.all([
      context.waitForEvent("page"),
      page.getByTestId("connections-popout").click(),
    ]);
    await popout.waitForLoadState();
    await assertLight(popout);
    await expect(popout.getByRole("heading", { name: /Connections/ })).toBeVisible();
    await expect(popout.getByText(shortId)).toBeVisible();
    await expect(popout.getByTestId("server-calendar")).toBeVisible();
    await expect(popout.getByTestId("server-marketplace")).toBeVisible();
    await expect(popout.getByText("You (seller)")).toBeVisible();
    await expect(popout.getByTestId("connections-back")).toBeVisible();
    await screenshot(popout, "connections-popout");
  });

  test("A manual-channel run says the seller's view is not available", async ({ page }) => {
    test.setTimeout(180_000);
    const id = await startCopilotManual(page);

    await page.getByTestId("open-connections").click();
    await expect(page.getByRole("dialog", { name: "Connections" })).toBeVisible();

    await page.getByRole("tab", { name: "Seller's view" }).click();
    await expect(page.getByRole("tab", { name: "Seller's view" })).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByText("This run does not use the marketplace server."),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Calls" }).click();
    await expect(page.getByText("marketplace.send_offer")).not.toBeVisible();
    await expect(
      page.getByText("No MCP calls recorded for this run. The server may have restarted since."),
    ).toBeVisible();
  });
});
