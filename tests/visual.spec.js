// Visual snapshots: the main drawing and the first chart of every tab, desktop and phone, against the baselines in
// tests/__snapshots__. A broken picture (labels on top of each other, a wheel through the ground, a lost line) fails
// here even when every number is still right. Refresh the baselines on purpose with: npm run snap
const { test, expect } = require("@playwright/test");

const TABS = [
  { id: "ackermann", s: -40 },
  { id: "caster", s: 0 },
  { id: "camber", s: -50 },
  { id: "ride", s: 0, pre: () => { P.roll = 2; syncCtl(); recompute(); } },
  { id: "strut", s: 0 },
  { id: "rear", s: 0 },
];

async function settle(page, s, pre) {
  await page.waitForFunction(() => typeof RES !== "undefined" && RES && CUR);
  await page.evaluate(() => document.fonts.ready);
  if (pre) await page.evaluate(pre);
  await page.evaluate(v => setS(v), s);
  // two frames: the redraw is scheduled on requestAnimationFrame, and the alternative curves fill in on the next one
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(150);
}

for (const t of TABS) {
  test(`desktop · ${t.id}: main view and first chart`, async ({ page }) => {
    await page.goto(`/index.html#${t.id}`);
    await settle(page, t.s, t.pre);
    await expect(page.locator("#main canvas")).toHaveScreenshot(`${t.id}-main.png`);
    const chart = page.locator("#rest .ch canvas").first();
    if (await chart.count()) await expect(chart).toHaveScreenshot(`${t.id}-chart.png`);
  });
}

test("desktop · plan view in a drift", async ({ page }) => {
  await page.goto("/index.html#ackermann?drift=35");
  await settle(page, -40);
  await expect(page.locator("#vPlan canvas")).toHaveScreenshot("plan-drift.png");
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("ackermann at lock: strip and top view", async ({ page }) => {
    await page.goto("/index.html#ackermann");
    await settle(page, -40);
    await expect(page.locator(".wheel")).toHaveScreenshot("phone-strip.png");
    await expect(page.locator("#main canvas")).toHaveScreenshot("phone-top.png");
  });
  test("front view with the roll", async ({ page }) => {
    await page.goto("/index.html#ride?roll=2");
    await settle(page, 0);
    await expect(page.locator("#main canvas")).toHaveScreenshot("phone-front-roll.png");
  });
});
