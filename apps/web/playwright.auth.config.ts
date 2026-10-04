import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";
const database = process.env.DATABASE_URL_TEST;
if (!database) throw new Error("DATABASE_URL_TEST is required: authenticated tests never use a default development database");
const url = new URL(database);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/koeki_v2_test") throw new Error("Authenticated E2E requires the local disposable koeki_v2_test database");
process.env.DATABASE_URL = database;
process.env.DEMO_MODE = "false";
export default defineConfig({
  testDir: "./e2e-auth",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  outputDir: "./test-results/authenticated",
  use: { baseURL: "http://localhost:3100", javaScriptEnabled: true, trace: "retain-on-failure" },
  ...(process.env.E2E_EXTERNAL_SERVER === "true" ? {} : { webServer: {
    command: "node node_modules/next/dist/bin/next dev --port 3100",
    url: "http://localhost:3100/connexion", reuseExistingServer: false, timeout: 120_000,
    env: { DATABASE_URL: database, DEMO_MODE: "false", AUTH_SECRET: randomBytes(32).toString("hex"), AUTH_URL: "http://localhost:3100", AUTH_TRUST_HOST: "true", INVITE_TOKEN_PEPPER: randomBytes(32).toString("hex") }
  } }),
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } }
  ]
});
