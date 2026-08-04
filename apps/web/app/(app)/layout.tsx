import { AppShell } from "@/components/app-shell";
import { getShellInfo } from "@/lib/data";
import { hasPermission, requireSession, type SessionInfo } from "@/lib/session";

function allowedNav(session: SessionInfo): string[] {
  const base = ["/", "/ninjas", "/resources", "/crafting"];
  if (hasPermission(session, "payments:write") || hasPermission(session, "audit:read")) base.push("/recouvrement", "/inventory", "/statistics", "/reports");
  if (hasPermission(session, "audit:read")) base.push("/audit");
  if (hasPermission(session, "users:manage") || hasPermission(session, "settings:manage")) base.push("/admin");
  return base;
}

export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const shell = await getShellInfo(session);
  return <AppShell shell={shell} allowed={allowedNav(session)}>{children}</AppShell>;
}
