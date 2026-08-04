import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { koekiPrisma?: PrismaClient };
const connectionString = process.env.DATABASE_URL ?? "postgresql://koeki:koeki@127.0.0.1:5432/koeki?schema=public";
export const prisma = globalForPrisma.koekiPrisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }), log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"] });
if (process.env.NODE_ENV !== "production") globalForPrisma.koekiPrisma = prisma;
export * from "@prisma/client";
