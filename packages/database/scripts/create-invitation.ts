import { createHash, randomBytes } from "node:crypto";
import { PrismaClient, RoleCode } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pepper = process.env.INVITE_TOKEN_PEPPER;
  if (!pepper) throw new Error("INVITE_TOKEN_PEPPER is required");
  const roleCode = (process.env.INVITE_ROLE ?? "SUPER_ADMIN") as RoleCode;
  if (!Object.values(RoleCode).includes(roleCode)) throw new Error(`Unknown role: ${roleCode}. Valid: ${Object.values(RoleCode).join(", ")}`);
  const expiresDays = Number(process.env.INVITE_EXPIRES_DAYS ?? 7);
  const role = await prisma.role.findUnique({ where: { code: roleCode } });
  if (!role) throw new Error(`Role ${roleCode} not found in database — run the seed first`);
  const creator = await prisma.user.findFirst({ where: { roles: { some: { role: { code: "SUPER_ADMIN" } } } }, orderBy: { createdAt: "asc" } });
  if (!creator) throw new Error("No SUPER_ADMIN user found to attribute the invitation to — run the seed first");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(`${pepper}:${token}`, "utf8").digest("hex");
  const invitation = await prisma.invitation.create({ data: { tokenHash, roleId: role.id, createdById: creator.id, expiresAt: new Date(Date.now() + expiresDays * 86_400_000) } });
  await prisma.auditLog.create({ data: { actorId: creator.id, action: "INVITATION_CREATED", entityType: "Invitation", entityId: invitation.id, requestId: crypto.randomUUID(), newValues: { roleCode, expiresAt: invitation.expiresAt.toISOString() } } });
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  console.log(`Invitation ${roleCode} created (expires ${invitation.expiresAt.toISOString()})`);
  console.log(`${base}/invite/${token}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
