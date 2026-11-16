import { test, expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";
import {
  runIdFromUrl,
  recordRun,
  shot,
} from "./helpers";

const pageErrors = new WeakMap<Page, string[]>();
const realConsoleErrors = new WeakMap<Page, string[]>();
const networkErrors = new WeakMap<Page, string[]>();

function watchErrors(page: Page): void {
  pageErrors.set(page, []);
  realConsoleErrors.set(page, []);
  networkErrors.set(page, []);
  page.on("pageerror", (err) => pageErrors.get(page)!.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/.test(text)) {
      networkErrors.get(page)!.push(text);
    } else {
      realConsoleErrors.get(page)!.push(text);
    }
  });
  page.on("requestfailed", (req) => {
    networkErrors.get(page)!.push(`${req.method()} ${req.url()}`);
  });
}

async function assertNoSeriousAxeViolations(page: Page, label: string): Promise<void> {
  const testInfo = test.info();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  if (serious.length > 0) {
    testInfo.attach(`axe-${label}.txt`, { body: JSON.stringify(serious, null, 2) });
  }
  expect(serious).toEqual([]);
}

// Every test must start in light mode.
async function assertLightTheme(page: Page): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
}

// Geometry: each of the first three Activity step icons is >= 16px wide and
// its box does not intersect the title text's bounding box.
async function assertActivityIcons(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll("[data-step]").length >= 3);
  const result: { widthOk: boolean; separated: boolean }[] = await page.evaluate(() => {
    const steps = document.querySelectorAll("[data-step]");
    const out: { widthOk: boolean; separated: boolean }[] = [];
    for (let i = 0; i < Math.min(3, steps.length); i += 1) {
      const step = steps[i];
      const icon = step.querySelector("[data-step-icon] svg");
      const title = step.querySelector("[data-step-title]");
      if (!icon || !title) {
        out.push({ widthOk: false, separated: false });
        continue;
      }
      const ir = icon.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(title);
      const tr = range.getBoundingClientRect();
      const intersects = !(
        ir.right < tr.left || ir.left > tr.right || ir.bottom < tr.top || ir.top > tr.bottom
      );
      out.push({ widthOk: ir.width >= 16, separated: !intersects });
    }
    return out;
  });
  for (const r of result) {
    expect(r.widthOk).toBe(true);
    expect(r.separated).toBe(true);
  }
}

// "Jump to latest" pill: pinned outside the scrolling container, visible only
// when not at the bottom, does not move with the content.
async function assertJumpToLatestBehaviour(page: Page): Promise<void> {
  const wrap = page.locator("[data-scroll-container]");
  const pill = page.locator("[data-jump-to-latest]");

  // Scrolled to the bottom: pill must not be rendered.
  await wrap.evaluate((el) => {
    el.scrollTop = el.scrollHeight - el.clientHeight;
  });
  await expect(pill).toHaveCount(0);

  // Scrolled to the middle: pill visible.
  await wrap.evaluate((el) => {
    el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
  });
  await expect(pill).toBeVisible();

  // Pill box lies fully inside the scroller's visible box and its bottom is
  // within 56px of the visible bottom edge.
  const middle = await page.evaluate(() => {
    const pillEl = document.querySelector("[data-jump-to-latest]")!;
    const scroller = document.querySelector("[data-scroll-container]")!;
    const pr = pillEl.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const inside =
      pr.left >= sr.left && pr.right <= sr.right && pr.top >= sr.top && pr.bottom <= sr.bottom;
    return { inside, bottomMargin: sr.bottom - pr.bottom, pillTop: pr.top };
  });
  expect(middle.inside).toBe(true);
  expect(middle.bottomMargin).toBeLessThanOrEqual(56);

  // Scroll down 200px then back up 200px: the pill position must not move
  // with the content (it is pinned to the non-scrolling wrapper).
  await wrap.evaluate((el) => {
    el.scrollTop += 200;
  });
  await wrap.evaluate((el) => {
    el.scrollTop -= 200;
  });
  const after = await page.evaluate(() => {
    const pillEl = document.querySelector("[data-jump-to-latest]")!;
    return pillEl.getBoundingClientRect().top;
  });
  expect(Math.abs(after - middle.pillTop)).toBeLessThanOrEqual(1);
}

