import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import { prisma } from "@koeki/database";
import { hasConsistentDiscordIdentity, ownsDiscordIdentity } from "./discord-identity";

const discordAccounts = { where: { provider: "discord" }, select: { providerAccountId: true } } as const;

/** Auth.js can link a new OAuth identity to an already authenticated browser.
 * Kōeki deliberately supports one Discord identity per user, not account merging.
 * Keep the canonical id and Account row atomic; never silently overwrite an id. */
export const accessControlledAdapter: Adapter = {
  ...PrismaAdapter(prisma),
  async linkAccount(data) {
    if (data.provider !== "discord" || !data.providerAccountId) throw new Error("DISCORD_IDENTITY_CONFLICT");
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(621714424)`;
      const user = await tx.user.findUnique({ where: { id: data.userId }, include: { accounts: discordAccounts } });
      if (!user || user.revokedAt) throw new Error("SESSION_REVOKED");
      if (!hasConsistentDiscordIdentity(user)
        || (user.discordId !== null && user.discordId !== data.providerAccountId)
        || user.accounts.some((account) => account.providerAccountId !== data.providerAccountId)) {
        throw new Error("DISCORD_IDENTITY_CONFLICT");
      }
      const previous = await tx.account.findUnique({ where: { provider_providerAccountId: { provider: "discord", providerAccountId: data.providerAccountId } } });
      if (previous && previous.userId !== data.userId) throw new Error("DISCORD_IDENTITY_CONFLICT");
      const canonicalOwner = await tx.user.findUnique({ where: { discordId: data.providerAccountId }, select: { id: true } });
      if (canonicalOwner && canonicalOwner.id !== data.userId) throw new Error("DISCORD_IDENTITY_CONFLICT");
      const account = previous ?? await tx.account.create({ data });
      if (user.discordId === null) await tx.user.update({ where: { id: user.id }, data: { discordId: data.providerAccountId } });
      return account as AdapterAccount;
    });
  },
  async getUserByAccount({ provider, providerAccountId }) {
    if (provider !== "discord") return null;
    const account = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      include: { user: { include: { accounts: discordAccounts } } },
    });
    if (!account) return null;
    // Throw instead of returning null: null would let OAuth try to create/link a
    // replacement user. A conflict needs an explicit, reviewed correction.
    if (!ownsDiscordIdentity(account.user, providerAccountId)) throw new Error("DISCORD_IDENTITY_CONFLICT");
    const { accounts: _accounts, ...user } = account.user;
    void _accounts;
    return user as AdapterUser;
  },
  async createSession(data) {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(621714424)`;
      const user = await tx.user.findUnique({ where: { id: data.userId }, select: { revokedAt: true, sessionVersion: true, discordId: true, accounts: discordAccounts, roles: { select: { roleId: true } } } });
      if (!user || user.revokedAt || !user.roles.length) throw new Error("SESSION_REVOKED");
      if (!hasConsistentDiscordIdentity(user)) throw new Error("DISCORD_IDENTITY_CONFLICT");
      return tx.session.create({ data: { ...data, sessionVersion: user.sessionVersion } });
    });
  },
  async getSessionAndUser(sessionToken) {
    const result = await prisma.session.findUnique({ where: { sessionToken }, include: { user: { include: { accounts: discordAccounts } } } });
    if (!result || result.user.revokedAt || result.sessionVersion !== result.user.sessionVersion || result.expires <= new Date()) return null;
    if (!hasConsistentDiscordIdentity(result.user)) return null;
    const { user: identity, ...session } = result;
    const { accounts: _accounts, ...user } = identity;
    void _accounts;
    // Discord identify does not require an email. Never expose OAuth tokens.
    return { user: user as AdapterUser, session };
  }
};
