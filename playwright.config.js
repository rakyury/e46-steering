// UX tests: npm run test:ux
const { defineConfig } = require("@playwright/test");
module.exports = defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.js/,
  timeout: 30000,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8766", browserName: "chromium", viewport: { width: 1400, height: 900 } },
  webServer: { command: "node tests/serve.js 8766", url: "http://127.0.0.1:8766/index.html", reuseExistingServer: true, timeout: 15000 }
});
