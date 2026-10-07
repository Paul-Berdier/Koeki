import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { MoneyDisplay, PageHeader } from "@koeki/ui";
import { NinjaRegister } from "@/components/ninja-register";
import { getNinjas } from "@/lib/data";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { prisma } from "@koeki/database";

export default async function NinjasPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  if (!demoMode && session.roles.length === 1 && session.roles[0] === "NINJA") {
    const own = await prisma.ninjaProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    redirect(own ? `/ninjas/${own.id}` : "/profil");
  }
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const grade = typeof params.grade === "string" && params.grade ? params.grade : undefined;
  const statut = typeof params.statut === "string" && params.statut ? params.statut : undefined;
  // Old bookmarks containing mesDossiers are deliberately ignored. The register
  // is shared by all agents; typing still filters in the browser, without RSC work.
  const data = await getNinjas({ grade, statut });
  const canWrite = hasPermission(session, "ninjas:write");
  const info = typeof params.info === "string" ? params.info : null;
  const error = typeof params.erreur === "string" ? params.erreur : null;
  const rows = data.ninjas.map((ninja) => ({ ...ninja, debt: ninja.debt.toString() }));
  return <div className="page-wrap"><PageHeader eyebrow="Dossiers partagés" title="Ninjas" description="Tous les agents peuvent intervenir sur tous les ninjas. Retrouvez une identité, consultez sa situation et enregistrez son opération."
    metrics={[{ label: "Dossiers", value: new Intl.NumberFormat("fr-FR").format(data.stats.total) }, { label: "À régulariser", value: <Link href="/ninjas?statut=overdue">{new Intl.NumberFormat("fr-FR").format(data.stats.overdue)}</Link> }, { label: "Grades à renseigner", value: <Link href="/ninjas?statut=grade_missing">{new Intl.NumberFormat("fr-FR").format(data.stats.needsUpdate)}</Link> }, { label: "Dette totale", value: <MoneyDisplay amount={data.stats.debt} /> }]}
    actions={canWrite ? <Link className="button button-primary" href="/ninjas/new"><Plus size={17} aria-hidden="true" />Nouveau ninja</Link> : undefined} />
    {info && <p className="notice" role="status">{info}</p>}{error && <p className="notice error" role="alert">{error}</p>}
    <NinjaRegister ninjas={rows} grades={data.grades} initialQuery={q} initialGrade={grade ?? ""} initialStatut={statut ?? ""} />
  </div>;
}