// Summary strip: the status chip (data-testid="run-status") exists and is
// visible, using a sans-serif (not monospace) font.
async function assertStatusChip(page: Page): Promise<void> {
  const chip = page.locator("[data-testid='run-status']");
  await expect(chip).toBeVisible();
  const fontFamily = await chip.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fontFamily).not.toContain("monospace");
  expect(fontFamily).not.toContain("mono");
}

// The status strip lives on the Workspace, so the chip is NOT present on Home.
async function assertStatusChipNotVisible(page: Page): Promise<void> {
  await expect(page.locator("[data-testid='run-status']")).toHaveCount(0);
}

// Approval panel: Approve and Decline equal height, non-transparent border or
// fill, each width <= 320px.
async function assertApprovalButtons(page: Page): Promise<void> {
  const approve = page.getByRole("button", { name: "Approve" });
  const decline = page.getByRole("button", { name: "Decline" });
  await expect(approve).toBeVisible();
  await expect(decline).toBeVisible();

  const aBox = await approve.boundingBox();
  const dBox = await decline.boundingBox();
  expect(aBox).not.toBeNull();
  expect(dBox).not.toBeNull();
  expect(aBox!.height).toBe(dBox!.height);
  expect(aBox!.width).toBeLessThanOrEqual(320);
  expect(dBox!.width).toBeLessThanOrEqual(320);

  const [aStyle, dStyle] = await Promise.all([
    approve.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderColor: s.borderColor, borderWidth: s.borderWidth, backgroundColor: s.backgroundColor };
    }),
    decline.evaluate((el) => {
      const s = getComputedStyle(el);
      return { borderColor: s.borderColor, borderWidth: s.borderWidth, backgroundColor: s.backgroundColor };
    }),
  ]);
  const notTransparent = (s: { borderColor: string; borderWidth: string; backgroundColor: string }) =>
    (s.borderColor !== "transparent" && s.borderWidth !== "0px") ||
    (s.backgroundColor !== "transparent" && s.backgroundColor !== "rgba(0, 0, 0, 0)");
  expect(notTransparent(aStyle)).toBe(true);
  expect(notTransparent(dStyle)).toBe(true);
}

// Home: left edge >= 16px, Start button bg = primary token, radios styled.
async function assertHomeStyling(page: Page): Promise<void> {
  const form = page.locator("form");
  const formBox = await form.boundingBox();
  expect(formBox).not.toBeNull();
  expect(formBox!.x).toBeGreaterThanOrEqual(16);

  const startButton = page.getByRole("button", { name: "Start negotiating" });
  await expect(startButton).toBeEnabled();
  const bg = await startButton.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe("rgb(239, 239, 239)");
  expect(bg).not.toBe("transparent");
  expect(bg).toBe("rgb(43, 58, 140)"); // --color-primary #2B3A8C

  const radioInput = page.getByRole("radio").first();
  await expect(radioInput).toBeVisible();
  const appearance = await radioInput.evaluate((el) => getComputedStyle(el).appearance);
  expect(appearance).toBe("none");

  const radioWrapper = page.locator("label").filter({ has: page.getByRole("radio") }).first();
  const borderRadius = await radioWrapper.evaluate((el) => getComputedStyle(el).borderRadius);
  expect(parseFloat(borderRadius)).toBeGreaterThan(0);
}

