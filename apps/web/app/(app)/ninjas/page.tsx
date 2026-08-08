import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Plus } from "lucide-react";
import { EmptyState, GradeBadge, MoneyDisplay, NinjaAvatar, PageHeader, PointDisplay, StatusBadge } from "@koeki/ui";
import { NinjaFilters } from "@/components/ninja-filters";
import { NinjaViews } from "@/components/ninja-views";
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
  const q = typeof params.q === "string" ? params.q : undefined;
  const grade = typeof params.grade === "string" && params.grade ? params.grade : undefined;
  const statut = typeof params.statut === "string" && params.statut ? params.statut : undefined;
  const page = typeof params.page === "string" ? Number(params.page) || 1 : 1;
  const data = await getNinjas({ q, grade, statut, page });
  const canWrite = hasPermission(session, "ninjas:write");
  const info = typeof params.info === "string" ? params.info : null;
  const error = typeof params.erreur === "string" ? params.erreur : null;
  const pageQuery = (target: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(grade ? { grade } : {}), ...(statut ? { statut } : {}), page: String(target) })}`;
  const table = <section className="panel ninja-table-panel">
    {data.ninjas.length ? <div className="table-scroll"><table className="ninja-table"><thead><tr><th>Ninja</th><th>Grade</th><th>Situation</th><th className="num">Dette</th><th className="num">Points</th><th>Agent</th><th>Échéance</th></tr></thead><tbody>{data.ninjas.map((ninja) => <tr key={ninja.code}><td><Link href={`/ninjas/${ninja.id}`} className="person-cell"><NinjaAvatar name={ninja.name} /><span><strong>{ninja.name}</strong><small>{ninja.code}{ninja.alias && ` · ${ninja.alias}`}</small></span></Link></td><td><GradeBadge>{ninja.grade}</GradeBadge></td><td><StatusBadge status={ninja.badge}>{ninja.statusLabel}</StatusBadge></td><td className={`num ${ninja.debt > 0n ? "negative" : "muted"}`}>{ninja.debt ? <MoneyDisplay amount={ninja.debt} /> : "Aucune"}</td><td className="num"><PointDisplay points={ninja.points} /></td><td>{ninja.agent}</td><td>{ninja.due}</td></tr>)}</tbody></table></div>
      : <EmptyState title="Aucun ninja trouvé" description="Ajustez la recherche ou les filtres — ou créez un nouveau dossier." />}
    <footer className="table-footer"><span>{data.total ? `${(data.page - 1) * 25 + 1}–${Math.min(data.page * 25, data.total)} sur ${data.total} ninjas` : "0 ninja"}</span><div>{data.page > 1 ? <Link className="button button-ghost" href={pageQuery(data.page - 1)}>Précédent</Link> : <button disabled>Précédent</button>}{data.page < data.pageCount ? <Link className="button button-ghost" href={pageQuery(data.page + 1)}>Suivant</Link> : <button disabled>Suivant</button>}</div></footer>
  </section>;
  const cards = <section className="ninja-card-grid" aria-label="Registre des ninjas en cartes">{data.ninjas.map((ninja) => <article className="ninja-card" key={ninja.code}>
    <header><Link href={`/ninjas/${ninja.id}`} className="person-cell"><NinjaAvatar name={ninja.name} /><span><strong>{ninja.name}</strong><small>{ninja.code}</small></span></Link><StatusBadge status={ninja.badge}>{ninja.statusLabel}</StatusBadge></header>
    <div>
      <span><small>Grade</small><GradeBadge>{ninja.grade}</GradeBadge></span>
      <span><small>Dette</small><strong className={ninja.debt ? "negative" : "muted"}>{ninja.debt ? <MoneyDisplay amount={ninja.debt} /> : "Aucune"}</strong></span>
      <span><small>Points</small><PointDisplay points={ninja.points} /></span>
    </div>
    <div style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
      <span><small>Échéance</small><strong className="muted" style={{ fontWeight: 400 }}>{ninja.due}</strong></span>
      <Link className="text-link" href={`/ninjas/${ninja.id}`}>Voir <ArrowRight size={13} /></Link>
    </div>
  </article>)}</section>;
  return <div className="page-wrap">
    <PageHeader eyebrow="Registre administratif" title="Ninjas" description="Dossiers fiscaux des shinobis de Suna — taxes, points, dettes et suivi par agent."
      metrics={[
        { label: "Dossiers", value: new Intl.NumberFormat("fr-FR").format(data.stats.total) },
        { label: "À jour", value: new Intl.NumberFormat("fr-FR").format(data.stats.upToDate) },
        { label: "En retard", value: new Intl.NumberFormat("fr-FR").format(data.stats.overdue) },
        { label: "Dette totale", value: <MoneyDisplay amount={data.stats.debt} /> }
      ]}
      actions={canWrite ? <Link className="button button-primary" href="/ninjas/new"><Plus size={17} /> Nouveau ninja</Link> : undefined} />
    {info && <p className="notice" role="status">{info}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <NinjaFilters grades={data.grades} />
    <NinjaViews table={table} cards={cards} />
  </div>;
}
