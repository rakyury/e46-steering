// UX tests for the E46 front-axle app (Playwright, Chromium). Run: npm run test:ux
const { test, expect } = require("@playwright/test");

const num = s => parseFloat(String(s).replace("−", "-").replace(/[^\d.\-]/g, ""));
const TABS = ["ackermann", "caster", "camber", "ride", "all"];

async function open(page, hash = "ackermann") {
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`/index.html#${hash}`);
  // RES/CUR are top-level `let`s, so they are not window properties
  await page.waitForFunction(() => typeof RES !== "undefined" && RES && CUR);
  return errors;
}

test.describe("loads cleanly", () => {
  test("every tab renders without console errors, in light and dark", async ({ page }) => {
    const errors = await open(page);
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const t of TABS) {
        await page.click(`#tab_${t}`);
        await expect(page.locator(`#tab_${t}`)).toHaveAttribute("aria-selected", "true");
        expect(await page.evaluate(() => location.hash)).toBe(`#${t}`);
        // the main figure is actually drawn (canvas has pixels)
        const painted = await page.evaluate(() => { const cv = document.querySelector("#main canvas"); const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) n++; return n; });
        expect(painted).toBeGreaterThan(50);
      }
    }
    expect(errors).toEqual([]);
  });
  test("dark mode changes the paper colour", async ({ page }) => {
    await open(page);
    const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(dark).not.toBe(light);
  });
  test("tab is remembered across reloads", async ({ page }) => {
    await open(page);
    await page.click("#tab_camber");
    await page.goto("/index.html");
    await page.waitForFunction(() => typeof RES !== "undefined" && RES);
    await expect(page.locator("#tab_camber")).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("defaults", () => {
  test("opens straight ahead with parallel steer: 0 % static Ackermann at the control's zero", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => P.s)).toBe(0);
    expect(await page.textContent("#kA")).toBe("—");
    expect(Math.abs(await page.evaluate(() => RES.M.ackStatic))).toBeLessThan(1.5);
    await expect(page.locator("#c_troDY")).toHaveValue("0.0");
    expect(await page.textContent("#k_troDY p")).toMatch(/По чертежу шарнир стоит на 10\.\d мм/);
  });
});

test.describe("input robustness", () => {
  test("Escape and garbage in a chip keep the current pose", async ({ page }) => {
    await open(page);
    await page.locator("#steer").fill("-38"); await page.locator("#steer").dispatchEvent("input");
    await page.fill("#kL", "25"); await page.press("#kL", "Escape");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => P.s)).toBe(38);
    await page.fill("#kS", "abc"); await page.press("#kS", "Enter");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => P.s)).toBe(38);
    await expect.poll(() => page.inputValue("#kS")).toBe("−38.0"); // chips show + = right; the slider at −38 is a left turn
  });
  test("garbage in the alignment row changes nothing", async ({ page }) => {
    await open(page);
    const slot = await page.evaluate(() => P.slot), toe = await page.evaluate(() => P.toe);
    await page.fill("#aCam", "abc"); await page.press("#aCam", "Enter");
    await page.fill("#aToe", "x"); await page.press("#aToe", "Enter");
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => P.slot)).toBe(slot);
    expect(await page.evaluate(() => P.toe)).toBe(toe);
  });
  test("the slider cannot go past the solvable travel when the tie rod hits its dead point", async ({ page }) => {
    await open(page, "ackermann");
    await page.fill("#c_troDY", "-30"); await page.press("#c_troDY", "Tab");
    await expect.poll(() => page.evaluate(() => RES.sHi)).toBeLessThan(60);
    await page.evaluate(() => setS(60)); // a chip, the keyboard or play can still ask for full stroke
    const o = await page.evaluate(() => ({ s: P.s, hi: RES.sHi, ok: CUR.ok, min: +document.querySelector("#steer").min }));
    expect(o.s).toBeLessThanOrEqual(o.hi);
    expect(o.ok).toBe(true);
    expect(-o.min).toBeCloseTo(o.hi, 5);
  });
  test("camber via plate rotation converges instead of running away", async ({ page }) => {
    await open(page, "camber");
    await page.selectOption("#aCamVia", "plateA");
    await page.fill("#aCam", "-4.5"); await page.press("#aCam", "Enter"); // the plate alone tops out near −4.1°, so −4.5° is reachable with caster held
    await expect.poll(async () => num(await page.inputValue("#aCam"))).toBeCloseTo(-4.5, 1);
    expect(num(await page.inputValue("#aCas"))).toBeCloseTo(4.77, 1);
    expect(Math.abs(await page.evaluate(() => P.plateA))).toBeLessThan(179);
    expect(await page.textContent("#aMsg")).toBe("");
    // out of reach: settles on the closest value and says so, instead of jumping to ±180°
    await page.fill("#aCam", "-2"); await page.press("#aCam", "Enter");
    await expect.poll(() => page.textContent("#aMsg")).toContain("не хватает хода");
    expect(Math.abs(await page.evaluate(() => P.plateA))).toBeLessThan(179);
    expect(num(await page.inputValue("#aCam"))).toBeGreaterThan(-4.5);
  });
  test("delta table never shows an arrow between two equal printed values", async ({ page }) => {
    await open(page, "caster");
    await page.fill("#c_lbjDX", "0.5"); await page.press("#c_lbjDX", "Tab");
    await page.waitForTimeout(150);
    const rows = await page.$$eval("#dtab tr", trs => trs.map(tr => [...tr.children].map(td => td.textContent.trim())));
    for (const [, v, dv] of rows) {
      const m = v.match(/^(.+?) →\s*(.+?) /);
      if (m) expect(m[1], v).not.toBe(m[2]); else expect(dv).toBe("=");
    }
  });
});

