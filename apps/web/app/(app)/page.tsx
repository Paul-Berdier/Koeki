import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, MetricCard, MoneyDisplay, PageHeader, SectionHeader, StatusBadge, ZoneTitle } from "@koeki/ui";
import { getDashboard } from "@/lib/data";
import { getMyWorkSummary } from "@/lib/team-service";
import { getWeeklyRanking } from "@/lib/ranking-service";
import { formatDate } from "@/lib/format";
import { demoMode, hasPermission, requireSession } from "@/lib/session";
import { prisma } from "@koeki/database";

export default async function DashboardPage() {
  const session = await requireSession();
  const business = hasPermission(session, "business:read");
  if (!business) {
    const own = demoMode ? null : await prisma.ninjaProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    redirect(own ? `/ninjas/${own.id}` : "/profil");
  }
  const manager = hasPermission(session, "team:read");
  const works = hasPermission(session, "tasks:read");
  const [work, economy, ranking] = await Promise.all([
    works ? getMyWorkSummary(session) : null,
    manager || !works ? getDashboard(session) : null,
    hasPermission(session, "ranking:read") ? getWeeklyRanking() : null
  ]);
  return <div className="page-wrap">
    <PageHeader eyebrow="Service économique de Suna" title={manager ? "Pilotage du service" : works ? "Mon activité" : "Situation économique"} description={manager ? "Les décisions à prendre, les dossiers à attribuer et le travail de l’équipe." : works ? "Vos priorités, vos dossiers et vos opérations de la semaine, au même endroit." : "Consultez les registres économiques autorisés et les rapports publiés."} actions={<Link className="button button-ghost" href="/profil">Ma fiche ninja</Link>} />
    <div className="action-links">
      {hasPermission(session, "payments:write") && <Link className="button button-primary" href="/ninjas">Enregistrer un paiement</Link>}
      {hasPermission(session, "inventory:write") && <><Link className="button button-ghost" href="/dons">Enregistrer un don</Link><Link className="button button-ghost" href="/resources/transaction">Enregistrer un rachat</Link></>}
      {hasPermission(session, "reports:write") && <Link className="button button-ghost" href="/reports/new">Rédiger mon rapport</Link>}
    </div>
    {work && <>
      <section className="metric-grid" aria-label="Priorités du service">
        {manager ? <>
          <Link className="metric-link" href="/reports?statut=SUBMITTED"><MetricCard label="Rapports à examiner" value={work.awaitingReview} detail="Ouvrir les décisions en attente" tone={work.awaitingReview ? "warn" : "neutral"} /></Link>
          <Link className="metric-link" href="/equipe#sans-referent"><MetricCard label="Dossiers sans référent" value={work.unassignedDossiers} detail="Attribuer ou conserver en attente" /></Link>
          <Link className="metric-link" href="/taches?statut=BLOCKED"><MetricCard label="Tâches bloquées" value={work.blockedTasks} detail="Identifier l’aide nécessaire" tone={work.blockedTasks ? "warn" : "neutral"} /></Link>
        </> : <>
          <Link className="metric-link" href="/ninjas?mesDossiers=1"><MetricCard label="Mes dossiers" value={work.assignedDossiers} detail="Dossiers dont vous êtes le référent" /></Link>
          <Link className="metric-link" href="/reports?statut=RETURNED"><MetricCard label="Rapports à corriger" value={work.returnedReports} detail="Lire les retours du responsable" tone={work.returnedReports ? "warn" : "neutral"} /></Link>
          <Link className="metric-link" href="/classement"><MetricCard label="Opérations cette semaine" value={ranking?.own?.operations ?? 0} detail={ranking?.own ? "Paiements, dons et rachats éligibles" : "Participation à vérifier dans le classement"} /></Link>
        </>}
        <Link className="metric-link" href="/taches?statut=overdue"><MetricCard label="Tâches en retard" value={work.overdueTasks} detail="Échéance dépassée, tâche ouverte" tone={work.overdueTasks ? "warn" : "neutral"} /></Link>
      </section>
      <div className="home-intro">
        <section className="panel"><SectionHeader title={manager ? "À suivre en priorité" : "Mes prochaines tâches"} description="Ouvrez une tâche pour consulter son contexte et mettre à jour son état." action={<Link className="text-link" href="/taches">Toutes les tâches →</Link>} />{work.tasks.length ? <ul className="task-list">{work.tasks.map(task=><li key={task.id}><Link href={`/taches?id=${task.id}`}><span><strong>{task.title}</strong><small>{task.dueAt ? `Échéance : ${formatDate(task.dueAt)}` : "Sans échéance"}</small></span><StatusBadge status={task.status === "BLOCKED" ? "warning" : "pending"}>{task.status === "BLOCKED" ? "Bloqué" : task.status === "IN_PROGRESS" ? "En cours" : "À faire"}</StatusBadge></Link></li>)}</ul> : <EmptyState title="Aucune tâche ouverte" description="Les tâches qui vous sont attribuées apparaîtront ici." />}</section>
        <section className="panel help-panel"><SectionHeader title={manager ? "Votre point de suivi" : "Votre journée au comptoir"} /><div className="panel-body"><p>{manager ? "Consultez l’équipe, attribuez les dossiers sans référent et examinez les rapports soumis. Une absence d’opération enregistrée ne constitue pas une faute." : "Commencez par vos tâches. Pour un paiement, ouvrez la fiche ninja ; pour un don ou un rachat, utilisez le comptoir. Conservez le reçu de chaque opération."}</p><Link className="text-link" href={manager ? "/equipe" : "/operations"}>{manager ? `Voir l’équipe · ${work.activeAgents} participants actifs` : "Consulter les démarches"} →</Link><p>Les points d’activité du classement sont distincts des points de fidélité des ninjas.</p></div></section>
      </div>
    </>}
    {economy && <>
      <ZoneTitle title="Situation économique" detail={`Année RP ${economy.rpYear} · règles fiscales conservées`} />
      <section className="metric-grid" aria-label="Synthèse économique">
        <Link className="metric-link" href="/statistics"><MetricCard label="Taxes attendues" value={<MoneyDisplay amount={economy.expected} />} detail="Montant brut appelé ce cycle" /></Link>
        <Link className="metric-link" href="/statistics"><MetricCard label="Ryō encaissés" value={<MoneyDisplay amount={economy.collected} />} detail="Paiements validés" tone="good" /></Link>
        <Link className="metric-link" href="/recouvrement"><MetricCard label="Dette ouverte" value={<MoneyDisplay amount={economy.debt} />} detail={`${economy.overdueNinjas} ninjas en retard`} /></Link>
        <Link className="metric-link" href="/inventory"><MetricCard label="Stocks critiques" value={economy.priorities.criticalStocks.length} detail="Consulter le registre de stock" /></Link>
      </section>
      {manager && economy.priorities.penaltyRateMissing && <p className="notice">Taux de majoration absent : l’automatisation reste désactivée. <Link className="text-link" href="/admin?section=economic">Voir les paramètres économiques</Link>.</p>}
      <section className="panel"><SectionHeader title="Dernières opérations métier" action={hasPermission(session,"audit:read") ? <Link className="text-link" href="/audit">Consulter l’audit →</Link> : undefined} />{economy.activity.length ? <div className="table-scroll"><table><thead><tr><th>Référence</th><th>Opération</th><th>Ninja</th><th className="num">Montant</th><th>État</th></tr></thead><tbody>{economy.activity.map(item=><tr key={item.code}><td><code>{item.code}</code></td><td>{item.label}</td><td><Link className="text-link" href={`/ninjas/${item.ninjaId}`}>{item.subject}</Link></td><td className="num"><MoneyDisplay amount={item.amount} /></td><td><StatusBadge status={item.status}>{item.statusLabel}</StatusBadge></td></tr>)}</tbody></table></div> : <EmptyState title="Aucune opération" description="Les écritures validées du service apparaîtront ici." />}</section>
    </>}
  </div>;
}
