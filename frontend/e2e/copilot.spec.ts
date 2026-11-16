import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { recordRun, runIdFromUrl } from "./helpers";

const errorsByPage = new WeakMap<Page, string[]>();

function watchPageErrors(page: Page): void {
  const errors: string[] = [];
  errorsByPage.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource:.*status of 422/.test(message.text())) {
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

async function startCopilot(page: Page): Promise<string> {
  await page.goto("/");
  await assertLight(page);
  await page.getByRole("button", { name: "Copilot (real seller)" }).click();
  await page.getByRole("textbox", { name: "Item title (optional)" }).fill("Dell monitor");
  await page.getByRole("button", { name: "Start negotiating" }).click();
  await page.waitForURL(/#\/run\/[0-9a-f]+/);
  const id = runIdFromUrl(page);
  if (!id) throw new Error("Copilot start did not navigate to a run.");
  recordRun(id);
  await expect(page.getByTestId("copilot-composer")).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveText(/Waiting for your reply/);
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
    const snapshot = await response.json() as { question?: { gate?: string; draft?: string } | null };
    const value = snapshot.question?.gate;
    const draft = snapshot.question?.draft;
    gate =
      value === "close_deal"
        ? "close_deal"
        : value === "seller_reply" && typeof draft === "string" && draft !== previousDraft
          ? "seller_reply"
          : null;
    nextDraft = gate === "seller_reply" && typeof draft === "string" ? draft : null;
    return gate;
  }, { timeout: 30000 }).not.toBeNull();
  if (!gate) throw new Error("The agent did not reach a supported Copilot gate.");
  if (gate === "seller_reply") {
    await expect(page.getByTestId("copilot-draft")).toHaveValue(nextDraft!);
    await expect(page.getByTestId("copilot-announcement")).toHaveText("New draft ready");
    await expect(page.getByTestId("copilot-reply")).toHaveValue("");
    await expect(page.getByTestId("copilot-reply")).toBeFocused();
  } else {
    await expect(page.getByRole("heading", { name: /Accept RM/ })).toBeVisible();
  }
  return gate;
}

async function submitSellerReply(page: Page, id: string, text: string): Promise<"seller_reply" | "close_deal"> {
  const previousDraft = await page.getByTestId("copilot-draft").inputValue();
  await page.getByTestId("copilot-reply").fill(text);
  await page.getByTestId("copilot-send").click();
  return waitForNextGate(page, id, previousDraft);
}

async function assertNoSeriousAxeViolations(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(serious, `${label} serious/critical axe violations`).toEqual([]);
}

async function assertVisibleWithinViewport(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const rect = await locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  });
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(rect.left).toBeGreaterThanOrEqual(0);
  expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(viewport!.width);
  expect(rect.bottom).toBeLessThanOrEqual(viewport!.height);
}

