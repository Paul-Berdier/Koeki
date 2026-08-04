import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies } from "next/headers";
import { hashInvitationToken, isInvitationUsable } from "@koeki/auth";
import { prisma } from "@koeki/database";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database", maxAge: 60 * 60 * 12, updateAge: 60 * 15 },
  providers: [Discord({ clientId: process.env.DISCORD_CLIENT_ID ?? "", clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "", authorization: { params: { scope: "identify guilds" } } })],
  pages: { error: "/access-denied" },
  cookies: { sessionToken: { name: "__Secure-koeki.session-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } } },
  callbacks: {
    async signIn({ user, account }) {
      const existing = user.id ? await prisma.user.findUnique({ where: { id: user.id }, include: { roles: true } }) : null;
      if (existing?.revokedAt) return false;
      if (existing?.roles.length) return true;
      const token = (await cookies()).get("koeki_invite")?.value;
      const pepper = process.env.INVITE_TOKEN_PEPPER;
      const userId = user.id;
      if (!token || !pepper || !userId || account?.provider !== "discord" || !account.access_token) return false;
      const guildId = process.env.DISCORD_GUILD_ID;
      if (guildId) {
        const response = await fetch("https://discord.com/api/users/@me/guilds", { headers: { Authorization: `Bearer ${account.access_token}` }, cache: "no-store" });
        if (!response.ok) return false;
        const guilds = await response.json() as Array<{ id: string }>;
        if (!guilds.some((guild) => guild.id === guildId)) return false;
      }
      const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashInvitationToken(token, pepper) } });
      if (!invitation || !isInvitationUsable(invitation)) return false;
      await prisma.$transaction(async (tx) => {
        const consumed = await tx.invitation.updateMany({ where: { id: invitation.id, status: "PENDING", consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { status: "USED", consumedById: userId, consumedAt: new Date() } });
        if (consumed.count !== 1) throw new Error("INVITATION_ALREADY_CONSUMED");
        await tx.userRole.create({ data: { userId, roleId: invitation.roleId, assignedById: invitation.createdById } });
        if (invitation.ninjaProfileId) await tx.ninjaProfile.update({ where: { id: invitation.ninjaProfileId }, data: { userId } });
        await tx.auditLog.create({ data: { actorId: userId, action: "INVITATION_CONSUMED", entityType: "Invitation", entityId: invitation.id, requestId: crypto.randomUUID(), newValues: { discordProviderAccountId: account.providerAccountId } } });
      });
      (await cookies()).delete("koeki_invite");
      return true;
    },
    async session({ session, user }) {
      const current = await prisma.user.findUnique({ where: { id: user.id }, include: { roles: { include: { role: true } } } });
      if (!current || current.revokedAt) throw new Error("SESSION_REVOKED");
      session.user.id = current.id;
      (session.user as typeof session.user & { roles: string[] }).roles = current.roles.map((entry) => entry.role.code);
      return session;
    }
  }
});
