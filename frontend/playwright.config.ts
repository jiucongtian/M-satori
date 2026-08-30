import { defineConfig } from "@playwright/test";

const devices = [
  ["small-phone", 320, 568],
  ["android-phone", 360, 800],
  ["mate-x7-outer", 360, 815],
  ["iphone", 390, 844],
  ["large-phone", 430, 932],
  ["mate-x7-inner", 737, 805],
  ["tablet", 768, 1024],
  ["desktop", 1366, 768],
] as const;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3011",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev:e2e",
    url: "http://127.0.0.1:3011/home",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: devices.map(([name, width, height]) => ({
    name,
    use: { viewport: { width, height } },
  })),
});
