import { expect, test, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
import { describeSlot } from "../src/lib/pickup";
import { recordRun, runIdFromUrl } from "./helpers";
import { recordAndCleanupProfile } from "./profile-registry";

const errorsByPage = new WeakMap<Page, string[]>();

function watchPageErrors(page: Page): string[] {
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
  return errors;
}

async function assertLight(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
}

async function screenshot(page: Page, name: string): Promise<void> {
  const directory = path.join(process.cwd(), "e2e-screenshots", "desktop-light");
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${name}.png`), fullPage: true });
}

async function startCopilot(
  page: Page,
  options: { listing?: string; comparables?: string } = {},
): Promise<string> {
  await page.goto("/");
  await assertLight(page);
  await page.getByRole("button", { name: "Copilot (real seller)" }).click();
  await page.getByRole("textbox", { name: "Item title (optional)" }).fill("Dell monitor");
  await page.getByRole("textbox", { name: /asking price/i }).fill("1200");
  await page.getByRole("textbox", { name: /maximum budget/i }).fill("1000");
  if (options.listing) {
    await page.getByLabel("Listing text (optional)").fill(options.listing);
  }
  if (options.comparables) {
    await page.getByLabel("Comparable prices (optional)").fill(options.comparables);
  }
  await page.getByTestId("start-negotiation").click();
  await page.waitForURL(/#\/run\/[0-9a-f]+/);
  const id = runIdFromUrl(page);
  if (!id) throw new Error("Copilot start did not navigate to a run.");
  recordRun(id);
  await expect(page.getByTestId("copilot-composer")).toBeVisible();
  return id;
}

async function sendReply(page: Page, id: string, text: string): Promise<"seller_reply" | "close_deal"> {
  const previousDraft = await page.getByTestId("copilot-draft").inputValue();
  await page.getByTestId("copilot-reply").fill(text);
  await page.getByTestId("copilot-send").click();
  let gate: "seller_reply" | "close_deal" | null = null;
  await expect.poll(async () => {
    const response = await page.request.get(`/api/negotiations/${id}`);
    if (!response.ok()) return null;
    const snapshot = await response.json() as {
      question?: { gate?: string; draft?: string } | null;
    };
    const question = snapshot.question;
    gate =
      question?.gate === "close_deal"
        ? "close_deal"
        : question?.gate === "seller_reply" && question.draft !== previousDraft
          ? "seller_reply"
          : null;
    return gate;
  }, { timeout: 30000 }).not.toBeNull();
  if (!gate) throw new Error("Copilot did not reach the next seller-reply or close gate.");
  if (gate === "seller_reply") {
    const snapshot = await (await page.request.get(`/api/negotiations/${id}`)).json() as {
      question?: { draft?: string } | null;
    };
    await expect(page.getByTestId("copilot-draft")).toHaveValue(snapshot.question?.draft ?? "");
    await expect(page.getByTestId("copilot-reply")).toHaveValue("");
    await expect(page.getByTestId("copilot-reply")).toBeFocused();
  } else {
    await expect(page.getByRole("heading", { name: /Accept RM/ })).toBeVisible();
  }
  return gate;
}

async function startCopilotDeal(
  page: Page,
  options: { listing?: string; comparables?: string } = {},
): Promise<string> {
  const id = await startCopilot(page, options);
  let gate: "seller_reply" | "close_deal" = "seller_reply";
  for (const reply of [
    "Lowest I can go is RM 991.",
    "I can do RM 905 at best.",
    "Lowest I can go is RM 880.",
  ]) {
    if (gate === "close_deal") break;
    gate = await sendReply(page, id, reply);
  }
  if (gate !== "close_deal") throw new Error("The seller replies did not reach the close gate.");
  await expect(page.getByRole("heading", { name: "Accept RM 880?" })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("copilot-final-message-panel")).toBeVisible();
  return id;
}

async function openPickupOptions(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Deal" }).click();
  await expect(page.getByTestId("pickup-coordinator")).toBeVisible();
  await page.getByTestId("pickup-propose").click();
  await expect(page.getByTestId("pickup-options")).toBeVisible();
}

async function assertNoSeriousAxeViolations(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const serious = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
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

function dateOffset(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

test.describe("Copilot pickup coordination", () => {
  test.beforeEach(async ({ page }) => {
    watchPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    const id = runIdFromUrl(page);
    if (id) recordRun(id);
    await recordAndCleanupProfile(page);
    expect(errorsByPage.get(page) ?? [], "browser console and page errors").toEqual([]);
  });

  test("proposes five seller-ready times and copies the code-written message", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await startCopilotDeal(page);
    await openPickupOptions(page);

    const slots = page.locator("ul[aria-label='Available pickup times'] > li");
    await expect(slots).toHaveCount(5);
    const slotButtons = page.locator("[data-testid^='pickup-slot-button-']");
    await expect.poll(async () => {
      const enabled = await slotButtons.evaluateAll((buttons) =>
        buttons.every((button) => !((button as HTMLButtonElement).disabled)),
      );
      return enabled;
    }).toBe(true);
    for (let index = 0; index < 5; index += 1) {
      const button = page.getByTestId(`pickup-slot-button-${index}`);
      await expect(button).toHaveText("Seller agreed to this time");
      await expect(button).toBeEnabled();
      const isInsideRow = await button.evaluate((element) => {
        const row = element.closest("li")!.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return rect.left >= row.left && rect.right <= row.right &&
          rect.top >= row.top && rect.bottom <= row.bottom;
      });
      expect(isInsideRow).toBe(true);
    }
    await expect(page.getByTestId("pickup-refresh")).toHaveText("Refresh times");
    await expect(page.getByText("The seller suggested another time", { exact: true })).toBeVisible();
    await expect(page.getByTestId("pickup-spinner")).toHaveCount(0);
    const message = await page.getByTestId("pickup-message").inputValue();
    expect(message).toContain("RM 880");
    expect(message.toLowerCase()).toContain("pickup");
    expect(message).not.toMatch(/\b1,?000\b/);
    const messageHeight = await page.getByTestId("pickup-message").evaluate((textarea) => ({
      scrollHeight: textarea.scrollHeight,
      clientHeight: textarea.clientHeight,
    }));
    expect(messageHeight.scrollHeight).toBeLessThanOrEqual(messageHeight.clientHeight + 1);
    await screenshot(page, "copilot-pickup-options");

    await page.getByTestId("pickup-copy").click();
    await expect(page.getByRole("status")).toHaveText("Copied");
  });

  test("booking updates both pickup card and Deal receipt", async ({ page }) => {
    await startCopilotDeal(page);
    await openPickupOptions(page);
    const row = page.getByTestId("pickup-slot-0");
    const label = (await page.getByTestId("pickup-slot-label-0").textContent())?.trim();
    expect(label).toBeTruthy();
    await row.getByRole("button", { name: "Seller agreed to this time" }).click();

    const booked = page.getByTestId("pickup-booked-card");
    await expect(booked).toBeVisible();
    await expect(booked).toContainText(label!);
    await expect(booked).toContainText("(Malaysia time)");
    await expect(page.getByText(/^Pickup booked:/)).toContainText(label!);
    await expect(page.getByText("Next: agree a pickup time with the seller.")).toHaveCount(0);
    await screenshot(page, "copilot-pickup-booked");
  });

  test("reload preserves a booked pickup", async ({ page }) => {
    const id = await startCopilotDeal(page);
    await openPickupOptions(page);
    const label = (await page.getByTestId("pickup-slot-label-0").textContent())?.trim();

    const peer = await page.context().newPage();
    const peerErrors = watchPageErrors(peer);
    await peer.goto(`/#/run/${id}`);
    await assertLight(peer);
    await peer.getByRole("tab", { name: "Deal" }).click();
    await expect(peer.getByTestId("pickup-propose")).toBeVisible();

    await page.getByTestId("pickup-slot-button-0").click();
    await expect(page.getByTestId("pickup-booked-card")).toContainText(label!);
    await peer.reload();
    await assertLight(peer);
    await peer.getByRole("tab", { name: "Deal" }).click();
    await expect(peer.getByTestId("pickup-booked-card")).toContainText(label!);
    expect(peerErrors).toEqual([]);
    await peer.close();

    await page.reload();
    await assertLight(page);
    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByTestId("pickup-booked-card")).toContainText(label!);
    await expect(page.getByText(/^Pickup booked:/)).toContainText(label!);
  });

  test("double-clicking a slot sends one booking request", async ({ page }) => {
    await startCopilotDeal(page);
    await openPickupOptions(page);
    let bookingRequests = 0;
    await page.route(/\/api\/negotiations\/[^/]+\/pickup$/, async (route) => {
      if (route.request().method() === "POST") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.continue();
      } else {
        await route.continue();
      }
    });
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/pickup$/.test(new URL(request.url()).pathname)) {
        bookingRequests += 1;
      }
    });

    await page.getByTestId("pickup-slot-button-0").dblclick();
    await expect(page.getByTestId("pickup-spinner")).toHaveCount(1);
    await expect(page.getByTestId("pickup-slot-button-0")).toContainText("Seller agreed to this time");
    for (let index = 0; index < 5; index += 1) {
      const button = page.getByTestId(`pickup-slot-button-${index}`);
      await expect(button).toBeDisabled();
      await expect(button).toContainText("Seller agreed to this time");
      if (index !== 0) {
        await expect(button.getByTestId("pickup-spinner")).toHaveCount(0);
      }
    }
    await expect(page.getByTestId("pickup-refresh")).toBeDisabled();
    await expect(page.getByTestId("pickup-refresh")).toContainText("Refresh times");
    await expect(page.getByText("The seller suggested another time", { exact: true })).toBeVisible();
    await expect(page.getByTestId("pickup-booked-card")).toBeVisible();
    await expect.poll(() => bookingRequests).toBe(1);
    await expect(page.getByTestId("pickup-error")).toHaveCount(0);
  });

  test("cancels inline, reloads options, then books a different time", async ({ page }) => {
    await startCopilotDeal(page);
    await openPickupOptions(page);
    const firstLabel = (await page.getByTestId("pickup-slot-label-0").textContent())?.trim();
    await page.getByTestId("pickup-slot-button-0").click();
    await expect(page.getByTestId("pickup-booked-card")).toBeVisible();
    await page.getByTestId("pickup-cancel").click();
    await expect(page.getByTestId("pickup-cancel-confirm")).toBeVisible();
    await page.getByTestId("pickup-cancel-confirm-button").click();
    await expect(page.getByTestId("pickup-options")).toBeVisible();
    await expect(page.getByTestId("pickup-booked-card")).toHaveCount(0);
    await expect(page.locator("ul[aria-label='Available pickup times'] > li")).toHaveCount(5);

    const secondLabel = (await page.getByTestId("pickup-slot-label-1").textContent())?.trim();
    expect(secondLabel).not.toBe(firstLabel);
    await page.getByTestId("pickup-slot-button-1").click();
    await expect(page.getByTestId("pickup-booked-card")).toContainText(secondLabel!);
  });

  test("books a custom time and preserves rejected date and hour", async ({ page }) => {
    await startCopilotDeal(page);
    await openPickupOptions(page);
    await page.getByText("The seller suggested another time", { exact: true }).click();
    const futureDate = dateOffset(3);
    await page.getByTestId("pickup-date").fill(futureDate);
    await page.getByTestId("pickup-hour").selectOption("11");
    await page.getByTestId("pickup-book-custom").click();
    await expect(page.getByTestId("pickup-booked-card")).toContainText(
      `${describeSlot(`${futureDate}T11:00:00+08:00`)} (Malaysia time)`,
    );

    await startCopilotDeal(page);
    await openPickupOptions(page);
    await page.getByText("The seller suggested another time", { exact: true }).click();
    const today = dateOffset(0);
    await page.getByTestId("pickup-date").fill(today);
    await page.getByTestId("pickup-hour").selectOption("10");
    await page.getByTestId("pickup-book-custom").click();
    const error = page.getByTestId("pickup-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(/24 hours|future|tomorrow|at least/i);
    await expect(page.getByTestId("pickup-booked-card")).toHaveCount(0);
    await expect(page.getByTestId("pickup-date")).toHaveValue(today);
    await expect(page.getByTestId("pickup-hour")).toHaveValue("10");
  });

  test("refreshes after 409 taken and recovers from 503", async ({ page }) => {
    const id = await startCopilotDeal(page);
    let optionsRequests = 0;
    page.on("request", (request) => {
      if (request.method() === "GET" && request.url().includes(`/negotiations/${id}/pickup/options`)) {
        optionsRequests += 1;
      }
    });
    await openPickupOptions(page);
    await page.route(`**/api/negotiations/${id}/pickup`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ detail: "That pickup time was just taken." }),
        });
      } else {
        await route.continue();
      }
    });
    await page.getByTestId("pickup-slot-button-0").click();
    await expect(page.getByTestId("pickup-error")).toContainText("just taken");
    await expect.poll(() => optionsRequests).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("pickup-refresh")).toBeEnabled();

    const unavailableId = await startCopilotDeal(page);
    await page.route(
      new RegExp(`/api/negotiations/${unavailableId}/pickup/options(?:\\?.*)?$`),
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Calendar is offline." }),
        });
      },
    );
    await page.getByRole("tab", { name: "Deal" }).click();
    await page.getByTestId("pickup-propose").click();
    await expect(page.getByTestId("pickup-error")).toHaveText(
      "The calendar is unavailable. Try again in a moment.",
    );
    await expect(page.getByTestId("pickup-propose")).toBeEnabled();
  });

  test("Practice and stopped Copilot runs do not offer pickup coordination", async ({ page }) => {
    await page.goto("/");
    await assertLight(page);
    await page.getByTestId("start-negotiation").click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const practiceId = runIdFromUrl(page);
    if (!practiceId) throw new Error("Practice start did not navigate to a run.");
    recordRun(practiceId);
    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByText("Arrange pickup", { exact: true })).toHaveCount(0);

    await startCopilot(page);
    await page.getByTestId("copilot-end").click();
    await page.getByTestId("copilot-stop-confirm").getByRole("button", { name: "Yes, end it" }).click();
    const stoppedId = runIdFromUrl(page);
    if (!stoppedId) throw new Error("Stopped Copilot run ID was missing.");
    await expect.poll(async () => {
      const current = await (await page.request.get(`/api/negotiations/${stoppedId}`)).json() as {
        outcome: string | null;
      };
      return current.outcome;
    }).toBe("user_stopped");
    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "You ended the negotiation" })).toBeVisible();
    await expect(page.getByText("Arrange pickup", { exact: true })).toHaveCount(0);
  });

  test("Item facts use readable evidence and render unknown values as a dash", async ({ page }) => {
    const listing = "27 inch 144Hz IPS, 6 months warranty left, no scratches, with box and cables.";
    await startCopilot(page, { listing, comparables: "780 850 900 920" });
    await expect(page.getByTestId("copilot-composer")).toBeVisible();
    await expect(page.getByTestId("conversation-card")).toBeVisible();
    await expect(page.getByText("Draft to send", { exact: true })).toHaveCount(1);
    const composerGeometry = await page.evaluate(() => {
      const conversation = document.querySelector("[data-testid='conversation-card']")!;
      const composer = document.querySelector("[data-testid='copilot-composer']")!;
      const conversationBox = conversation.getBoundingClientRect();
      const composerBox = composer.getBoundingClientRect();
      return {
        gap: composerBox.top - conversationBox.bottom,
        overlap: conversationBox.left < composerBox.right &&
          conversationBox.right > composerBox.left &&
          conversationBox.top < composerBox.bottom &&
          conversationBox.bottom > composerBox.top,
      };
    });
    expect(composerGeometry.gap).toBeGreaterThanOrEqual(8);
    expect(composerGeometry.overlap).toBe(false);
    await page.getByRole("tab", { name: "Item" }).click();
    const warranty = page.getByTestId("item-fact-warranty");
    await expect(warranty).toContainText("6 months");
    await expect(warranty).toContainText("Stated once");
    await expect(warranty).toContainText("Listing");
    await warranty.getByText("Evidence").click();
    await expect(warranty).toContainText("6 months warranty left");
    await expect(page.getByTestId("item-fact-condition")).toContainText("—");
    await expect(page.getByTestId("item-fact-condition")).toContainText("Unknown");
    await expect(page.getByTestId("item-fact-condition")).not.toContainText("None");
    const factsText = await page.getByTestId("item-facts-container").innerText();
    expect(factsText).not.toContain("listing:");
    await assertNoSeriousAxeViolations(page, "Copilot Item tab");
    await screenshot(page, "copilot-item-tab");
  });

  test("Deal chart text labels do not collide and the chart fits its content", async ({ page }) => {
    await startCopilotDeal(page);
    await page.getByRole("tab", { name: "Deal" }).click();
    const chart = page.getByTestId("price-ladder");
    await expect(chart).toBeVisible();
    await expect(chart.getByText("Seller asks", { exact: true })).toBeVisible();
    await expect(chart.getByText("Deal RM 880", { exact: true })).toBeVisible();

    const geometry = await chart.evaluate((element) => {
      const texts = [...element.querySelectorAll("svg text")].map((text) => {
        const box = text.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      });
      const chartBox = element.getBoundingClientRect();
      return {
        texts,
        chartHeight: chartBox.height,
        contentHeight: element.scrollHeight,
        chartRight: chartBox.right,
        documentWidth: document.documentElement.clientWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    for (let first = 0; first < geometry.texts.length; first += 1) {
      for (let second = first + 1; second < geometry.texts.length; second += 1) {
        const a = geometry.texts[first];
        const b = geometry.texts[second];
        const intersects = a.left < b.right && a.right > b.left &&
          a.top < b.bottom && a.bottom > b.top;
        expect(intersects, `chart text elements ${first} and ${second} overlap`).toBe(false);
      }
    }
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.chartRight).toBeLessThanOrEqual(geometry.documentWidth);
    expect(geometry.chartHeight).toBeLessThanOrEqual(geometry.contentHeight + 1);
    await screenshot(page, "copilot-deal-chart");
  });

  test("pickup and Item surfaces pass axe and visible-box geometry checks", async ({ page }) => {
    await startCopilotDeal(page, {
      listing: "27 inch 144Hz IPS, 6 months warranty left, no scratches, with box and cables.",
    });
    await openPickupOptions(page);
    await assertNoSeriousAxeViolations(page, "Copilot pickup options");

    const firstRow = page.getByTestId("pickup-slot-0");
    const slotGeometry = await firstRow.evaluate((row) => {
      const label = row.querySelector("span")!.getBoundingClientRect();
      const button = row.querySelector("button")!.getBoundingClientRect();
      const card = row.closest("[data-testid='pickup-coordinator']")!.getBoundingClientRect();
      return {
        noOverlap: label.right <= button.left || button.right <= label.left,
        insideCard: label.left >= card.left && button.right <= card.right,
        noHorizontalOverflow: row.scrollWidth <= row.clientWidth,
      };
    });
    expect(slotGeometry.noOverlap).toBe(true);
    expect(slotGeometry.insideCard).toBe(true);
    expect(slotGeometry.noHorizontalOverflow).toBe(true);
    await assertVisibleWithinViewport(page, page.getByTestId("pickup-slot-button-0"));
    const documentGeometry = await page.evaluate(() => ({
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(documentGeometry.noHorizontalOverflow).toBe(true);
    expect(documentGeometry.viewportWidth).toBe(1440);

    await page.getByTestId("pickup-slot-button-0").click();
    const booked = page.getByTestId("pickup-booked-card");
    await expect(booked).toBeVisible();
    await assertNoSeriousAxeViolations(page, "Copilot pickup booked");
    await assertVisibleWithinViewport(page, booked);
    const bookedGeometry = await booked.evaluate((card) => {
      const box = card.getBoundingClientRect();
      const container = card.closest("[data-testid='pickup-coordinator']")!.getBoundingClientRect();
      return {
        visible: box.width > 0 && box.height > 0,
        inside: box.left >= container.left && box.right <= container.right &&
          box.top >= container.top && box.bottom <= container.bottom,
      };
    });
    expect(bookedGeometry.visible).toBe(true);
    expect(bookedGeometry.inside).toBe(true);

    await page.getByRole("tab", { name: "Item" }).click();
    await assertNoSeriousAxeViolations(page, "Copilot Item tab");
    const itemGeometry = await page.getByTestId("item-facts-container").evaluate((container) => ({
      noHorizontalOverflow: container.scrollWidth <= container.clientWidth,
      chipsSingleLine: [...container.querySelectorAll("[data-testid^='fact-status-']")].every(
        (chip) => getComputedStyle(chip).whiteSpace === "nowrap",
      ),
    }));
    expect(itemGeometry.noHorizontalOverflow).toBe(true);
    expect(itemGeometry.chipsSingleLine).toBe(true);
  });
});
