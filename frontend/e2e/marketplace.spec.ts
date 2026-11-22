import { expect, test, type Page } from "@playwright/test";
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

async function waitForNextGate(
  page: Page,
  id: string,
  previousDraft: string,
): Promise<"seller_reply" | "close_deal"> {
  let gate: "seller_reply" | "close_deal" | null = null;
  let nextDraft: string | null = null;
  await expect.poll(async () => {
    const response = await page.request.get(`/api/negotiations/${id}`);
    if (!response.ok()) return null;
    const snapshot = await response.json() as { question?: { gate?: string; draft?: string; channel?: string } | null };
    const value = snapshot.question?.gate;
    const draft = snapshot.question?.draft;
    gate =
      value === "close_deal"
        ? "close_deal"
        : value === "seller_reply" && snapshot.question?.channel === "marketplace" && typeof draft === "string" && draft !== previousDraft
          ? "seller_reply"
          : null;
    nextDraft = gate === "seller_reply" && typeof draft === "string" ? draft : null;
    return gate;
  }, { timeout: 60000 }).not.toBeNull();
  if (!gate) throw new Error("The agent did not reach a supported Copilot gate.");
  if (gate === "seller_reply") {
    await expect(page.getByTestId("copilot-draft")).toHaveValue(nextDraft!);
    await expect(page.getByTestId("copilot-announcement")).toHaveText("New draft ready");
    await expect(page.getByTestId("marketplace-send")).toBeVisible();
    await expect(page.getByTestId("copilot-reply")).toHaveCount(0);
  } else {
    await expect(page.getByRole("heading", { name: /Accept RM/ })).toBeVisible();
  }
  return gate;
}

async function submitMarketplaceSend(page: Page, id: string, text?: string): Promise<"seller_reply" | "close_deal"> {
  const previousDraft = await page.getByTestId("copilot-draft").inputValue();
  if (text !== undefined) {
    await page.getByText("Edit before sending").click();
    await page.getByTestId("copilot-edit").fill(text);
  }
  await page.getByTestId("marketplace-send").click();
  return waitForNextGate(page, id, previousDraft);
}

async function assertNoSeriousAxeViolations(page: Page, label: string): Promise<void> {
  const { AxeBuilder } = await import("@axe-core/playwright");
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, `${label} serious/critical axe violations`).toEqual([]);
}

test.describe("Copilot marketplace channel", () => {
  test.beforeEach(async ({ page }) => {
    watchPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    const id = runIdFromUrl(page);
    if (id) recordRun(id);
    await recordAndCleanupProfile(page);
    expect(errorsByPage.get(page) ?? [], "browser console and page errors").toEqual([]);
  });

  test("Copilot marketplace run to a deal", async ({ page }) => {
    test.setTimeout(180_000); // several Send clicks to a deal; each graph step costs a database round trip
    const id = await startCopilotMarketplace(page);

    // First gate: seller_reply with channel=marketplace, no paste textarea
    await expect(page.getByTestId("marketplace-send")).toBeVisible();
    await expect(page.getByTestId("copilot-reply")).toHaveCount(0);
    await screenshot(page, "marketplace-composer");

    let gate = await submitMarketplaceSend(page, id);
    for (let i = 0; i < 7 && gate === "seller_reply"; i += 1) {
      gate = await submitMarketplaceSend(page, id);
    }

    // Should reach the close_deal approval gate
    await expect(page.getByRole("heading", { name: /Accept RM/ })).toBeVisible();
    await expect(page.getByTestId("run-status")).toHaveText("Waiting for approval");

    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("copilot-final-message-panel")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Closing message" })).toBeVisible();
    await expect(page.getByTestId("copilot-final-copy")).toHaveCount(0);
    await screenshot(page, "marketplace-outcome");

    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "Deal agreed" })).toBeVisible();
  });

  test("Edit before sending: rejected edit is not sent, valid edit is", async ({ page }) => {
    const id = await startCopilotMarketplace(page);

    const draft = page.getByTestId("copilot-draft");
    const source = await draft.inputValue();
    const price = source.match(/RM\s*([\d,]+(?:\.\d+)?)/i)?.[1];
    expect(price).toBeTruthy();

    // Rejected edit: reveals limit -> 422, nothing sent, disclosure stays open
    await page.getByText("Edit before sending").click();
    await expect(page.locator("details")).toHaveAttribute("open", "");
    const edit = page.getByTestId("copilot-edit");
    const unsafe = `My max budget is RM 1000, how about RM ${price}?`;
    await edit.fill(unsafe);
    const beforeResponse = await page.request.get(`/api/negotiations/${id}`);
    const beforeSnapshot = await beforeResponse.json() as { history: [string, string][] };
    const beforeHistory = beforeSnapshot.history;

    await page.getByTestId("marketplace-send").click();
    const alert = page.getByTestId("copilot-error");
    await expect(alert).toBeVisible();
    await expect(edit).toHaveValue(unsafe);
    await expect(page.getByTestId("copilot-draft")).toHaveValue(source);
    const afterResponse = await page.request.get(`/api/negotiations/${id}`);
    const afterSnapshot = await afterResponse.json() as { history: [string, string][] };
    expect(afterSnapshot.history).toEqual(beforeHistory);
    await expect(page.locator("details")).toHaveAttribute("open", "");

    // Valid edit: accepted, chat shows edited text
    const safeEdit = `Would RM ${price} work for you?`;
    await edit.fill(safeEdit);
    await page.getByTestId("marketplace-send").click();
    await expect.poll(async () => {
      const current = await (await page.request.get(`/api/negotiations/${id}`)).json() as { history: [string, string][] };
      return current.history.filter(([role, text]) => role === "buyer" && text === safeEdit).length;
    }).toBe(1);
  });

  test("End negotiation ends the run with user_stopped", async ({ page }) => {
    const id = await startCopilotMarketplace(page);
    await expect(page.getByTestId("copilot-draft")).toBeVisible();
    await page.getByTestId("copilot-end").click();
    await expect(page.getByTestId("copilot-stop-confirm")).toBeVisible();
    await page.getByRole("button", { name: "Yes, end it" }).click();
    await expect.poll(async () => {
      const current = await (await page.request.get(`/api/negotiations/${id}`)).json() as { outcome: string | null };
      return current.outcome;
    }).toBe("user_stopped");
    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "You ended the negotiation" })).toBeVisible();
    await expect(page.getByTestId("copilot-composer")).toHaveCount(0);
  });
});
