import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests run anywhere; the *.integration.test.ts files need PostgreSQL (see vitest.global-setup.ts)
// and skip themselves when no server answers on DATABASE_URL_TEST.
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    setupFiles: ["./vitest.setup.ts"],
    globalSetup: ["./vitest.global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } }
});