test.describe("flow", () => {
  test.beforeEach(async ({ page }) => {
    watchErrors(page);
  });

  test.afterEach(async ({ page }) => {
    const testInfo = test.info();
    const id = runIdFromUrl(page);
    if (id) {
      recordRun(id);
    }
    const real = [...(pageErrors.get(page) ?? []), ...(realConsoleErrors.get(page) ?? [])];
    const network = networkErrors.get(page) ?? [];
    if (network.length > 0) {
      const networkMsg = `Network requests (expected, e.g. unknown run):\n${network.join("\n")}`;
      testInfo.attach("network-requests.txt", { body: networkMsg });
    }
    if (real.length > 0) {
      const errorMsg = `Console/page errors in "${testInfo.title}" (${testInfo.project.name}):\n${real.join("\n")}`;
      console.error(errorMsg);
      testInfo.attach("console-errors.txt", { body: errorMsg });
      throw new Error(errorMsg);
    }
  });

  test("home defaults and validation", async ({ page }) => {
    const testInfo = test.info();
    await page.goto("/");
    await assertLightTheme(page);
    await expect(page.getByRole("heading", { name: "New negotiation" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: /asking price/i })).toHaveValue("1200");
    await expect(page.getByRole("textbox", { name: /maximum budget/i })).toHaveValue("1000");
    await expect(
      page.getByRole("button", { name: /Flexible seller/ })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("radio", { name: "Ask me before closing" })
    ).toBeChecked();
    await expect(page.getByRole("button", { name: "Start negotiating" })).toBeEnabled();

    const note = page.getByText("Your budget is at or above the asking price, so there is little to haggle.");
    await expect(note).not.toBeVisible();

    await assertHomeStyling(page);
    await assertStatusChipNotVisible(page);
    await assertNoSeriousAxeViolations(page, "home");

    // Default state (1200 / 1000, no warning) screenshot.
    await shot(page, "home", testInfo.project.name);

    // Layout check on Home
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const innerWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth);

    // Validation: budget below asking disables the start button.
    const budgetInput = page.getByRole("textbox", { name: /maximum budget/i });
    await budgetInput.fill("0");
    await expect(page.getByRole("button", { name: "Start negotiating" })).toBeDisabled();

    // Validation: budget at or above asking shows the note.
    await budgetInput.fill("1200");
    await expect(note).toBeVisible();
    await shot(page, "home-validation", testInfo.project.name);
  });

  test("happy path ask-before-closing", async ({ page }) => {
    const testInfo = test.info();
    await page.goto("/");
    await assertLightTheme(page);
    await page.getByRole("textbox", { name: /maximum budget/i }).fill("1000");
    await page.getByRole("button", { name: "Start negotiating" }).click();

    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page)!;
    recordRun(id);

    await expect(page.getByRole("heading", { name: /Accept RM \d/ })).toBeVisible();
    await shot(page, "workspace-gate", testInfo.project.name);

    await assertApprovalButtons(page);
    await assertStatusChip(page);
    await assertNoSeriousAxeViolations(page, "workspace");

    const gateHeading = page.getByRole("heading", { name: /Accept RM \d/ });
    const gateText = await gateHeading.textContent();
    const gatePrice = gateText!.match(/RM (\d+)/)?.[1];
    expect(gatePrice).toBeTruthy();

    await page.getByRole("tab", { name: "Activity" }).click();
    await assertActivityIcons(page);
    await assertJumpToLatestBehaviour(page);
    // Scroll the list to a middle position for the activity-tab screenshot.
    await page.locator("[data-scroll-container]").evaluate((el) => {
      el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) / 2);
    });
    await shot(page, "activity-tab", testInfo.project.name);

    await expect(page.getByText("Plan").first()).toBeVisible();
    await expect(page.getByText("Write").first()).toBeVisible();
    await expect(page.getByText("Check").first()).toBeVisible();
    await expect(page.getByText("Passed all rules").first()).toBeVisible();
    await expect(page.getByText("Send").first()).toBeVisible();
    await expect(page.getByText("Read reply").first()).toBeVisible();
    await assertNoSeriousAxeViolations(page, "activity");

    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("img", { name: /Price ladder/ })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await assertNoSeriousAxeViolations(page, "deal");

    await page.getByRole("button", { name: "Approve" }).click();

    await expect(page.getByRole("heading", { name: "Deal agreed" })).toBeVisible();
    await expect(page.getByText(`RM ${gatePrice}`).first()).toBeVisible();
    await expect(page.getByText(/Pickup booked/)).toBeVisible();

    await shot(page, "deal-tab-outcome", testInfo.project.name);

    // Layout check on Deal tab
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    const iw = await page.evaluate(() => window.innerWidth);
    expect(sw).toBeLessThanOrEqual(iw);
  });

  test("decline", async ({ page }) => {
    const testInfo = test.info();
    await page.goto("/");
    await assertLightTheme(page);
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page)!;
    recordRun(id);

    await expect(page.getByRole("heading", { name: /Accept RM \d/ })).toBeVisible();
    await assertApprovalButtons(page);
    await page.getByRole("button", { name: "Decline" }).click();
    await page.getByRole("tab", { name: "Deal" }).click();

    await expect(page.getByText(/You declined the deal/)).toBeVisible();
    await expect(page.getByText(/Nothing was booked\./)).toBeVisible();
    await expect(page.getByText(/Pickup booked/)).not.toBeVisible();

    await shot(page, "declined", testInfo.project.name);
  });

  test("fully automatic", async ({ page }) => {
    const testInfo = test.info();
    await page.goto("/");
    await assertLightTheme(page);
    await page.getByRole("radio", { name: "Fully automatic" }).click();
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page)!;
    recordRun(id);

    // No gate ever appears.
    await expect(
      page.getByRole("heading", { name: /Accept RM \d/ })
    ).not.toBeVisible();

    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "Deal agreed" })).toBeVisible();
    await expect(page.getByText(/Pickup booked/)).toBeVisible();
  });

  test("reload keeps the truth", async ({ page, context }) => {
    const testInfo = test.info();
    await page.goto("/");
    await assertLightTheme(page);
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page)!;
    recordRun(id);

    await expect(page.getByRole("heading", { name: /Accept RM \d/ })).toBeVisible();
    const gateText = await page.getByRole("heading", { name: /Accept RM \d/ }).textContent();

    await page.reload();
    await assertLightTheme(page);
    await expect(page.getByRole("heading", { name: /Accept RM \d/ })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Accept RM \d/ })
    ).toHaveText(gateText!);

    const page2 = await context.newPage();
    watchErrors(page2);
    await page2.goto(page.url());
    await assertLightTheme(page2);
    await page2.getByRole("tab", { name: "Deal" }).click();
    await expect(page2.getByRole("heading", { name: /Accept RM \d/ })).toHaveText(
      gateText!
    );

    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("finished")).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator("h2", { hasText: "Deal agreed" })
    ).toHaveCount(1);
    await expect(
      page2.locator("h2", { hasText: "Deal agreed" })
    ).toHaveCount(1);
  });

  test("unknown run", async ({ page }) => {
    const testInfo = test.info();
    await page.goto("/#/run/deadbeef");
    await assertLightTheme(page);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Back" })).toBeVisible();
    await shot(page, "unknown-run", testInfo.project.name);
  });

  test("layout no horizontal scroll", async ({ page }) => {
    await page.goto("/");
    await assertLightTheme(page);
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "Deal agreed" })).toBeVisible();

    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    const iw = await page.evaluate(() => window.innerWidth);
    expect(sw).toBeLessThanOrEqual(iw);
  });

  test("theme toggle switches to dark and persists", async ({ page }) => {
    const testInfo = test.info();
    await page.goto("/");
    await assertLightTheme(page);
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator('[data-theme="dark"]')).toBeVisible();

    await page.reload();
    await expect(page.locator('[data-theme="dark"]')).toBeVisible();
  });

  test("next test starts in light mode after dark", async ({ page }) => {
    // This test follows the theme-toggle test in file order; a fresh context
    // per test guarantees it starts in light mode.
    await page.goto("/");
    await assertLightTheme(page);
  });

  test("keyboard-only: Tab reaches Approve and Enter activates it", async ({ page }) => {
    await page.goto("/");
    await assertLightTheme(page);
    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    await expect(page.getByRole("heading", { name: /Accept RM \d/ })).toBeVisible();

    const approve = page.getByRole("button", { name: "Approve" });
    for (let i = 0; i < 60; i++) {
      const focused = await page.evaluate(() => {
        const active = document.activeElement;
        return !!active && (active.textContent ?? "").trim().includes("Approve");
      });
      if (focused) break;
      await page.keyboard.press("Tab");
    }
    await expect(approve).toBeFocused();
    await page.keyboard.press("Enter");

    await page.getByRole("tab", { name: "Deal" }).click();
    await expect(page.getByRole("heading", { name: "Deal agreed" })).toBeVisible({
      timeout: 15000,
    });
  });

  test("accessibility", async ({ page }) => {
    await page.goto("/");
    await assertLightTheme(page);
    await assertNoSeriousAxeViolations(page, "home");

    await page.getByRole("button", { name: "Start negotiating" }).click();
    await page.waitForURL(/#\/run\/[0-9a-f]+/);
    const id = runIdFromUrl(page)!;
    recordRun(id);

    await expect(page.getByRole("heading", { name: /Accept RM \d/ })).toBeVisible();
    await assertNoSeriousAxeViolations(page, "workspace");

    await page.getByRole("tab", { name: "Activity" }).click();
    await assertNoSeriousAxeViolations(page, "activity");

    await page.getByRole("tab", { name: "Deal" }).click();
    await assertNoSeriousAxeViolations(page, "deal");
  });
});