test.describe("steering", () => {
  test("slider turns the wheels, centre button straightens them", async ({ page }) => {
    await open(page);
    await page.locator("#steer").fill("-40"); // slider value = −rack, so −40 is a left turn of 40 mm
    await page.locator("#steer").dispatchEvent("input");
    await expect.poll(() => page.inputValue("#kS")).toBe("−40.0"); // chips show + = right
    const kL = num(await page.inputValue("#kL")), kR = num(await page.inputValue("#kR"));
    expect(kL).toBeLessThan(-25); expect(kR).toBeLessThan(-25);
    expect(Math.abs(kL - kR)).toBeLessThan(3); // parallel steer by default: both wheels close together
    await page.click("#center");
    await expect.poll(() => page.inputValue("#kS")).toBe("0");
    expect(await page.textContent("#kA")).toBe("—");
  });
  test("slider right = positive chips = wheels turned right", async ({ page }) => {
    await open(page);
    await page.locator("#steer").fill("30"); await page.locator("#steer").dispatchEvent("input");
    await expect.poll(() => page.inputValue("#kS")).toBe("30.0");
    expect(num(await page.inputValue("#kL"))).toBeGreaterThan(15);
    expect(num(await page.inputValue("#kR"))).toBeGreaterThan(15);
    const f = await page.evaluate(() => CUR.L.f); // the wheel's forward vector leans to −Y, the car's right
    expect(f[1]).toBeLessThan(-0.2);
  });
  test("typing a wheel angle finds the rack position", async ({ page }) => {
    await open(page);
    await page.fill("#kR", "-30"); // typed with + = right: −30 is a left turn, internally del = +30
    await page.press("#kR", "Enter");
    await expect.poll(() => page.evaluate(() => CUR.R.del)).toBeCloseTo(30, 2);
    await expect.poll(async () => num(await page.inputValue("#kS"))).toBeCloseTo(await page.evaluate(() => -P.s), 1); // redraw happens on the next frame
    expect(await page.evaluate(() => P.s)).toBeGreaterThan(30);
    await expect.poll(async () => num(await page.inputValue("#kR"))).toBeCloseTo(-30, 1);
    await page.fill("#kS", "20");
    await page.press("#kS", "Enter");
    await expect.poll(() => page.evaluate(() => P.s)).toBeCloseTo(-20, 5);
  });
  test("dragging across a chart steers", async ({ page }) => {
    await open(page, "ackermann");
    const cv = page.locator("#c1");
    await cv.scrollIntoViewIfNeeded();
    const b = await cv.boundingBox();
    await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.5, { steps: 5 });
    await page.mouse.up();
    const s = await page.evaluate(() => P.s);
    expect(s).toBeLessThan(-20); // right of centre on the chart = right turn = negative rack
  });
  test("lock-to-lock playback runs and stops", async ({ page }) => {
    await open(page);
    const s0 = await page.evaluate(() => P.s);
    await page.click("#play");
    await page.waitForTimeout(400);
    const s1 = await page.evaluate(() => P.s);
    expect(s1).not.toBe(s0);
    await page.click("#play");
    const s2 = await page.evaluate(() => P.s);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => P.s)).toBe(s2);
  });
});

