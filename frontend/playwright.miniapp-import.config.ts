import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /miniapp-(import|profile-source)\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3014",
    viewport: { width: 390, height: 844 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    command: "next dev --webpack --hostname 127.0.0.1 -p 3014",
    url: "http://localhost:3014/login",
    env: {
      NEXT_PUBLIC_PROTOTYPE_MODE: "false",
      NEXT_PUBLIC_ANALYTICS_ENABLED: "false",
      NEXT_PUBLIC_APP_ENV: "test",
    },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
