import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { prisma } from "@koeki/database";

/** Auth.js database strategy: sessionVersion is checked, not merely incremented. */
export const accessControlledAdapter: Adapter = {
  ...PrismaAdapter(prisma),
  async createSession(data) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(621714424)`;
      const user = await tx.user.findUnique({ where: { id: data.userId }, select: { revokedAt: true, sessionVersion: true, roles: { select: { roleId: true } } } });
      if (!user || user.revokedAt || !user.roles.length) throw new Error("SESSION_REVOKED");
      return tx.session.create({ data: { ...data, sessionVersion: user.sessionVersion } });
    });
  },
  async getSessionAndUser(sessionToken) {
    const result = await prisma.session.findUnique({ where: { sessionToken }, include: { user: true } });
    if (!result || result.user.revokedAt || result.sessionVersion !== result.user.sessionVersion || result.expires <= new Date()) return null;
    const { user, ...session } = result;
    // Discord identify does not require an email; PrismaAdapter uses the same
    // AdapterUser assertion for this nullable database field.
    return { user: user as AdapterUser, session };
  }
};
