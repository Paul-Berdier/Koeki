import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm start",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    env: {
      DEMO_MODE: "true",
      DATABASE_URL: "postgresql://koeki:koeki@127.0.0.1:5432/koeki?schema=public",
      AUTH_SECRET: "development-only-secret-at-least-32-characters",
      AUTH_URL: "http://127.0.0.1:3000",
      AUTH_TRUST_HOST: "true",
      DISCORD_CLIENT_ID: "development-client",
      DISCORD_CLIENT_SECRET: "development-secret",
      DISCORD_GUILD_ID: "development-guild",
      INVITE_TOKEN_PEPPER: "development-invite-pepper-value"
    }
  },
  projects: [
    { name: "desktop", testIgnore: /mobile/, use: { ...devices["Desktop Chrome"], javaScriptEnabled: false, viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testMatch: /(visual|inventory)\.spec\.ts/, use: { ...devices["iPhone 13"], browserName: "chromium", javaScriptEnabled: false, viewport: { width: 390, height: 844 } } },
    // Client-side behaviour of the inventory register (search, filters, drawer) needs JavaScript.
    { name: "interactive", testMatch: /(inventory|ninjas-search)\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }
  ]
});
