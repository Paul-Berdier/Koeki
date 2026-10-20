import NextAuth from "next-auth";
import { createDiscordProvider } from "@/lib/discord-provider";
import { cookies } from "next/headers";
import { prisma } from "@koeki/database";
import { consumeInvitationAccess } from "@/lib/invitation-service";
import { accessControlledAdapter } from "@/lib/auth-session-adapter";
import { ownsDiscordIdentity } from "@/lib/discord-identity";
import { checkInvitation } from "@/lib/invitation-check";
import { INVITATION_COOKIE, type InvitationFailure } from "@/lib/invitation-state";

type Refusal = InvitationFailure | "InvitationRequired" | "AccountRevoked" | "DiscordMembershipRequired" | "DiscordUnavailable" | "AccountIdentityMismatch";
const refuse = (code: Refusal) => {
  console.warn(`[auth] connexion refusée : ${code}`);
  return `/access-denied?error=${code}`;
};
async function readInviteToken() { return (await cookies()).get(INVITATION_COOKIE)?.value ?? null; }

async function consumeInvitation(userId: string, token: string) {
  const check = await checkInvitation(token);
  if (!check.ok) throw new Error(check.error);
  // The transaction rechecks status, expiry, creator rights and the ninja reservation.
  await consumeInvitationAccess(userId, check.id);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: accessControlledAdapter,
  session: { strategy: "database", maxAge: 60 * 60 * 12, updateAge: 60 * 15 },
  providers: [createDiscordProvider()],
  pages: { signIn: "/connexion", error: "/access-denied" },
  cookies: { sessionToken: { name: process.env.NODE_ENV === "production" ? "__Secure-koeki.session-token" : "koeki.session-token", options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" } } },
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "discord" || !account.providerAccountId) return refuse("DiscordUnavailable");
      // Resolve the authenticated provider id, not a supplied RP name, email,
      // invitation target or a potentially unrelated browser session.
      const linked = await prisma.account.findUnique({
        where: { provider_providerAccountId: { provider: "discord", providerAccountId: account.providerAccountId } },
        include: { user: { include: { roles: true, accounts: { where: { provider: "discord" }, select: { providerAccountId: true } } } } },
      });
      const existing = linked?.user ?? null;
      if (existing && (!ownsDiscordIdentity(existing, account.providerAccountId) || user.id !== existing.id)) return refuse("AccountIdentityMismatch");
      if (existing?.revokedAt) return refuse("AccountRevoked");
      const token = await readInviteToken();
      if (existing?.roles.length) {
        if (token) {
          // A known Discord account may otherwise skip invitation handling and
          // silently open its old character after a different one was confirmed.
          const check = await checkInvitation(token);
          if (!check.ok) return refuse(check.error);
          const invitation = await prisma.invitation.findUnique({ where: { id: check.id }, select: { ninjaProfileId: true, ninjaProfile: { select: { userId: true } } } });
          if (!invitation) return refuse("InvitationUnavailable");
          if (invitation.ninjaProfileId && invitation.ninjaProfile?.userId !== existing.id) return refuse("AccountIdentityMismatch");
        }
        return true;
      }
      if (!account.access_token) return refuse("DiscordUnavailable");
      if (!token) return refuse("InvitationRequired");
      const check = await checkInvitation(token);
      if (!check.ok) return refuse(check.error);
      const guildId = process.env.DISCORD_GUILD_ID;
      if (!guildId) return refuse("Configuration");
      try {
        const response = await fetch("https://discord.com/api/users/@me/guilds", {
          headers: { Authorization: `Bearer ${account.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return refuse("DiscordUnavailable");
        const guilds: unknown = await response.json();
        if (!Array.isArray(guilds) || !guilds.every((guild) => guild && typeof guild.id === "string")) return refuse("DiscordUnavailable");
        if (!guilds.some((guild) => guild.id === guildId)) return refuse("DiscordMembershipRequired");
      } catch { return refuse("DiscordUnavailable"); }
      if (existing) {
        try { await consumeInvitation(existing.id, token); }
        catch {
          const latest = await checkInvitation(token);
          return refuse(latest.ok ? "InvitationUnavailable" : latest.error);
        }
      }
      return true;
    },
    async session({ session, user }) {
      const current = await prisma.user.findUnique({ where: { id: user.id }, include: { roles: { include: { role: true } } } });
      if (!current || current.revokedAt || !current.roles.length) throw new Error("SESSION_REVOKED");
      session.user.id = current.id;
      (session.user as typeof session.user & { roles: string[] }).roles = current.roles.map((entry) => entry.role.code);
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      try {
        const token = await readInviteToken();
        if (!user.id || !token) throw new Error("INVITE_COOKIE_MISSING");
        await consumeInvitation(user.id, token);
      } catch {
        console.warn("[auth] création interrompue : invitation non consommée ; aucune session autorisée");
        if (user.id) await prisma.user.update({ where: { id: user.id }, data: { revokedAt: new Date() } });
      }
    },
    async signIn() {
      try { (await cookies()).delete(INVITATION_COOKIE); }
      catch { console.warn("[auth] nettoyage du cookie d’invitation différé"); }
    },
    // Account + canonical Discord id are now written atomically in linkAccount.
    // Never overwrite discordId in an event or swallow a linking conflict.
  },
});
