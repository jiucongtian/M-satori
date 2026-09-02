import { defineConfig, devices } from "@playwright/test";
const baseURL=process.env.ADMIN_BASE_URL||"http://localhost:6900";
const port=new URL(baseURL).port||"6900";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report/admin", open: "never" }]],
  use: {
    baseURL,
    channel: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx next dev -p ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet", testMatch: /admin-visual\.spec\.ts/, use: { ...devices["iPad (gen 7)"], browserName: "chromium", viewport: { width: 1024, height: 768 } } },
    { name: "mobile", testMatch: /admin-visual\.spec\.ts/, use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
});
