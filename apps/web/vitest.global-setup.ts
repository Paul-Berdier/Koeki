import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext { dbReady: boolean }
}

interface PgClient { connect(): Promise<void>; query(sql: string, values?: unknown[]): Promise<{ rowCount: number | null }>; end(): Promise<void> }

const TEST_URL = process.env.DATABASE_URL_TEST ?? "postgresql://koeki:koeki@127.0.0.1:5432/koeki_test?schema=public";

/** Creates the throwaway database (if the server answers) and applies every migration to it. */
export default async function setup(project: TestProject) {
  let ready = false;
  try {
    // `pg` is a dependency of @koeki/database, resolved from there.
    const databaseDir = path.resolve(process.cwd(), "../../packages/database");
    const requireFromDatabase = createRequire(pathToFileURL(path.join(databaseDir, "package.json")));
    const { Client } = requireFromDatabase("pg") as { Client: new (config: Record<string, unknown>) => PgClient };
    const url = new URL(TEST_URL);
    const database = url.pathname.slice(1);
    const admin = new Client({ host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: "postgres", connectionTimeoutMillis: 3_000 });
    await admin.connect();
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${database}"`);
    await admin.end();
    const prismaCli = path.join(databaseDir, "node_modules/prisma/build/index.js");
    if (!existsSync(prismaCli)) throw new Error(`Prisma CLI not found at ${prismaCli}`);
    execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: databaseDir, env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: "pipe" });
    ready = true;
  } catch (error) {
    console.warn(`[vitest] PostgreSQL indisponible pour les tests d'intégration (${error instanceof Error ? error.message.split("\n")[0] : String(error)}) — ils seront ignorés.`);
  }
  project.provide("dbReady", ready);
}
