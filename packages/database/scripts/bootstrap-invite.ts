// One-shot admin onboarding: creates a SUPER_ADMIN invitation only while no human
// super-administrator exists (humans authenticate via Discord, so they have a discordId).
// Safe to run on every deploy — it no-ops once an admin account exists or an
// invitation is still pending.
import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "postgresql://koeki:koeki@127.0.0.1:5432/koeki?schema=public" }) });

async function main() {
  const pepper = process.env.INVITE_TOKEN_PEPPER;
  if (!pepper) { console.log("bootstrap-invite: INVITE_TOKEN_PEPPER absent — étape ignorée"); return; }
  const humanAdmin = await prisma.user.findFirst({ where: { discordId: { not: null }, revokedAt: null, roles: { some: { role: { code: "SUPER_ADMIN" } } } } });
  if (humanAdmin) { console.log("bootstrap-invite: un super-administrateur humain existe déjà — rien à faire"); return; }
  const pending = await prisma.invitation.findFirst({ where: { status: "PENDING", revokedAt: null, expiresAt: { gt: new Date() }, role: { code: "SUPER_ADMIN" } } });
  if (pending) { console.log("bootstrap-invite: une invitation SUPER_ADMIN est déjà en attente — rien à faire"); return; }
  const role = await prisma.role.findUnique({ where: { code: "SUPER_ADMIN" } });
  const creator = await prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } });
  if (!role || !creator) { console.log("bootstrap-invite: référentiels absents — exécutez d’abord le bootstrap"); return; }
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(`${pepper}:${token}`, "utf8").digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 86_400_000);
  const invitation = await prisma.invitation.create({ data: { tokenHash, roleId: role.id, createdById: creator.id, expiresAt } });
  await prisma.auditLog.create({ data: { actorId: creator.id, action: "INVITATION_CREATED", entityType: "Invitation", entityId: invitation.id, requestId: crypto.randomUUID(), reason: "Invitation initiale générée au déploiement", newValues: { roleCode: "SUPER_ADMIN", expiresAt: expiresAt.toISOString() } } });
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  console.log("=====================================================");
  console.log("INVITATION SUPER_ADMIN INITIALE (valable 7 jours, usage unique)");
  console.log(`${base}/invite/${token}`);
  console.log("=====================================================");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
