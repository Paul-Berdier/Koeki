import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
const database = process.env.DATABASE_URL_TEST;
if (!database) throw new Error("DATABASE_URL_TEST is required: authenticated tests never use a default development database");
const url = new URL(database);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !["/koeki_v2_test", "/koeki_front_test_20261004"].includes(url.pathname)) {
  throw new Error("Authenticated E2E requires an explicitly allowed local disposable database");
}
process.env.DATABASE_URL = database;
process.env.DEMO_MODE = "false";
// Inherited by workers and the test server; never use real application credentials.
process.env.KOEKI_E2E_INVITE_PEPPER ??= randomBytes(32).toString("hex");
process.env.KOEKI_E2E_OAUTH_SECRET ??= randomBytes(32).toString("hex");
export default defineConfig({
  testDir: "./e2e-auth", timeout: 90_000, expect: { timeout: 20_000 }, workers: 1,
  // A failure still fails the job. On success every scenario runs; no retries or exclusions.
  maxFailures: process.env.CI ? 1 : 0,
  outputDir: "./test-results/authenticated",
  use: { baseURL: "http://localhost:3100", javaScriptEnabled: true, trace: "retain-on-failure" },
  ...(process.env.E2E_EXTERNAL_SERVER === "true" ? {} : {
    webServer: {
      command: "node --import ./e2e-auth/discord-fetch-fixture.mjs node_modules/next/dist/bin/next dev --port 3100",
      url: "http://localhost:3100/connexion", reuseExistingServer: false, timeout: 120_000,
      env: {
        DATABASE_URL: database, DATABASE_URL_TEST: database, DEMO_MODE: "false",
        AUTH_SECRET: randomBytes(32).toString("hex"), AUTH_URL: "http://localhost:3100", AUTH_TRUST_HOST: "true",
        INVITE_TOKEN_PEPPER: process.env.KOEKI_E2E_INVITE_PEPPER,
        KOEKI_E2E_OAUTH_SECRET: process.env.KOEKI_E2E_OAUTH_SECRET,
        DISCORD_CLIENT_ID: "999999999999999998", DISCORD_CLIENT_SECRET: "local-oauth-fixture-not-a-real-secret", DISCORD_GUILD_ID: "999999999999999999",
      },
    },
  }),
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});
