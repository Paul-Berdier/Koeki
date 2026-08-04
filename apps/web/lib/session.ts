import { cache } from "react";
import { redirect } from "next/navigation";
import { ROLES, can, type Permission, type Role } from "@koeki/domain";

export const demoMode = process.env.DEMO_MODE === "true";

export interface SessionInfo { userId: string; name: string; roles: Role[] }

export const roleLabels: Record<Role, string> = {
  SUPER_ADMIN: "Super-administrateur", KOEKI_MANAGER: "Responsable Kōeki", ECONOMIC_AGENT: "Agent économique", NINJA: "Ninja", AUDITOR: "Auditeur"
};

export const getSession = cache(async (): Promise<SessionInfo | null> => {
  if (demoMode) return { userId: "demo-user", name: "Sonemi Hakumei", roles: ["KOEKI_MANAGER"] };
  const { auth } = await import("@/auth");
  const session = await auth().catch(() => null);
  if (!session?.user?.id) return null;
  const roles = ((session.user as { roles?: string[] }).roles ?? []).filter((role): role is Role => (ROLES as readonly string[]).includes(role));
  return { userId: session.user.id, name: session.user.name ?? "Agent Kōeki", roles };
});

export async function requireSession(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/api/auth/signin");
  return session;
}

export function hasPermission(session: SessionInfo, permission: Permission) { return session.roles.some((role) => can(role, permission)); }

export async function requirePermission(permission: Permission): Promise<SessionInfo> {
  const session = await requireSession();
  if (!hasPermission(session, permission)) redirect("/access-denied");
  return session;
}

/** Server-action guard: throws instead of redirecting, and always refuses writes in demo mode. */
export async function requireWriteAccess(permission: Permission): Promise<SessionInfo> {
  if (demoMode) throw new Error("Mode démonstration : les écritures sont désactivées");
  const session = await getSession();
  if (!session) throw new Error("UNAUTHENTICATED");
  if (!hasPermission(session, permission)) throw new Error("FORBIDDEN");
  return session;
}
