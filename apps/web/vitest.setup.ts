// Runs in every worker before test files import the application modules: the Prisma singleton
// must point at the throwaway test database, never at a developer's data.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgresql://koeki:koeki@127.0.0.1:5432/koeki_test?schema=public";
process.env.DEMO_MODE = "";