test.describe("adjustments", () => {
  test("stepper, slider, undo and reset", async ({ page }) => {
    await open(page, "ackermann");
    await page.click('#k_rackDX [data-step="1"]');
    await expect(page.locator("#c_rackDX")).toHaveValue("1");
    await expect(page.locator("#k_rackDX .undo")).toBeVisible();
    await page.locator("#r_rackDX").fill("25");
    await page.locator("#r_rackDX").dispatchEvent("input");
    await expect(page.locator("#c_rackDX")).toHaveValue("25");
    expect(await page.textContent("#dtab")).toMatch(/[▲▼]/);
    await page.click("#k_rackDX .undo");
    await expect(page.locator("#c_rackDX")).toHaveValue("0");
    await expect(page.locator("#k_rackDX .undo")).toBeHidden();
  });
  test("remember as base hides deltas; reset-all restores the drawing", async ({ page }) => {
    await open(page, "ackermann");
    await page.fill("#c_troDY", "-20");
    await page.press("#c_troDY", "Tab");
    await expect.poll(() => page.textContent("#dtab")).toMatch(/▼/);
    await page.click("#pin");
    expect(await page.textContent("#dtab")).not.toMatch(/[▲▼]/);
    await page.click("#reset");
    await expect(page.locator("#c_troDY")).toHaveValue("0.0");
  });
  test("anti-Ackermann is labelled and the outer wheel turns more", async ({ page }) => {
    await open(page, "ackermann");
    await page.fill("#c_troDY", "-20");
    await page.press("#c_troDY", "Tab");
    await page.locator("#steer").fill("-40");
    await page.locator("#steer").dispatchEvent("input");
    await expect.poll(() => page.textContent("#kA")).toContain("анти");
    expect(Math.abs(num(await page.inputValue("#kR")))).toBeGreaterThan(Math.abs(num(await page.inputValue("#kL")))); // anti: outer (right) wheel turned more
    expect(await page.textContent("#nTop")).toContain("анти");
  });
  test("dragging the rack handle on the top view moves the rack", async ({ page }) => {
    await open(page, "ackermann");
    const cv = page.locator("#vTop canvas");
    const b = await cv.boundingBox();
    const h = await page.evaluate(() => document.querySelector("#vTop canvas")._F.handles.find(h => h.kind === "rack"));
    await page.mouse.move(b.x + h.x, b.y + h.y);
    await page.mouse.down();
    await page.mouse.move(b.x + h.x, b.y + h.y - 40, { steps: 6 });
    await page.mouse.up();
    expect(await page.evaluate(() => P.rackDX)).toBeGreaterThan(5);
  });
  test("dragging the knuckle on the side view moves the ball joint in its slot", async ({ page }) => {
    await open(page, "caster");
    const cv = page.locator("#vSide canvas");
    const b = await cv.boundingBox();
    const h = await page.evaluate(() => document.querySelector("#vSide canvas")._F.handles.find(h => h.kind === "knuckle"));
    await page.mouse.move(b.x + h.x, b.y + h.y);
    await page.mouse.down();
    await page.mouse.move(b.x + h.x + 30, b.y + h.y, { steps: 6 });
    await page.mouse.up();
    expect(await page.evaluate(() => P.lbjDX)).not.toBe(0);
  });
});

