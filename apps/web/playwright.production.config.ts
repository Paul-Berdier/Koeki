import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";

const database = process.env.DATABASE_URL_TEST;
if (!database) throw new Error("DATABASE_URL_TEST required for production-browser regression tests");
const url = new URL(database);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/koeki_v2_test") throw new Error("Only the explicitly allowed local disposable E2E database is accepted");
process.env.DATABASE_URL = database;
process.env.DEMO_MODE = "false";

export default defineConfig({
  testDir: "./e2e-production", timeout: 45_000, expect: { timeout: 10_000 }, workers: 1,
  retries: 0, reporter: "list", outputDir: "./test-results/production",
  use: { baseURL: "http://localhost:3101", javaScriptEnabled: true, serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node node_modules/next/dist/bin/next start --port 3101",
    url: "http://localhost:3101/connexion", reuseExistingServer: false, timeout: 60_000,
    env: { NODE_ENV: "production", DATABASE_URL: database, DATABASE_URL_TEST: database,
      DEMO_MODE: "false", AUTH_SECRET: randomBytes(32).toString("hex"),
      AUTH_URL: "http://localhost:3101", AUTH_TRUST_HOST: "true", INVITE_TOKEN_PEPPER: randomBytes(32).toString("hex"),
      DISCORD_CLIENT_ID: "999999999999999998", DISCORD_CLIENT_SECRET: "local-production-test-only", DISCORD_GUILD_ID: "999999999999999999" },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
});
