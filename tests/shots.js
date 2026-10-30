// Visual contact sheet: every tab at desktop/phone, light/dark → qa/*.png. Run: node tests/shots.js [outDir]
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const out = process.argv[2] || path.join(__dirname, "..", "qa");
fs.mkdirSync(out, { recursive: true });
const TABS = ["ackermann", "caster", "camber", "ride", "all"];
(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, "serve.js"), "8768"], { stdio: "ignore" });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch();
  for (const [name, vp, mobile] of [["desktop", { width: 1400, height: 900 }, false], ["phone", { width: 375, height: 812 }, true]]) {
    for (const scheme of ["light", "dark"]) {
      const ctx = await b.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: scheme });
      const p = await ctx.newPage();
      for (const t of TABS) {
        await p.goto(`http://127.0.0.1:8768/index.html?t=${t}#${t}`); // query differs so each tab is a full load, not a hash jump
        await p.waitForFunction(() => typeof RES !== "undefined" && RES && CUR);
        await p.evaluate(() => { setS(38); });
        await p.waitForTimeout(150);
        await p.screenshot({ path: path.join(out, `${name}-${scheme}-${t}.png`), fullPage: true });
      }
      await ctx.close();
    }
  }
  await b.close();
  srv.kill();
  console.log("written to " + out);
})().catch(e => { console.error(e); process.exit(1); });