test.describe("Copilot mode", () => {
  test.beforeEach(async ({ page }) => {
    watchPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    const id = runIdFromUrl(page);
    if (id) recordRun(id);
    expect(errorsByPage.get(page) ?? [], "browser console and page errors").toEqual([]);
  });

  test("offline happy path, gate labels, screenshots, and Copilot outcomes", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();
    await page.getByRole("textbox", { name: "Item title (optional)" }).fill("Dell monitor");
    await assertNoSeriousAxeViolations(page, "Copilot Home");

    await page.getByRole("textbox", { name: /asking price/i }).fill("1200");
    await page.getByRole("textbox", { name: /maximum budget/i }).fill("1000");
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page);
    if (!id) throw new Error("Copilot start did not navigate to a run.");
    recordRun(id);

    await expect(page.getByTestId("copilot-composer")).toBeVisible();
    const firstDraft = await page.getByTestId("copilot-draft").inputValue();
    expect(firstDraft.trim()).not.toBe("");
    const firstOffer = firstDraft.match(/RM\s*([\d,]+(?:\.\d+)?)/i)?.[1];
    expect(firstOffer).toBeTruthy();
    expect(Number(firstOffer!.replace(/,/g, ""))).toBeGreaterThan(0);
    await expect(page.getByTestId("run-status")).toHaveText(/Waiting for your reply/);
    await assertNoSeriousAxeViolations(page, "Copilot workspace");

    const firstGate = await submitSellerReply(page, id, "Lowest I can go is RM 991.");
    if (firstGate === "seller_reply") {
      await expect(page.getByTestId("pending-draft")).toBeVisible();
      await expect(page.getByTestId("copilot-announcement")).toHaveText("New draft ready");
    }

    let gate: "seller_reply" | "close_deal" = firstGate;
    if (gate === "seller_reply") {
      gate = await submitSellerReply(page, id, "I can do RM 905 at best.");
    }
    if (gate === "seller_reply") {
      gate = await submitSellerReply(page, id, "Lowest I can go is RM 880.");
    }
    if (gate !== "close_deal") {
      throw new Error("Seller replies did not reach the close gate.");
    }

    await expect(page.getByRole("heading", { name: "Accept RM 880?" })).toBeVisible();
    await expect(page.getByTestId("run-status")).toHaveText("Waiting for approval");
    await expect(page.getByText(/Approve closing this deal\. Next you will send the final message to the seller\./)).toBeVisible();
    await expect(page.getByTestId("pending-draft")).toHaveCount(0);
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByTestId("copilot-final-message-panel")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Send this to the seller" })).toBeVisible();
    await screenshot(page, "copilot-outcome");

    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "Deal agreed" })).toBeVisible();
    await expect(page.getByText("Next: agree a pickup time with the seller.")).toBeVisible();
    await expect(page.getByText(/Pickup booked/)).toHaveCount(0);
  });

  test("rejects a limit-revealing edit and accepts a clean edit without losing typed input", async ({ page }) => {
    const id = await startCopilot(page);
    const draft = page.getByTestId("copilot-draft");
    const source = await draft.inputValue();
    const price = source.match(/RM\s*([\d,]+(?:\.\d+)?)/i)?.[1];
    expect(price).toBeTruthy();

    await page.getByText("Edit before sending").click();
    await expect(page.locator("details")).toHaveAttribute("open", "");
    const edit = page.getByTestId("copilot-edit");
    const unsafe = `My max budget is RM 1000, how about RM ${price}?`;
    await edit.fill(unsafe);
    const beforeHistoryResponse = await page.request.get(`/api/negotiations/${id}`);
    const beforeHistorySnapshot = await beforeHistoryResponse.json() as { history: [string, string][] };
    const beforeHistory = beforeHistorySnapshot.history;
    await page.getByTestId("copilot-reply").fill("Any update?");
    await page.getByTestId("copilot-send").click();

    const alert = page.getByTestId("copilot-error");
    await expect(alert).toBeVisible();
    await expect(edit).toHaveValue(unsafe);
    await expect(page.getByTestId("copilot-draft")).toHaveValue(source);
    await expect(page.getByTestId("copilot-reply")).toHaveValue("Any update?");
    await expect(edit).toHaveAttribute("aria-describedby", "copilot-reply-error");
    const afterHistoryResponse = await page.request.get(`/api/negotiations/${id}`);
    const afterHistorySnapshot = await afterHistoryResponse.json() as { history: [string, string][] };
    expect(afterHistorySnapshot.history).toEqual(beforeHistory);
    await expect(page.locator("details")).toHaveAttribute("open", "");

    const safeEdit = `Would RM ${price} work for you?`;
    await edit.fill(safeEdit);
    const response = await page.request.get(`/api/negotiations/${id}`);
    const before = await response.json() as { history: [string, string][] };
    const previousBuyerCount = before.history.filter(([role]) => role === "buyer").length;
    await page.getByTestId("copilot-send").click();
    await waitForNextGate(page, id, source);
    await expect.poll(async () => {
      const current = await (await page.request.get(`/api/negotiations/${id}`)).json() as { history: [string, string][] };
      return current.history.filter(([role, text]) => role === "buyer" && text === safeEdit).length;
    }).toBe(1);
    expect(previousBuyerCount).toBeGreaterThanOrEqual(0);
  });

  test("end negotiation asks for inline confirmation and removes the pending draft", async ({ page }) => {
    const id = await startCopilot(page);
    await expect(page.getByTestId("pending-draft")).toBeVisible();
    await page.getByTestId("copilot-end").click();
    await expect(page.getByTestId("copilot-stop-confirm")).toBeVisible();
    await page.getByRole("button", { name: "Yes, end it" }).click();
    await expect.poll(async () => {
      const current = await (await page.request.get(`/api/negotiations/${id}`)).json() as { outcome: string | null };
      return current.outcome;
    }).toBe("user_stopped");
    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "You ended the negotiation" })).toBeVisible();
    await expect(page.getByTestId("pending-draft")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Dell monitor")).toBeVisible();
    await expect(page.getByText("Copilot", { exact: true })).toBeVisible();
  });

  test("reload preserves the same pending draft and reply submission remains available", async ({ page }) => {
    const id = await startCopilot(page);
    const draftBefore = await page.getByTestId("copilot-draft").inputValue();
    await page.reload();
    await assertLight(page);
    await expect(page.getByTestId("copilot-draft")).toHaveValue(draftBefore);
    await expect(page.getByTestId("run-status")).toHaveText("Waiting for your reply");
    await submitSellerReply(page, id, "I can pick it up today.");
  });

  test("keyboard-only reply submission supports Ctrl+Enter", async ({ page }) => {
    const id = await startCopilot(page);
    const reply = page.getByTestId("copilot-reply");
    const previousDraft = await page.getByTestId("copilot-draft").inputValue();
    for (let index = 0; index < 60; index += 1) {
      if (await page.evaluate(() => document.activeElement?.id === "copilot-reply")) break;
      await page.keyboard.press("Tab");
    }
    await expect(reply).toBeFocused();
    await reply.fill("Would RM 950 work?");
    await page.keyboard.press("Control+Enter");
    await waitForNextGate(page, id, previousDraft);
  });

  test("composer geometry stays visible, separated, inside its container, and on the primary token", async ({ page }) => {
    const id = await startCopilot(page);
    await page.getByText("Edit before sending").click();
    const targets = [
      page.getByTestId("copilot-draft"),
      page.getByTestId("copilot-copy"),
      page.getByTestId("copilot-edit"),
      page.getByTestId("copilot-reply"),
      page.getByTestId("copilot-send"),
      page.getByTestId("copilot-end"),
    ];
    for (const target of targets) await assertVisibleWithinViewport(page, target);

    const geometry = await page.evaluate(() => {
      const composer = document.querySelector("[data-testid='copilot-composer']")!;
      const pending = document.querySelector("[data-testid='pending-draft']")!;
      const targetSelectors = [
        "[data-testid='copilot-draft']",
        "[data-testid='copilot-copy']",
        "[data-testid='copilot-edit']",
        "[data-testid='copilot-reply']",
        "[data-testid='copilot-send']",
        "[data-testid='copilot-end']",
      ];
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left + window.scrollX,
          right: box.right + window.scrollX,
          top: box.top + window.scrollY,
          bottom: box.bottom + window.scrollY,
        };
      };
      const composerBox = rect(composer);
      const pendingBox = rect(pending);
      const controls = targetSelectors.map((selector) => {
        const element = document.querySelector(selector)!;
        const box = rect(element);
        const container = rect(composer);
        return {
          selector,
          inside: box.left >= container.left && box.right <= container.right,
          box,
        };
      });
      return { composerBox, pendingBox, controls };
    });
    const intersects = (a: typeof geometry.pendingBox, b: typeof geometry.pendingBox) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    expect(intersects(geometry.pendingBox, geometry.composerBox)).toBe(false);
    expect(geometry.controls.every((item) => item.inside)).toBe(true);
    for (let first = 0; first < geometry.controls.length; first += 1) {
      for (let second = first + 1; second < geometry.controls.length; second += 1) {
        expect(intersects(geometry.controls[first].box, geometry.controls[second].box)).toBe(false);
      }
    }
    const buttonBackground = await page.getByTestId("copilot-send").evaluate((element) => getComputedStyle(element).backgroundColor);
    const primaryBackground = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-primary)";
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    expect(buttonBackground).toBe(primaryBackground);

    await page.getByTestId("copilot-edit").fill("My max budget is RM 1000, how about RM 900?");
    await page.getByTestId("copilot-reply").fill("Any update?");
    await page.getByTestId("copilot-send").click();
    const error = page.getByTestId("copilot-error");
    await expect(error).toBeVisible();
    const errorGeometry = await error.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const container = element.closest("[data-testid='copilot-composer']")!.getBoundingClientRect();
      return {
        visible: rect.width > 0 && rect.height > 0,
        inside: rect.left >= container.left && rect.right <= container.right && rect.top >= container.top && rect.bottom <= container.bottom,
        uncovered: (() => {
          const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return top === element || element.contains(top);
        })(),
      };
    });
    expect(errorGeometry.visible).toBe(true);
    expect(errorGeometry.inside).toBe(true);
    expect(errorGeometry.uncovered).toBe(true);
    const widths = await page.getByTestId("copilot-composer").evaluate((element) => {
      const containerWidth = element.getBoundingClientRect().width;
      return [...element.querySelectorAll("*")].map((child) => child.getBoundingClientRect().width <= containerWidth);
    });
    expect(widths.every(Boolean)).toBe(true);
    await expect.poll(async () => {
      const current = await (await page.request.get(`/api/negotiations/${id}`)).json() as { question?: { gate?: string } | null };
      return current.question?.gate ?? null;
    }).toBe("seller_reply");
  });

  test("Copilot Home and workspace pass axe with no browser console errors", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();
    await assertNoSeriousAxeViolations(page, "Copilot Home");
    await page.getByRole("textbox", { name: "Item title (optional)" }).fill("Dell monitor");
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page);
    if (!id) throw new Error("Copilot start did not navigate to a run.");
    recordRun(id);
    await expect(page.getByTestId("copilot-composer")).toBeVisible();
    await assertNoSeriousAxeViolations(page, "Copilot workspace");
  });

  test("listing-aware Copilot checks facts, market context, polish, and visible geometry", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await expect(page.getByTestId("run-mode")).toHaveCount(0);
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();

    const listingText = "27 inch 144Hz IPS, 6 months warranty left, no scratches, with box and cables.";
    await page.getByRole("textbox", { name: "Item title (optional)" }).fill("Gaming monitor");
    await page.getByLabel("Category").selectOption("monitors");
    await page.getByRole("textbox", { name: /asking price/i }).fill("900");
    await page.getByRole("textbox", { name: /maximum budget/i }).fill("750");
    await page.getByLabel("Listing text (optional)").fill(listingText);
    await expect(page.getByTestId("copilot-listing-counter")).toHaveText("77/4000");
    await page.getByLabel("Comparable prices (optional)").fill("780 850 900 920");

    const info = "You send every message yourself. Haggle never contacts anyone. Your limit is never shown to the AI.";
    await expect(page.getByText(info, { exact: true })).toHaveCount(1);
    const nextSteps = page.locator("aside").getByRole("list").first();
    await expect(nextSteps).toContainText("Draft: the agent writes the next message");
    await expect(nextSteps).toContainText("You send it yourself");
    await expect(nextSteps).toContainText("Paste the seller's reply");
    await expect(nextSteps).toContainText("Check: code validates every draft");
    await expect(nextSteps).toContainText("You approve: nothing closes without your OK");
    await expect(nextSteps).toContainText("Send the final message and agree pickup yourself");
    await expect(nextSteps).not.toContainText("Pickup booked");

    const prices = [780, 850, 900, 920];
    const median = (prices[1] + prices[2]) / 2;
    const askingPercent = Math.round(((900 - median) / median) * 100);
    const limitPercent = Math.round(((750 - median) / median) * 100);
    const market = page.getByTestId("market-check");
    await expect(market).toContainText("Median RM 875");
    await expect(market).toContainText(`The asking price is ${askingPercent}% above the median.`);
    await expect(market).toContainText(`Your limit is ${Math.abs(limitPercent)}% below the median.`);
    await expect(market).toContainText("Based on 4 prices you entered.");
    await assertNoSeriousAxeViolations(page, "Copilot Home with listing fields");
    await screenshot(page, "copilot-home");

    await page.getByTestId("start-negotiation").click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page);
    if (!id) throw new Error("Copilot start did not navigate to a run.");
    recordRun(id);
    await expect(page.getByTestId("run-mode")).toHaveText("Copilot");
    await expect(page.getByTestId("copilot-composer")).toBeVisible();

    const configResponse = await page.request.get(`/api/negotiations/${id}`);
    const snapshot = await configResponse.json() as {
      config: { category: string; listing_text: string; comparables: string[] };
    };
    expect(snapshot.config).toMatchObject({
      category: "monitors",
      listing_text: listingText,
      comparables: ["780", "850", "900", "920"],
    });

    const status = page.getByTestId("run-status");
    const statusStyle = await status.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        borderStyle: style.borderTopStyle,
        borderWidth: style.borderTopWidth,
        fontFamily: style.fontFamily,
      };
    });
    expect(statusStyle.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(statusStyle.borderStyle).not.toBe("none");
    expect(statusStyle.borderWidth).not.toBe("0px");
    expect(statusStyle.fontFamily.toLowerCase()).not.toContain("mono");
    const copyWidth = await page.getByTestId("copilot-copy").evaluate((element) =>
      element.getBoundingClientRect().width,
    );
    expect(copyWidth).toBeLessThanOrEqual(160);
    await page.getByRole("tab", { name: "Item" }).click();
    const itemPanel = page.getByTestId("copilot-item-panel");
    await expect(itemPanel).toBeVisible();
    await expect(page.getByTestId("item-fact-warranty")).toContainText("6 months");
    await expect(page.getByTestId("item-fact-warranty")).toContainText("Stated once");
    await expect(page.getByTestId("item-fact-warranty")).toContainText("Listing");
    await expect(page.getByTestId("item-fact-condition")).toContainText("Unknown");
    await expect(page.getByText("Practice", { exact: true })).toHaveCount(0);
    await page.getByTestId("item-fact-warranty").getByText("Evidence").click();
    await expect(page.getByTestId("item-fact-warranty")).toContainText("6 months warranty left");
    await assertNoSeriousAxeViolations(page, "Copilot Item tab");

    const itemGeometry = await page.getByTestId("item-facts-container").evaluate((container) => {
      const rows = [...container.querySelectorAll("tbody tr")];
      return {
        noHorizontalOverflow: container.scrollWidth <= container.clientWidth,
        statusValueOverlap: rows.map((row) => {
          const value = row.cells[1].getBoundingClientRect();
          const status = row.cells[2].querySelector("[data-testid^='fact-status-']");
          if (!status) return true;
          const badge = status.getBoundingClientRect();
          return value.left < badge.right &&
            value.right > badge.left &&
            value.top < badge.bottom &&
            value.bottom > badge.top;
        }),
      };
    });
    expect(itemGeometry.noHorizontalOverflow).toBe(true);
    expect(itemGeometry.statusValueOverlap.every((overlap) => !overlap)).toBe(true);

    const itemMarket = page.getByTestId("market-check");
    await assertVisibleWithinViewport(page, itemMarket);
    const marketGeometry = await itemMarket.evaluate((element) => {
      const card = element.getBoundingClientRect();
      const container = element.closest("[data-testid='copilot-item-panel']")!.getBoundingClientRect();
      return {
        visible: card.width > 0 && card.height > 0,
        inside: card.left >= container.left && card.right <= container.right &&
          card.top >= container.top && card.bottom <= container.bottom,
      };
    });
    expect(marketGeometry.visible).toBe(true);
    expect(marketGeometry.inside).toBe(true);
    await screenshot(page, "copilot-item-tab");

    await page.getByRole("tab", { name: "Activity" }).click();
    await submitSellerReply(page, id, "I can do RM 850 for it.");
    const sentStep = page.locator("li[data-step]").filter({ hasText: "You sent this to the seller" });
    await expect(sentStep).toContainText("Offer RM");
    await expect(page.getByText("Read reply", { exact: true })).toBeVisible();
    await page.getByText("Edit before sending").click();
    await expect(page.getByText("Your edit is checked for your limit and price rules, not for item facts.")).toBeVisible();
    await assertNoSeriousAxeViolations(page, "Copilot composer");
    await screenshot(page, "copilot-composer");
  });

  test("Copilot without listing text shows every fact as unknown", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page);
    if (!id) throw new Error("Copilot start did not navigate to a run.");
    recordRun(id);

    await page.getByRole("tab", { name: "Item" }).click();
    await expect(page.getByText(
      "No listing text was given, so the agent states no item details and asks instead.",
    )).toBeVisible();
    const statuses = page.locator("[data-testid^='fact-status-']");
    await expect(statuses).not.toHaveCount(0);
    expect((await statuses.allTextContents()).every((text) => text === "Unknown")).toBe(true);
  });

  test("invalid comparable prices block Copilot start and valid prices restore it", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await page.getByRole("button", { name: "Copilot (real seller)" }).click();
    const input = page.getByLabel("Comparable prices (optional)");
    const start = page.getByTestId("start-negotiation");
    const expectedError = "Enter prices as numbers, for example 850 900 920.";

    for (const value of ["abc", "0", "100 200 300 400 500 600 700 800 900"]) {
      await input.fill(value);
      await expect(page.getByRole("alert")).toHaveText(expectedError);
      await expect(input).toHaveAttribute("aria-describedby", /copilot-comparables-error/);
      await expect(start).toBeDisabled();
    }

    await input.fill("850 900");
    await expect(page.getByTestId("copilot-comparables-error")).toHaveCount(0);
    await expect(start).toBeEnabled();
  });

  test("Practice has no listing fields or Item tab", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await expect(page.getByLabel("Listing text (optional)")).toHaveCount(0);
    await expect(page.getByLabel("Comparable prices (optional)")).toHaveCount(0);
    await expect(page.getByLabel("Category")).toHaveCount(0);
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page);
    if (!id) throw new Error("Practice start did not navigate to a run.");
    recordRun(id);
    await expect(page.getByTestId("run-mode")).toHaveText("Practice");
    await expect(page.getByRole("tab", { name: "Item" })).toHaveCount(0);
  });
});
