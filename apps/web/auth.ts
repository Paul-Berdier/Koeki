import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies } from "next/headers";
import { hashInvitationToken, isInvitationUsable } from "@koeki/auth";
import { prisma } from "@koeki/database";

const refuse = (reason: string) => { console.warn(`[auth] connexion refusée : ${reason}`); return false; };

async function readInviteToken() { return (await cookies()).get("koeki_invite")?.value ?? null; }

async function findUsableInvitation(token: string) {
  const pepper = process.env.INVITE_TOKEN_PEPPER;
  if (!pepper) return null;
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash: hashInvitationToken(token, pepper) } });
  return invitation && isInvitationUsable(invitation) ? invitation : null;
}

/** Single-use consumption: assigns the invited role and links the ninja profile. Caller guarantees the user row exists. */
async function consumeInvitation(userId: string, token: string) {
  const invitation = await findUsableInvitation(token);
  if (!invitation) throw new Error("INVITATION_UNUSABLE");
  await prisma.$transaction(async (tx) => {
    if (invitation.ninjaProfileId) {
      await tx.$executeRaw`SELECT id FROM "NinjaProfile" WHERE id = ${invitation.ninjaProfileId} FOR UPDATE`;
      const linked = await tx.ninjaProfile.updateMany({
        where: { id: invitation.ninjaProfileId, status: "ACTIVE", userId: null },
        data: { userId, version: { increment: 1 } }
      });
      if (linked.count !== 1) throw new Error("INVITED_NINJA_UNAVAILABLE");
    }
    const consumed = await tx.invitation.updateMany({ where: { id: invitation.id, status: "PENDING", consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { status: "USED", consumedById: userId, consumedAt: new Date() } });
    if (consumed.count !== 1) throw new Error("INVITATION_ALREADY_CONSUMED");
    await tx.userRole.create({ data: { userId, roleId: invitation.roleId, assignedById: invitation.createdById } });
    await tx.auditLog.create({ data: { actorId: userId, action: "INVITATION_CONSUMED", entityType: "Invitation", entityId: invitation.id, requestId: crypto.randomUUID() } });
  });
  (await cookies()).delete("koeki_invite");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database", maxAge: 60 * 60 * 12, updateAge: 60 * 15 },
  providers: [Discord({ clientId: process.env.DISCORD_CLIENT_ID ?? "", clientSecret: process.env.DISCORD_CLIENT_SECRET ?? "", authorization: { params: { scope: "identify guilds" } } })],
  pages: { signIn: "/connexion", error: "/access-denied" },
  cookies: { sessionToken: { name: "__Secure-koeki.session-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } } },
  callbacks: {
    async signIn({ user, account }) {
      const existing = user.id ? await prisma.user.findUnique({ where: { id: user.id }, include: { roles: true } }) : null;
      if (existing?.revokedAt) return refuse("compte révoqué");
      if (existing?.roles.length) return true;
      if (account?.provider !== "discord" || !account.access_token) return refuse("jeton d’accès Discord absent");
      const token = await readInviteToken();
      if (!token) return refuse("cookie d’invitation absent ou expiré — rouvrir le lien d’invitation");
      if (!process.env.INVITE_TOKEN_PEPPER) return refuse("INVITE_TOKEN_PEPPER manquant côté serveur");
      const guildId = process.env.DISCORD_GUILD_ID;
      if (guildId) {
        const response = await fetch("https://discord.com/api/users/@me/guilds", { headers: { Authorization: `Bearer ${account.access_token}` }, cache: "no-store" });
        if (!response.ok) return refuse(`vérification du serveur Discord impossible (HTTP ${response.status})`);
        const guilds = await response.json() as Array<{ id: string }>;
        if (!guilds.some((guild) => guild.id === guildId)) return refuse(`le compte n’appartient pas au serveur ${guildId} (${guilds.length} serveur${guilds.length > 1 ? "s" : ""} visibles)`);
      }
      const invitation = await findUsableInvitation(token);
      if (!invitation) return refuse("invitation introuvable, expirée, révoquée ou déjà utilisée");
      // Existing account without role: the user row exists, consume immediately.
      if (existing) { try { await consumeInvitation(existing.id, token); } catch { return refuse("invitation déjà consommée par un autre compte"); } }
      // New account: the user row does not exist yet — consumption happens in events.createUser.
      return true;
    },
    async session({ session, user }) {
      const current = await prisma.user.findUnique({ where: { id: user.id }, include: { roles: { include: { role: true } } } });
      if (!current || current.revokedAt) throw new Error("SESSION_REVOKED");
      session.user.id = current.id;
      (session.user as typeof session.user & { roles: string[] }).roles = current.roles.map((entry) => entry.role.code);
      return session;
    }
  },
  events: {
    async createUser({ user }) {
      const token = await readInviteToken();
      try {
        if (!user.id || !token) throw new Error("INVITE_COOKIE_MISSING");
        await consumeInvitation(user.id, token);
      } catch (error) {
        // Without a consumed invitation the account must not survive: revoke it immediately.
        console.warn(`[auth] consommation d’invitation impossible pour le nouveau compte : ${error instanceof Error ? error.message : String(error)}`);
        if (user.id) await prisma.user.update({ where: { id: user.id }, data: { revokedAt: new Date() } }).catch(() => {});
      }
    },
    async linkAccount({ user, account }) {
      if (account.provider === "discord" && user.id) await prisma.user.update({ where: { id: user.id }, data: { discordId: account.providerAccountId } }).catch(() => {});
    }
  }
});