test.describe("alignment by numbers", () => {
  test("camber via strut slot holds caster", async ({ page }) => {
    await open(page, "camber");
    await page.selectOption("#aCamVia", "slot");
    await page.fill("#aCam", "-3.5");
    await page.press("#aCam", "Enter");
    await expect.poll(async () => num(await page.inputValue("#aCam"))).toBeCloseTo(-3.5, 1);
    expect(num(await page.inputValue("#aCas"))).toBeCloseTo(4.77, 1);
    expect(await page.evaluate(() => P.slot)).toBeLessThan(-1);
  });
  test("caster via lollipop holds camber", async ({ page }) => {
    await open(page, "caster");
    await page.selectOption("#aCasVia", "lolly");
    await page.fill("#aCas", "7");
    await page.press("#aCas", "Enter");
    await expect.poll(async () => num(await page.inputValue("#aCas"))).toBeCloseTo(7, 1);
    expect(num(await page.inputValue("#aCam"))).toBeCloseTo(-4.69, 1);
    expect(await page.evaluate(() => P.lolly)).toBeGreaterThan(5);
  });
  test("toe entry sets the model toe", async ({ page }) => {
    await open(page);
    await page.fill("#aToe", "0.2");
    await page.press("#aToe", "Enter");
    await expect.poll(() => page.evaluate(() => P.toe)).toBeCloseTo(0.2, 5);
    expect(await page.evaluate(() => RES.sw[80].L.del)).toBeCloseTo(-0.2, 5);
  });
});

test.describe("expert settings", () => {
  test("wheelbase feeds Ackermann; a hardpoint edit recomputes", async ({ page }) => {
    await open(page);
    const a = await page.evaluate(() => RES.M.ackLock);
    await page.locator("details.settings summary").click();
    await page.fill("#s_wheelbase", "2400");
    await page.press("#s_wheelbase", "Tab");
    await expect.poll(() => page.evaluate(() => RES.M.ackLock)).not.toBeCloseTo(a, 0);
    const c = await page.evaluate(() => RES.M.caster);
    await page.fill("#hp_LBJ_0", "55");
    await page.press("#hp_LBJ_0", "Tab");
    await expect.poll(() => page.evaluate(() => RES.M.caster)).not.toBeCloseTo(c, 1);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test("no horizontal scroll, compact sticky strip, alignment folds", async ({ page }) => {
    await open(page);
    for (const t of TABS) {
      await page.click(`#tab_${t}`);
      const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      expect(o.sw, t).toBeLessThanOrEqual(o.cw);
    }
    const strip = await page.evaluate(() => document.querySelector(".wheel").offsetHeight);
    expect(strip).toBeLessThanOrEqual(150);
    // the strip is a bottom bar on phones: fixed at the viewport bottom, and the page leaves room for it
    const bar = await page.evaluate(() => { const r = document.querySelector(".wheel").getBoundingClientRect(); return { bottom: Math.round(r.bottom), vh: innerHeight, pad: parseFloat(getComputedStyle(document.body).paddingBottom) }; });
    expect(bar.bottom).toBe(bar.vh);
    expect(bar.pad).toBeGreaterThanOrEqual(strip - 1);
    for (const id of ["#kL", "#kR", "#kS", "#kA", "#kC"]) {
      const o = await page.$eval(id, el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
      expect(o.sw, id).toBeLessThanOrEqual(o.cw + 1);
    }
    await expect(page.locator(".align")).toBeHidden();
    await page.click("#alignTg");
    await expect(page.locator(".align")).toBeVisible();
    await page.click("#alignTg");
    await expect(page.locator(".align")).toBeHidden();
  });
  test("a vertical swipe over a chart scrolls instead of steering", async ({ page }) => {
    await open(page, "ackermann");
    expect(await page.evaluate(() => getComputedStyle(document.querySelector("#c1")).touchAction)).toBe("pan-y");
    const s0 = await page.evaluate(() => P.s);
    const cv = page.locator("#c1");
    await cv.scrollIntoViewIfNeeded();
    const b = await cv.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 - 80 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    expect(await page.evaluate(() => P.s)).toBe(s0);
  });
  test("a five-character stepper value is not clipped", async ({ page }) => {
    await open(page, "ackermann");
    await page.fill("#c_troDY", "-11.5"); await page.press("#c_troDY", "Tab");
    await expect(page.locator("#c_troDY")).toHaveValue("-11.5");
    const o = await page.$eval("#c_troDY", el => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(o.sw).toBeLessThanOrEqual(o.cw);
    await expect(page.locator("#k_troDY .undo")).toHaveText(/параллельный руль/);
  });
  test("touch targets are at least 36 px tall", async ({ page }) => {
    await open(page, "ackermann");
    for (const sel of ['#k_rackDX [data-step="1"]', "#center", "#tab_caster", "#play"]) {
      const b = await page.locator(sel).boundingBox();
      expect(b.height, sel).toBeGreaterThanOrEqual(36);
    }
  });
});
