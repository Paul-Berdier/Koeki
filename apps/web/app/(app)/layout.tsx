import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getShellInfo } from "@/lib/data";
import { demoMode, requireSession } from "@/lib/session";
import { allowedNavigation } from "@/lib/navigation";
import { prisma } from "@koeki/database";

export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // Privacy requirement: every account must be linked to a ninja before using the register —
  // displayed identities are ninja names, never Discord account names.
  if (!demoMode) {
    const pathname = (await headers()).get("x-pathname") ?? "";
    if (!pathname.startsWith("/profil")) {
      const linked = await prisma.ninjaProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
      if (!linked) redirect("/profil");
    }
  }
  const shell = await getShellInfo(session);
  return <AppShell shell={shell} allowed={allowedNavigation(session.roles)} demo={demoMode}>{children}</AppShell>;
}
