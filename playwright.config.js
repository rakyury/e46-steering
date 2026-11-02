// UX tests: npm run test:ux
const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.js/,
  timeout: 30000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8766", browserName: "chromium", viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 },
  // visual baselines live next to the specs without a platform suffix; canvas output is compared loosely enough
  // to ignore antialiasing, tightly enough to catch a moved label or a lost line
  snapshotPathTemplate: "{testDir}/__snapshots__/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.004, threshold: 0.25, animations: "disabled" } },
  webServer: { command: "node tests/serve.js 8766", url: "http://127.0.0.1:8766/index.html", reuseExistingServer: true, timeout: 15000 }
});
